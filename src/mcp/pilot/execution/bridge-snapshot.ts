/**
 * MCP Piloto — Task 7: `MarketSnapshotPort` real sobre o `BridgeClient`,
 * usado por `McpTradeService.propose` para avaliar risco (`RiskPolicy`)
 * com dados reais de conta/posições/preço em vez do fake de teste.
 *
 * Três chamadas ao bridge (contrato de cada handler documentado em
 * `python/mt5_bridge.py` e em `../clients/mt5-bridge`):
 * - `GET_ACCOUNT_INFO` → `ACCOUNT_INFO`: usa `equity` como `portfolioNav`.
 * - `GET_POSITIONS_SNAPSHOT` → `POSITIONS_SNAPSHOT`: soma o `volume` das
 *   posições cujo `symbol` bate com o pedido (`currentPositionQty`).
 * - `GET_CHART_DATA` (`{symbol, timeframe: 'M1', count: 1}`) →
 *   `CHART_DATA`: usa o `close` do último candle como `referencePrice`.
 */
import type { MarketSnapshotPort } from '../../../application/mcp-trade/service';
import type { BridgeClient } from '../clients/mt5-bridge';
import { ReadModelError } from '../../../application/read-models-v1/errors';

interface RawPosition {
  readonly symbol?: unknown;
  readonly volume?: unknown;
}

interface RawCandle {
  readonly close?: unknown;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function createBridgeSnapshot(bridge: BridgeClient): MarketSnapshotPort {
  return {
    async get(symbol: string) {
      const [account, positions, chart] = await Promise.all([
        bridge.request('GET_ACCOUNT_INFO'),
        bridge.request('GET_POSITIONS_SNAPSHOT', { symbol }),
        bridge.request('GET_CHART_DATA', { symbol, timeframe: 'M1', count: 1 }),
      ]);

      const portfolioNav = toNumber(account.equity);

      const positionList = Array.isArray((positions as { positions?: unknown }).positions)
        ? ((positions as { positions?: unknown }).positions as RawPosition[])
        : [];
      const currentPositionQty = positionList
        .filter((p) => p.symbol === symbol)
        .reduce((sum, p) => sum + toNumber(p.volume), 0);

      const candles = Array.isArray((chart as { candles?: unknown }).candles)
        ? ((chart as { candles?: unknown }).candles as RawCandle[])
        : [];
      const lastCandle = candles[candles.length - 1];
      const referencePrice = toNumber(lastCandle?.close);
      if (referencePrice <= 0) {
        throw new ReadModelError('NO_PRICE', `preço de referência indisponível para ${symbol}`);
      }

      return { referencePrice, currentPositionQty, portfolioNav };
    },
  };
}
