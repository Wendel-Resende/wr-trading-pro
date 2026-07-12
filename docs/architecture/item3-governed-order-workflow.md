# Item 3 — governed order workflow (domain v1)

## State machine

`TradeProposalV1 + OrderDraftV1` → strict Zod revalidation/cloning → runtime-branded frozen `RiskDecision` → configured human-verification service → runtime-branded frozen `HumanApprovalReceipt` → fresh runtime-branded frozen `KillSwitchSnapshot` → atomically reserved idempotency key → runtime-branded frozen `GovernedOrderIntent` → guarded `ExecutionBroker` → `ExecutionResult`.

Every transition is fail-closed. Callers provide `now`; the module does not read clocks, environment, crypto, network, UI, routes, Python or MT5. Rejected risk cannot produce an approval receipt or intent. Time comparisons preserve timezone offsets and six fractional digits.

## Chronology and expiry

All proposal, draft, risk, approval, switch, expiry and explicit `now` values are parsed as strict ISO instants. Proposal/draft/risk/approval cannot be future-dated at their transition. The enforced ordering is proposal creation ≤ draft creation ≤ risk decision ≤ approval ≤ intent. Proposal remains strictly active while deciding risk, approving and issuing; risk remains strictly active while approving and issuing; approval is strictly active while issuing. Equality at an expiry is expired.

Kill-switch observations may equal `now`, may not be future-dated, and must expire strictly after `now`. The complete observed-to-expiry validity is capped by exported `MAX_KILL_SWITCH_TTL_MS` (5 seconds), including microsecond precision.

## Binding and TOCTOU controls

The receipt binds the authenticated human actor, approval interval, proposal ID, draft ID, risk-decision ID, and every field in the exact validated draft. `fingerprintOrderDraft` returns `draft-v1-canonical:` plus the complete canonical draft content. This exact representation is collision-free within the process/string model; it is deliberately **not a hash or cryptographic signature** and may be long. Authentication and integrity at transport/storage boundaries remain adapter responsibilities.

Intent issuance re-runs `TradeProposalV1Schema.safeParse` and `OrderDraftV1Schema.safeParse`, uses only their cloned results, recomputes the binding, and compares all IDs, instrument, side, order type, quantity and all prices. Unknown fields and invalid discriminator/state values fail closed. Account changes are detected by the exact draft binding. Risk maximum quantity is capped at the same `1_000_000_000` ceiling as the wire contract. Before awaiting idempotency reservation, issuance captures and freezes an independent scalar snapshot; the final frozen intent contains no proposal, draft, risk, approval, or switch reference. After reservation, all chronology, expiry, and kill-switch TTL/freshness gates are re-evaluated at the registry-supplied completion instant; `issuedAt` is that instant.

## Trust boundaries

- A loose authentication boolean is not accepted. `createHumanApprovalService(verifier)` receives the privileged verifier once at the trusted composition root and returns an issuer whose per-call `issue(input)` has no verifier parameter. The verifier returns an opaque `AuthenticatedHumanPrincipal`; no production principal constructor or bypass is exported. Throwing/null verification fails closed. This is a composition-root trust boundary, **not** a defense against hostile code in the same process/realm that can supply or replace dependencies.
- Risk, approval, kill-switch, and governed-intent runtime symbols are private module values. Their factories return frozen values and register their exact identities in private `WeakSet` registries. Exported guards therefore reject structurally coherent plain objects, cast/deserialized values, and even objects carrying runtime symbols copied by reflection. `issueOrderIntent` returns `ARTIFACT_NOT_AUTHENTIC` before trusting unauthentic artifacts. These capabilities are intentionally process-local, are not serializable, and do not protect against arbitrary hostile same-process code controlling the composition root.
- `IdempotencyRegistry.reserve` requires atomic check-and-reserve inside an implementation's stated consistency scope. On success, its trusted `reservedAt` is a strict ISO instant captured when the atomic reservation completes—not at request/start time. Reservation occurs only after every initial domain gate. Exceptions and invalid/backdated completion times fail closed as `IDEMPOTENCY_UNAVAILABLE`. The included in-memory implementation is test-only/process-local, uses an injected deterministic time provider (never `Date.now`), and makes no distributed atomicity claim.
- `GovernedOrderIntent` is opaque/branded and only its governed factory can construct it. Every `ExecutionBroker` implementation must call `isGovernedOrderIntent` before any side effect; the included fixture demonstrates this rule, while no real adapter exists yet.
- `ExecutionResult` distinguishes `ACCEPTED`, `REJECTED`, and `UNKNOWN`, always carries correlation/idempotency, and deliberately contains no fabricated fill data.

## Legacy and Item 4

Existing UI, routes, direct MT5/Python paths and legacy execution behavior remain untouched. Item 4 must add real authenticated persistence/adapters, a durable atomic idempotency registry with documented consistency, broker result mapping/reconciliation, and migrate execution callers through this boundary before claiming governed real trading.
