import type { Mt5AdapterOptions, Mt5ReadClient } from './types';
import { Mt5InstrumentCatalog } from './instrument-catalog';
import { Mt5MarketDataProvider } from './market-data-provider';
import { Mt5HistoricalBarsProvider } from './historical-bars-provider';
import { Mt5PortfolioProvider } from './portfolio-provider';
import { DisabledMt5ExecutionBroker } from './disabled-execution-broker';

export const createMt5Adapters=(client:Mt5ReadClient,options:Mt5AdapterOptions={})=>Object.freeze({
  instrumentCatalog:new Mt5InstrumentCatalog(client,options.timeoutMs),marketDataProvider:new Mt5MarketDataProvider(client,options.maxTickBuffer),
  historicalBarsProvider:new Mt5HistoricalBarsProvider(client),portfolioProvider:new Mt5PortfolioProvider(client,options.clock),executionBroker:new DisabledMt5ExecutionBroker(),
});
export * from './types';export * from './mapping';export * from './instrument-catalog';export * from './market-data-provider';export * from './historical-bars-provider';export * from './portfolio-provider';export * from './disabled-execution-broker';
