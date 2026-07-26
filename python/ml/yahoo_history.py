"""Histórico D1 estendido via Yahoo Finance (Item D, 2026-07-25).

Motivo: o servidor da corretora (XPMT5-DEMO) limita o histórico D1 a **1248
barras (~5 anos)** para TODOS os instrumentos — verificado, e
`copy_rates_range` não aprofunda. O Yahoo entrega 15-26 anos com preço
AJUSTADO por proventos, que é a mesma base do MT5.

Validação da equivalência (2026-07-25, janela de sobreposição, 11 tickers):
correlação de 0,995 entre os retornos diários das duas fontes, com diferença
absoluta mediana de 2 pontos-base. Foi essa validação que o COTAHIST da B3
nunca passou — lá o preço é NOMINAL e a detecção de eventos societários
confirmou só 6 de 220 candidatos.

Limitações conhecidas e declaradas:

- **Cobertura incompleta.** 9 dos 138 tickers do universo CVM (ELET3, EMBR3,
  JBSS3, CPLE6, MRFG3, NEOE3, GUAR3, SRNA3, STBP3) respondem 404 com a
  mensagem "symbol may be delisted" mesmo estando ativos na B3. Para eles o
  MT5 continua sendo a única fonte. A ingestão REPORTA cada ausência; nunca
  finge cobertura.
- **API não-oficial.** Pode mudar ou sair do ar sem aviso. Por isso a ingestão
  é explícita e sob demanda, nunca no caminho crítico de nenhuma tela.
- **Viés de sobrevivência.** O universo vem das empresas listadas HOJE; quanto
  mais história, mais o backtest herda esse viés. Ele infla resultado positivo
  e não afeta resultado negativo — considerar na leitura de qualquer métrica.
"""
import json
import sqlite3
import urllib.request
from datetime import datetime, timezone

import pandas as pd

TIMEFRAME = 'D1'
SOURCE = 'YAHOO'

#: Empresas renomeadas na B3 — o Yahoo só conhece o símbolo NOVO, mas a série
#: cobre a história inteira, inclusive o período sob o nome antigo. O universo
#: CVM ainda usa o nome antigo, então gravamos sob ele.
SYMBOL_OVERRIDES = {
    'CCRO3': 'MOTV3',  # CCR -> Motiva (2024)
    'TRPL4': 'ISAE4',  # Transmissão Paulista -> ISA Energia (2024)
}

#: Início da janela pedida: 1990-01-01. O Yahoo devolve o que tiver.
_PERIOD_START = 631152000
_MIN_BARS = 250  # menos que um ano de pregões não estende nada de útil

#: Retorno diário acima disto é artefato de ajuste, não movimento de mercado.
#:
#: Medido em 2026-07-25 na primeira ingestão: o `adjclose` do Yahoo para série
#: brasileira ANTIGA traz fatores de desdobramento errados, produzindo preços e
#: retornos absurdos — VULC3 com +9.900% e fechamento de R$ 114.496 em 2007,
#: SUZB3 +1.900%, CPFE3 +1.808%; 26 barras com |ret| >= 90% em 13 símbolos e
#: 108 barras com preço <= R$ 0,01. A validação inicial (correlação 0,995 com o
#: MT5) cobria só 2021+, onde o dado é bom — extrapolar dali para 2000 foi erro
#: de método.
#:
#: Ação: TRUNCAR a série no último ponto implausível, mantendo só o trecho
#: contíguo confiável depois dele. Descartar barras isoladas deixaria um salto
#: no lugar; truncar entrega uma série menor e íntegra.
#:
#: Limiares CALIBRADOS contra os artefatos observados, não escolhidos a priori.
#: A primeira tentativa usou |ret| >= 60% e produziu FALSO POSITIVO: a queda
#: real de -61,5% da AMBP3 (crise de dívida, out/2025) truncou a série inteira
#: da empresa. Na distribuição medida, os artefatos são inconfundíveis —
#: +9.900%, +1.900%, +1.808% — enquanto o pior movimento legítimo observado é
#: -61,5%. Daí a assimetria dos limites.
#:
#: RISCO RESIDUAL DECLARADO: artefato de desdobramento na faixa de -50% a -90%
#: (um 3:1 produz exatamente -66,7%) sobrevive a esta regra quando o nível de
#: preço da série é sadio. Afeta poucos símbolos e distorce apenas as janelas
#: de 60 pregões que contêm a data.
_MAX_RETORNO_PLAUSIVEL = 2.00   # +200% num dia: só ajuste errado faz isso
_MIN_RETORNO_PLAUSIVEL = -0.90  # -90%: preço praticamente a zero
_MIN_PRECO = 0.01
_MAX_PRECO = 10_000.0           # ação da B3 acima disto é erro de fator


def truncate_at_last_implausible(bars: "pd.DataFrame") -> tuple["pd.DataFrame", dict]:
    """Corta a série no último ponto implausível; devolve (barras, relatório)."""
    if bars.empty:
        return bars, {'truncated': False}
    retorno = bars['close'].pct_change()
    ruim = (
        (retorno >= _MAX_RETORNO_PLAUSIVEL)
        | (retorno <= _MIN_RETORNO_PLAUSIVEL)
        | (bars['close'] <= _MIN_PRECO)
        | (bars['close'] >= _MAX_PRECO)
    )
    if not ruim.any():
        return bars, {'truncated': False}
    ultimo = int(bars.index[ruim][-1])
    limpo = bars.loc[ultimo + 1:].reset_index(drop=True)
    return limpo, {
        'truncated': True,
        'droppedBars': int(ultimo + 1),
        'reason': f'{int(ruim.sum())} barra(s) implausivel(is); serie truncada',
    }


class YahooUnavailableError(RuntimeError):
    """Símbolo sem dado no Yahoo — nunca silenciado, sempre reportado."""


def yahoo_symbol(ticker: str) -> str:
    return f'{SYMBOL_OVERRIDES.get(ticker, ticker)}.SA'


def _default_opener(url: str) -> bytes:
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def fetch_daily(ticker: str, opener=_default_opener, now=None) -> pd.DataFrame:
    """Barras diárias AJUSTADAS. `opener` é injetável para teste sem rede.

    Usa `adjclose` como `close`: é a série ajustada por proventos e
    desdobramentos, a única comparável com o que o MT5 entrega. O fechamento
    nominal é descartado de propósito — misturar as duas bases foi exatamente
    o que inviabilizou o COTAHIST.
    """
    fim = int((now or datetime.now(tz=timezone.utc)).timestamp())
    url = (f'https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol(ticker)}'
           f'?period1={_PERIOD_START}&period2={fim}&interval=1d')
    try:
        payload = json.loads(opener(url))
    except Exception as exc:  # noqa: BLE001 — 404/rede viram erro tipado, nunca stack trace ao chamador
        raise YahooUnavailableError(f'{ticker}: indisponivel no Yahoo') from exc

    resultado = (payload.get('chart') or {}).get('result')
    if not resultado:
        raise YahooUnavailableError(f'{ticker}: resposta sem serie')

    bloco = resultado[0]
    cotacao = (bloco.get('indicators') or {}).get('quote') or [{}]
    ajustado = ((bloco.get('indicators') or {}).get('adjclose') or [{}])[0].get('adjclose')
    if not ajustado or not bloco.get('timestamp'):
        raise YahooUnavailableError(f'{ticker}: serie sem adjclose')

    q = cotacao[0]
    df = pd.DataFrame({
        'time': pd.to_datetime(bloco['timestamp'], unit='s', utc=True).tz_localize(None).normalize(),
        'open': q.get('open'),
        'high': q.get('high'),
        'low': q.get('low'),
        'close': ajustado,
        'volume': q.get('volume'),
    })
    # Linha sem fechamento ajustado não é barra: descartada, nunca preenchida.
    df = df.dropna(subset=['close']).drop_duplicates('time').sort_values('time').reset_index(drop=True)
    # OHLC ausente cai para o próprio fechamento — o modelo usa `close`, e
    # inventar máxima/mínima seria pior que repetir o valor conhecido.
    for coluna in ('open', 'high', 'low'):
        df[coluna] = df[coluna].fillna(df['close'])
    df['volume'] = df['volume'].fillna(0.0)

    # Saneamento: fatores de ajuste errados em série antiga são comuns nesta
    # fonte e produzem preço/retorno impossíveis. Ver `_MAX_RETORNO_PLAUSIVEL`.
    df, corte = truncate_at_last_implausible(df)
    if len(df) < _MIN_BARS:
        raise YahooUnavailableError(
            f'{ticker}: apenas {len(df)} barras utilizaveis'
            + (f" ({corte['reason']})" if corte.get('truncated') else ''))
    df.attrs['quality'] = corte
    return df


def write_yahoo_candles(db_path: str, ticker: str, bars: pd.DataFrame) -> int:
    """Grava as barras do Yahoo como fonte AUTORITATIVA na janela que cobre.

    Remove qualquer barra existente do intervalo — inclusive as do MT5 — antes
    de inserir. Motivo: a chave única é (symbol, timeframe, time), então só uma
    fonte pode ocupar cada dia, e manter duas bases de ajuste convivendo no
    mesmo símbolo produziria degrau artificial na emenda. Fora do intervalo do
    Yahoo (tipicamente o pregão mais recente, que ele publica com atraso), as
    barras do MT5 permanecem intactas.
    """
    if bars.empty:
        return 0
    inicio = bars['time'].min().strftime('%Y-%m-%d %H:%M:%S')
    fim = bars['time'].max().strftime('%Y-%m-%d %H:%M:%S')

    con = sqlite3.connect(db_path, timeout=30)
    try:
        con.execute('PRAGMA journal_mode=WAL')
        with con:  # transação: apaga e insere atomicamente
            con.execute(
                'DELETE FROM HistoricalCandle WHERE symbol=? AND timeframe=? AND time BETWEEN ? AND ?',
                (ticker, TIMEFRAME, inicio, fim))
            con.executemany(
                'INSERT INTO HistoricalCandle (symbol, timeframe, time, open, high, low, close, volume, source) '
                'VALUES (?,?,?,?,?,?,?,?,?)',
                [(ticker, TIMEFRAME, r.time.strftime('%Y-%m-%d %H:%M:%S'),
                  float(r.open), float(r.high), float(r.low), float(r.close),
                  float(r.volume), SOURCE) for r in bars.itertuples()])
        return len(bars)
    finally:
        con.close()


def ingest_symbols(db_path: str, tickers, fetcher=fetch_daily) -> dict:
    """Ingere vários tickers, relatando POR SÍMBOLO — nunca meia-carga silenciosa.

    Falha de um símbolo jamais derruba os demais: mesmo padrão de
    `candles.backfill_symbols`.
    """
    relatorio = {'ok': {}, 'failed': {}}
    for ticker in tickers:
        try:
            bars = fetcher(ticker)
        except YahooUnavailableError as exc:
            relatorio['failed'][ticker] = str(exc)
            continue
        except Exception:  # noqa: BLE001 — erro inesperado por símbolo é reportado, não propagado
            relatorio['failed'][ticker] = f'{ticker}: falha inesperada na coleta'
            continue
        relatorio['ok'][ticker] = {
            'bars': write_yahoo_candles(db_path, ticker, bars),
            'from': bars['time'].min().strftime('%Y-%m-%d'),
            'to': bars['time'].max().strftime('%Y-%m-%d'),
        }
    return relatorio
