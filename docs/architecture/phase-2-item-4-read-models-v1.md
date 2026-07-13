# Fase 2 — Item 4: read models point-in-time v1

## Objetivo

Expor a fundação canônica `Issuer`/`InstrumentVersion`, CVM e `VersionedMarketBar` por uma borda HTTP somente leitura, JSON-safe e auditável. A UI será consumidora futura desses contratos; nenhuma rota ou tabela de UI é canônica.

## Escopo fechado

Entra:

- serviços de aplicação injetáveis em `src/application/read-models-v1/`;
- DTOs wire explícitos e assemblers puros;
- cinco endpoints GET em `/api/v1/`;
- extensões aditivas mínimas de filtros/paginação nos ports e repositories CVM quando necessárias;
- composição com o singleton `src/lib/prisma.ts` e adapters existentes;
- testes reais em SQLite temporário;
- matriz legado → novo e critérios de paridade.

Fica fora:

- ingestão, backfill, POST/PUT/PATCH/DELETE, trading ou banco real;
- alteração de `HistoricalCandle`, `MarketData`, `StockMonitoring` ou suas rotas/services;
- mudança de `MLPredictionsTab`, `tradingAgentsService` ou tabs atuais;
- fallback para legado, mock, sintético ou degradado;
- métricas, valuation, sinais ou recomendações;
- feature flag/componente sem integração real;
- corte legado.

`docs/CODEX_HANDOFF.md` é alteração preexistente e não pode ser tocado.

## Arquitetura

```text
UI futura / cliente HTTP
  → API GET /api/v1 (Zod estrito, erros estáveis)
  → ReadModelV1Service (application; depende apenas de ports)
  → repositories point-in-time + IngestionLedger
  → Prisma adapters existentes
  → tabelas canônicas
```

As rotas compõem dependências com o singleton `@/lib/prisma`; serviços não criam `PrismaClient`. Assemblers não consultam banco. O serviço enriquece `createdByRunId` via `IngestionLedger.getRun` e exige run `SUCCEEDED` com `completedAt` não nulo; inconsistência vira erro interno sanitizado.

## Regras temporais

Nenhum endpoint usa relógio ou default `now`.

- `knowledgeTime` é obrigatório em todos.
- Endpoints CVM e barras exigem `decisionTime` e validam `knowledgeTime <= decisionTime`.
- Resolução de instrumento exige `asOf` (business-time) separado de `knowledgeTime`.
- `asOf` nunca é inferido de `decisionTime`.
- Datas civis `YYYY-MM-DD` permanecem strings e nunca passam por `Date` na serialização.

## Valores exatos

Todo `bigint` cru vira string decimal. Nunca usar `Number(bigint)`.

Valores escalados usam:

```ts
{ raw: string; scalePow: number; decimal: string }
```

`decimal` é calculado deterministicamente sem float/expoente, inclusive negativos e escalas `[-18,18]`.

## Proveniência wire

```ts
interface RunProvenanceDTO {
  runId: string;
  sourceKey: string;
  completedAt: string;
}
```

Filings também expõem protocolo, `publishedAt`, `sourceUrl`, `rawSha256`, versão e predecessor. Barras expõem `sourceKey`, `sourceRecordKey`, `sourceAvailableAt`, `rawSha256`, revisão e predecessor.

## Endpoints

Todos rejeitam query param desconhecido ou duplicado. Sucesso: `{ success: true, data, meta }`. Erro: `{ success: false, error: { code, message } }`; nunca expor stack, SQL ou mensagem Prisma.

### 1. GET `/api/v1/reference/instrument`

Obrigatórios: `symbol`, `exchange`, `asOf`, `knowledgeTime`.

Resolve `InstrumentRepository.findInstrumentVersions(symbol, exchange, { asOf, knowledgeTime })`.

- zero: 404 `INSTRUMENT_NOT_FOUND`;
- mais de um: 409 `AMBIGUOUS_INSTRUMENT_VERSION`;
- um: DTO completo + provenance da run criadora.

### 2. GET `/api/v1/fundamentals/effective-filing`

Obrigatórios: `issuerId`, `documentType`, `referenceDate`, `decisionTime`, `knowledgeTime`.

Usa `findEffectiveFiling` por cadeia exata. Zero: 404 `FILING_NOT_FOUND`. Retorna filing efetiva + provenance.

### 3. GET `/api/v1/fundamentals/facts`

Obrigatórios: `issuerId`, `documentType`, `referenceDate`, `decisionTime`, `knowledgeTime`, `limit` (1..1000), `offset` (0..1_000_000).

Opcionais: `statementType`, `scope`, `accountCode`.

Primeiro resolve filing efetiva pela chave exata; só depois consulta fatos dessa cadeia. Extender aditivamente `CvmFactQuery`/schema/adapter com `documentType`, `referenceDate`, `limit`, `offset`. A seleção da filing efetiva permanece anterior aos filtros filhos. Retorna fatos paginados e `meta.effectiveFiling`.

### 4. GET `/api/v1/fundamentals/share-capital`

Obrigatórios iguais ao endpoint de fatos, com `limit` 1..1000 e `offset`.

Opcionais: `shareClass`, `quantityType`.

Extender aditivamente `ShareCapitalFactQuery`/schema/adapter com `documentType`, `referenceDate`, `limit`, `offset`. Quantidade é string exata. Retorna `meta.effectiveFiling`.

### 5. GET `/api/v1/market-bars`

Obrigatórios: `instrumentVersionId`, `sourceKey`, `timeframe`, `from`, `to`, `decisionTime`, `knowledgeTime`, `limit` (1..5000).

- `[from,to)` estrito;
- quantidade teórica de intervalos do timeframe deve ser `<= limit` e `<= 5000` antes da consulta;
- timeframe canônico: `1m|5m|15m|30m|1h|4h|1d|1w`;
- nenhuma resolução implícita de fonte ou instrumento;
- retorna a maior revisão visível por `openedAt`, já garantida pelo repository;
- se resultado exceder `limit`, falha fechado (`RESULT_LIMIT_EXCEEDED`), nunca trunca silenciosamente.

## DTOs

Criar contratos readonly para:

- `InstrumentVersionReadModelV1`;
- `EffectiveCvmFilingReadModelV1`;
- `CvmFactReadModelV1`;
- `ShareCapitalReadModelV1`;
- `MarketBarReadModelV1`;
- `RunProvenanceDTO` e `ScaledDecimalDTO`.

DTOs preservam todos os identificadores e campos de qualidade necessários para auditoria. Não renomear `openRaw` para `open` sem manter a semântica; usar `open: ScaledDecimalDTO`, etc.

## Extensões aditivas permitidas

Somente se necessárias para os endpoints de fatos/capital:

- ports `cvm-fact-repository.ts` e `share-capital-fact-repository.ts`;
- schemas CVM correspondentes;
- adapters Prisma CVM correspondentes;
- testes CVM existentes.

Não alterar schema Prisma ou migrations. Não alterar repositories de referência/filing/market-bar.

## Erros HTTP

- 400 `INVALID_QUERY`, `INVALID_TIME_RANGE`, `RESULT_LIMIT_EXCEEDED`;
- 404 `INSTRUMENT_NOT_FOUND`, `FILING_NOT_FOUND`;
- 409 `AMBIGUOUS_INSTRUMENT_VERSION`;
- 500 `INTERNAL_ERROR` com mensagem genérica.

Erros Zod não retornam payload bruto. Todas as rotas são GET e não têm side effects.

## Testes obrigatórios

Harness `scripts/read-models-v1/` aplica todas as migrations em SQLite temporário.

1. parâmetros desconhecidos e duplicados → 400;
2. ausência de qualquer tempo obrigatório → 400;
3. `knowledgeTime > decisionTime` → 400;
4. resolução business-time/knowledge-time correta, 404 e ambiguidade fail-closed;
5. filing efetiva antes/depois de retificação;
6. conta removida na retificação não vaza mesmo com filtro de conta;
7. fatos de outra `documentType/referenceDate` não contaminam a resposta;
8. paginação determinística de fatos e capital;
9. `BigInt > Number.MAX_SAFE_INTEGER` preservado como string/decimal exatos;
10. datas civis não sofrem shift;
11. revisão futura de barra não suprime predecessor visível;
12. fontes de barra não se misturam;
13. range por timeframe e limite são rejeitados antes da consulta;
14. provenance contém run correta e completedAt;
15. erro interno não vaza detalhes;
16. nenhuma rota exporta método não-GET;
17. nenhum arquivo legado protegido é modificado.

## Gates

```text
npm run test:read-models-v1
npm run test:reference-data
npm run test:cvm-facts
npm run test:market-bar
npm run smoke:domain-contracts
npx prisma validate
npx tsc --noEmit
npm run electron:compile
npm run build
```

Repetir `test:read-models-v1`, `test:cvm-facts`, Prisma e TypeScript no Windows.

## Matriz de transição

| Legado | Novo read model | Estado neste item | Corte permitido |
|---|---|---|---|
| `/api/historical-candles` + `HistoricalCandle` | `/api/v1/market-bars` + `VersionedMarketBar` | coexistência, sem fallback | após ingestão e paridade por fonte/timeframe |
| `StockMonitoring` fundamentos mutáveis | `/api/v1/fundamentals/*` + CVM point-in-time | coexistência, sem cálculos novos | após métricas determinísticas e paridade auditada |
| resolução por `Asset.symbol` | `/api/v1/reference/instrument` | seam canônico | após mapeamento/reconciliação de ativos |
| dados mock de agentes | nenhum fallback | proibido como oficial | remover somente em fase própria de agentes/UI |

## Critério de conclusão

Item 4 termina com contratos HTTP read-only utilizáveis e testados, não com cutover visual. A UI atual continua funcional e intacta. A ligação real das tabs só ocorre após dados, snapshots e testes de paridade dos Itens 5–6.

## Nota de implementação

Implementado: `src/application/read-models-v1/` (DTOs, assemblers puros, `ReadModelV1Service`, `ProvenanceResolver`, `compose.ts`); 5 rotas GET em `src/app/api/v1/`; extensão aditiva de `CvmFactQuery`/`ShareCapitalFactQuery` (+ schemas Zod + adapters Prisma) com `documentType`, `referenceDate`, `limit`, `offset` — repositórios de referência/filing/market-bar não foram alterados. Harness em `scripts/read-models-v1/` (script `test:read-models-v1`) reutiliza o padrão de SQLite temporário + `prisma migrate deploy` dos demais itens. Todos os 7 gates obrigatórios (`test:read-models-v1`, `test:reference-data`, `test:cvm-facts`, `test:market-bar`, `smoke:domain-contracts`, `prisma validate`, `tsc --noEmit`) passam.