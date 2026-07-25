"""Snapshot imutável das barras D1 usadas por um treino (Item A / D1, D-hash).

`HistoricalCandle` é mutável (full-refresh por backfill). Sem um snapshot
congelado ANTES de `build_dataset` ler qualquer preço, um "backtest
reprodutível" não seria reprodutível de verdade: um backfill concorrente
mudaria os dados sob os pés de um treino/backtest já em andamento.

Contrato desta v1.1 (revisão 4 da spec):
- `universeBarsDigest` é calculado SOMENTE sobre OHLCV cru, ANTES de
  qualquer feature (preço ou fundamento) ser computada. É o ÚNICO
  identificador usado para nomear o diretório de snapshot.
- `datasetDigest`/`datasetHash` (calculados depois, sobre o dataset FINAL
  com features) NUNCA aparecem aqui — isso é responsabilidade de
  `ml.dataset.build_dataset`, mantendo os dois hashes com papéis distintos.
"""
import hashlib
import os
import shutil
import uuid

import pandas as pd

from .candles import load_daily_candles

_BAR_COLUMNS = ['time', 'open', 'high', 'low', 'close', 'volume']


class SnapshotNotFoundError(ValueError):
    pass


def _canonical_symbol_payload(bars: pd.DataFrame) -> bytes:
    """G-003 item 3 (D1/D-hash): o payload que alimenta `universeBarsDigest`
    usa exatamente os mesmos valores gravados no parquet (`_atomic_write_parquet`
    logo abaixo, chamado sobre o MESMO `bars[_BAR_COLUMNS]`) — sem
    arredondamento. Antes, um `.round(8)` aqui divergia da precisão total
    persistida no parquet, quebrando a garantia de que o digest cobre
    exatamente os valores persistidos (achado da revisão independente)."""
    ordered = bars[_BAR_COLUMNS].sort_values('time').reset_index(drop=True)
    ordered = ordered.assign(time=ordered['time'].astype('int64'))  # ns epoch, determinístico
    return ordered.to_csv(index=False).encode()


def _atomic_write_parquet(df: pd.DataFrame, path: str) -> None:
    tmp_path = f'{path}.{uuid.uuid4().hex}.tmp'
    df.to_parquet(tmp_path, index=False)
    os.replace(tmp_path, path)


def write_universe_snapshot(db_path: str, symbols: list[str], snapshot_base_dir: str) -> dict:
    """Escreve o snapshot congelado do universo e retorna o manifesto.

    Retorna: {
      'universeBarsDigest': str (64 hex),
      'snapshotDir': str (data/ml/bars_snapshot/<universeBarsDigest>/),
      'perSymbol': { SYMBOL: { 'sha256': str, 'rows': int, 'from': str, 'to': str } },
    }

    Símbolos sem barra alguma são omitidos do manifesto (não fabrica linha
    vazia) — o chamador decide se isso vira `INSUFFICIENT_BARS` mais tarde.
    """
    os.makedirs(snapshot_base_dir, exist_ok=True)
    provisional_dir = os.path.join(snapshot_base_dir, f'.provisional-{uuid.uuid4().hex}')
    os.makedirs(provisional_dir, exist_ok=True)

    per_symbol: dict[str, dict] = {}
    universe_hasher = hashlib.sha256()
    try:
        for symbol in sorted(symbols):
            bars = load_daily_candles(db_path, symbol)
            if bars.empty:
                continue
            payload = _canonical_symbol_payload(bars)
            symbol_sha256 = hashlib.sha256(payload).hexdigest()
            _atomic_write_parquet(bars[_BAR_COLUMNS], os.path.join(provisional_dir, f'{symbol}.parquet'))
            per_symbol[symbol] = {
                'sha256': symbol_sha256,
                'rows': int(len(bars)),
                'from': bars['time'].min().strftime('%Y-%m-%d'),
                'to': bars['time'].max().strftime('%Y-%m-%d'),
            }
            universe_hasher.update(symbol.encode())
            universe_hasher.update(payload)

        universe_bars_digest = universe_hasher.hexdigest()
        final_dir = os.path.join(snapshot_base_dir, universe_bars_digest)

        # G-003 item 3 (D1/D-hash): a checagem `isdir` + `os.replace` tem uma
        # janela TOCTOU sob publicação concorrente do MESMO digest — dois
        # treinos com o mesmo universo de barras podem ambos ver `isdir ==
        # False` e ambos tentar o rename. `os.replace` é atômico por si só
        # (nunca deixa um `final_dir` parcialmente escrito), mas o SEGUNDO
        # rename concorrente falha com `OSError` (destino já existe e não
        # está vazio). Isso não é falha real: mesmo digest => mesmo
        # conteúdo, então tratamos como dedup também nesse caso, nunca
        # propagamos a exceção quando `final_dir` já existe.
        if os.path.isdir(final_dir):
            shutil.rmtree(provisional_dir, ignore_errors=True)
        else:
            try:
                os.replace(provisional_dir, final_dir)
            except OSError:
                if os.path.isdir(final_dir):
                    shutil.rmtree(provisional_dir, ignore_errors=True)
                else:
                    raise
    except Exception:
        shutil.rmtree(provisional_dir, ignore_errors=True)
        raise

    return {'universeBarsDigest': universe_bars_digest, 'snapshotDir': final_dir, 'perSymbol': per_symbol}


def load_snapshot_bars(snapshot_dir: str, symbol: str) -> pd.DataFrame:
    """Lê as barras congeladas de um símbolo. NUNCA cai para HistoricalCandle
    live — snapshot ausente é erro explícito, nunca substituição silenciosa."""
    path = os.path.join(snapshot_dir, f'{symbol}.parquet')
    if not os.path.exists(path):
        raise SnapshotNotFoundError(f'SNAPSHOT_NOT_FOUND: {symbol} nao encontrado em {snapshot_dir}')
    df = pd.read_parquet(path)
    df['time'] = pd.to_datetime(df['time'])
    return df
