export type Mt5Listener = (data: unknown) => void;

/** Structural read-only surface; deliberately excludes every trading command. */
export interface Mt5ReadClient {
  getConnectionState(): unknown;
  on(event: string, listener: Mt5Listener): void;
  off(event: string, listener: Mt5Listener): void;
  getSymbols(): void;
  getSymbolInfo(symbol: string): void;
  subscribeTicks(symbol: string): void;
  unsubscribeTicks(symbol: string): void;
  getChartData(symbol: string, timeframe: string, count?: number, range?: Readonly<{ from: string; to: string }>): Promise<unknown>;
  getPositionsCache(): unknown;
}

export interface Mt5AdapterOptions {
  readonly timeoutMs?: number;
  readonly clock?: () => Date;
  readonly maxTickBuffer?: number;
}
