/**
 * MCP Piloto — Task 7: `MarketSnapshotPort` real sobre o MT5 MCP nativo,
 * usado por `McpTradeService.propose` para avaliar risco (`RiskPolicy`)
 * com dados reais de conta/posições/preço em vez do fake de teste.
 *
 * Três chamadas aos wrappers nativos de `mt5-mcp-tools.ts` (mesmo cliente
 * usado pelas rotas /api/mt5/mcp/**):
 * - `getAccountInfo()`: objeto direto, usa `equity` como `portfolioNav`.
 * - `getPositions(symbol)`: array já normalizado, soma o `volume` das
 *   posições cujo `symbol` bate com o pedido (`currentPositionQty`).
 * - `getRates({symbol, timeframe:'M1', count:1})`: array já normalizado,
 *   usa o `close` do último candle como `referencePrice`.
 *
 */
import type { MarketSnapshotPort } from '../../../application/mcp-trade/service';
import { ReadModelError } from '../../../application/read-models-v1/errors';
import { getAccountInfo, getPositions, getRates } from '../../../lib/server/mt5-mcp-tools';

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

export function createBridgeSnapshot(): MarketSnapshotPort {
  return {
    async get(symbol: string) {
      const [account, positions, candles] = await Promise.all([
        getAccountInfo(),
        getPositions(symbol),
        getRates({ symbol, timeframe: 'M1', count: 1 }),
      ]);

      const portfolioNav = toNumber((account as { equity?: unknown } | null)?.equity);

      const positionList = positions as RawPosition[];
      const currentPositionQty = positionList
        .filter((p) => p.symbol === symbol)
        .reduce((sum, p) => sum + toNumber(p.volume), 0);

      const candleList = candles as RawCandle[];
      const lastCandle = candleList[candleList.length - 1];
      const referencePrice = toNumber(lastCandle?.close);
      if (referencePrice <= 0) {
        throw new ReadModelError('NO_PRICE', `preço de referência indisponível para ${symbol}`);
      }

      return { referencePrice, currentPositionQty, portfolioNav };
    },
  };
}
