# Contratos wire v1

## Escopo

Este item introduz somente contratos de dados na fronteira wire, sem migrar consumidores. Há três envelopes estritos e discriminados por `kind`: `trading.signal`, `trade.proposal` e `order.draft`, todos com `schemaVersion: "1.0.0"`.

As implementações equivalentes ficam em TypeScript/Zod (`src/contracts/v1`), Python/Pydantic v2 (`python/contracts/v1`), corpus JSON compartilhado (`contracts/fixtures/v1`) e testes de paridade (`scripts/contracts` e `python/tests/test_contracts_v1.py`).

## Semântica segura e bloqueio de execução

`trading.signal` usa `decision: BUY | SELL | HOLD | NO_DECISION`. `side` permanece restrito a `BUY | SELL` somente em `trade.proposal` e `order.draft`. Assim, ausência de decisão ou retenção deliberada não precisa ser representada como direção acionável.

Estes contratos são deliberadamente **não executáveis**:

- todos exigem `executionEligible: false`;
- `order.draft` exige `state: "draft"`, `humanApproval: null` e `idempotencyKey: null`;
- não existem operações `submit`, `execute` ou `send`;
- não há ligação com `ExecutionBroker`, MT5, agentes, rotas ou pipeline.

Qualquer evolução para intenção/execução pertence a outro contrato e a outra fase, com revisão de segurança explícita.

## Timestamps e invariantes

O timestamp v1 preserva exatamente a string recebida e exige formato ISO com quatro dígitos de ano e timezone. Ambos os parsers aplicam as mesmas regras: ano `0001`–`9999`, calendário gregoriano real (incluindo bissextos), hora `00`–`23`, minuto/segundo `00`–`59`, fração opcional de 1–6 dígitos e offset máximo `±14:00` (em `±14`, minutos devem ser `00`). Leap seconds não são aceitos.

As relações são comparadas por instante UTC, não por texto:

- `validUntil`, quando presente, deve ser estritamente posterior a `createdAt`;
- `expiresAt` deve ser estritamente posterior a `createdAt`.

Relações entre envelopes (por exemplo, proposta versus sinal) não são responsabilidade deste item.

## Matriz de paridade

| Regra | Zod | Pydantic |
|---|---:|---:|
| versão/kind literais e discriminante | sim | sim |
| campos extras proibidos | `.strict()` | `extra="forbid"` |
| sem coerção silenciosa | tipos Zod nativos | `strict=True` |
| IDs, símbolos e textos limitados | regex/min/max | regex/min/max |
| timestamp ISO, calendário/offset estritos | parser explícito | regex + `datetime.fromisoformat` + limites explícitos |
| relações temporais em UTC | `superRefine` | `model_validator` |
| números finitos, positivos/ranges | `.finite()` + limites | `allow_inf_nan=False` + limites |
| decisão segura no sinal | `BUY/SELL/HOLD/NO_DECISION` | literals equivalentes |
| lado em proposta/draft | `BUY/SELL` | literals equivalentes |
| LIMIT exige preço; MARKET proíbe | `superRefine` | `model_validator` |
| invariantes de bloqueio de execução | literals/null | literals/None |

## Compatibilidade e verificação

`1.0.0` é literal: mudanças incompatíveis devem criar nova versão. Mudanças compatíveis ainda exigem atualização simultânea das implementações, fixtures e testes. A serialização é comparada após parse/dump e timestamps não são normalizados para outro fuso.

```bash
npm run test:contracts
```

O teste TS valida e normaliza todos os válidos, compara caso a caso a decisão de aceitação/rejeição de todo o corpus inválido com o runner Python e executa casos não JSON para `NaN`, `±Infinity` e booleanos. O `unittest` Python repete corpus, round-trip e casos programáticos para `confidence`, `quantity` e todos os preços.
