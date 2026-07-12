# MT5 adapter migration matrix (Phase 1 / Item 4)

| Capability | Domain port adapter | Legacy UI status |
|---|---|---|
| Instruments | `Mt5InstrumentCatalog` | Not migrated |
| Quotes/ticks | `Mt5MarketDataProvider` | Not migrated |
| Historical bars | `Mt5HistoricalBarsProvider` | Not migrated |
| Portfolio | `Mt5PortfolioProvider` | Not migrated |
| Execution | `DisabledMt5ExecutionBroker` (inert) | No real execution added |

## Read-boundary guarantees

`createMt5Adapters(client, options)` accepts only the structural read surface `Mt5ReadClient`; core adapters do not import the legacy singleton and the disabled broker receives no client. `timeoutMs` and `maxTickBuffer` must be positive (`maxTickBuffer` defaults to 1024).

- Catalog list requests and same-symbol detail requests are shared while pending. Symbol detail replies go only to the requesting socket and carry the requested symbol. Only the explicit correlated `SYMBOL_NOT_FOUND` code resolves a lookup as `null`; invalid requests, disconnected terminals, and backend exceptions use `SYMBOL_INFO_ERROR` and reject. Every completion path removes listeners/timers, and complete MT5 symbol metadata is required. The production service requests `includeDetails: true`; the Python bridge remains backwards-compatible by returning names when details are not requested.
- Instrument mapping does not manufacture currency, scale, or activity. It requires currency, explicit scales or MT5 `digits` plus `volume_step`, and activity from explicit `active` or numeric `trade_mode`. `select`/`visible` are not activity signals.
- Tick subscriptions are lazy (iterator creation), independently queued per iterator, reference-counted per provider, and bounded. Abort, overflow, subscription rollback, and unsubscribe failures all perform complete cleanup.
- Historical requests require strict timezone-qualified ISO instants. `MT5Service` adds a monotonic `requestId`; chart successes and errors are requester-only and correlated by `requestId`, symbol, and timeframe, with listeners and timers removed on success, explicit error, send failure, or timeout. Range, timeframe, and terminal/data failures use `CHART_RANGE_ERROR`, `CHART_TIMEFRAME_ERROR`, and `CHART_DATA_ERROR`. Unknown timeframes fail closed and never fall back to H1. The range is sent to the bridge, which uses `copy_rates_range`; legacy calls without a range use `copy_rates_from_pos`. Returned candles are validated, range-filtered, sorted, checked for conflicting duplicate timestamps, then limited.
- All Python WebSocket emission uses strict JSON (`allow_nan=False`). Non-finite or otherwise unserializable payloads are logged safely and are not sent.
- Portfolio snapshots validate connected state, finite account fields, all positions, and the injected clock. Financial values such as balance/equity/PnL may be negative where the domain permits.

## Composition and limitations

This change is additive: no UI consumer was migrated. **Existing direct legacy paths remain ungoverned until explicitly migrated** to these ports. This item does not claim that legacy direct service consumers are protected by the governed workflow. The execution adapter is deliberately disabled and cannot place, modify, cancel, or close an order/position.
