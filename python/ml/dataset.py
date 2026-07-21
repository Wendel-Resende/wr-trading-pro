"""Dataset point-in-time: preço + fundamentos defasados + TimesFM, por ticker/dia."""
import hashlib
import pandas as pd

from .bars_snapshot import SnapshotNotFoundError, load_snapshot_bars
from .candles import load_daily_candles
from .features import FEATURE_COLUMNS, price_features, target_direction
from .fundamentals import FUND_COLUMNS, asof_fundamentals, load_fundamental_history, load_sector_map

ALL_FEATURES = FEATURE_COLUMNS + FUND_COLUMNS + ['tfm_ret_10', 'tfm_iq']
_MIN_HISTORY = 260  # precisa de MM200 + margem

def build_dataset(snapshot_dir, cvm_db_path, symbols, tfm_provider, sample_every=5):
    """Monta o dataset final (preço + fundamentos CVM + TimesFM + rótulo).

    Item A / D1 (revisão 3): lê EXCLUSIVAMENTE do snapshot imutável já
    escrito por `bars_snapshot.write_universe_snapshot` — nunca de
    `HistoricalCandle` diretamente. `db_path` não é mais aceito para preço;
    quem quiser dado ao vivo usa `build_inference_row`, que continua lendo
    `HistoricalCandle` de propósito (previsão do dia precisa do dado mais
    recente, não de um snapshot congelado).

    Retorna (ds, datasetDigest) — `datasetDigest` é o SHA-256 completo (64
    hex, SEM prefixo) do dataset final. Separado de `universeBarsDigest`
    (que é só sobre o OHLCV cru do snapshot, calculado antes desta função
    rodar) — ver D-hash na spec. O chamador prefixa `"sha256:"` quando
    precisar do identificador semântico (`datasetHash`); esta função nunca
    devolve um valor com `:`, que quebraria como nome de diretório/arquivo
    no Windows.
    """
    sectors = load_sector_map(cvm_db_path)
    parts = []
    for symbol in symbols:
        try:
            candles = load_snapshot_bars(snapshot_dir, symbol)
        except SnapshotNotFoundError:
            # Símbolo sem snapshot (ex.: sem barra nenhuma no HistoricalCandle
            # no momento do backfill) — mesmo padrão de "falha por símbolo,
            # nunca por treino inteiro" já usado em backfill_symbols.
            continue
        if len(candles) < _MIN_HISTORY:
            continue
        f = price_features(candles)
        y = target_direction(candles)
        fund = load_fundamental_history(cvm_db_path, symbol)
        fj = asof_fundamentals(f.index, fund) if len(fund) else \
            pd.DataFrame(index=f.index, columns=FUND_COLUMNS, dtype=float)
        closes = candles.set_index('time')['close']
        rows = []
        # amostra a cada `sample_every` pregões, começando onde MM200 existe
        for i in range(_MIN_HISTORY, len(f), sample_every):
            date = f.index[i]
            if pd.isna(y.loc[date]):
                continue
            tfm = tfm_provider.features_for(symbol, closes.loc[:date])
            rows.append({'symbol': symbol, 'date': date,
                         'setor': sectors.get(symbol, 'DESCONHECIDO'),
                         'y': float(y.loc[date]),
                         **f.loc[date].to_dict(), **fj.loc[date].to_dict(), **tfm})
        if rows:
            parts.append(pd.DataFrame(rows))
    if not parts:
        raise ValueError('INSUFFICIENT_DATA: nenhum ticker com historico suficiente')
    ds = pd.concat(parts, ignore_index=True).sort_values(['date', 'symbol']).reset_index(drop=True)
    payload = ds.round(10).to_csv(index=False).encode()
    return ds, hashlib.sha256(payload).hexdigest()

def build_inference_row(db_path, cvm_db_path, symbol, tfm_provider) -> pd.DataFrame:
    """Linha de inferência para o último pregão disponível.

    Diferente de `build_dataset`, NÃO exige `y` (que só existe até
    `horizon` pregões atrás, pois depende do preço futuro) — senão a
    "previsão de hoje" ficaria sempre ~10 pregões defasada. Usa apenas
    dados <= última data de candle, preservando a regra point-in-time.
    """
    candles = load_daily_candles(db_path, symbol)
    if len(candles) < _MIN_HISTORY:
        raise ValueError(f'INSUFFICIENT_DATA: {symbol} tem historico insuficiente')
    f = price_features(candles)
    fund = load_fundamental_history(cvm_db_path, symbol)
    fj = asof_fundamentals(f.index, fund) if len(fund) else \
        pd.DataFrame(index=f.index, columns=FUND_COLUMNS, dtype=float)
    closes = candles.set_index('time')['close']
    date = f.index[-1]
    tfm = tfm_provider.features_for(symbol, closes.loc[:date])
    row = {'symbol': symbol, 'date': date, **f.loc[date].to_dict(), **fj.loc[date].to_dict(), **tfm}
    return pd.DataFrame([row])
