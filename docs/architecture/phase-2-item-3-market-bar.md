# Fase 2 / Item 3 — MarketBar Versionada e Point-in-Time

Status: fundação sem ingestão real. Estritamente aditivo — nenhum modelo
legado (`MarketData`, `HistoricalCandle`) foi alterado ou removido; nenhuma
API/UI/Electron/Python/MT5/Profit/SQX runtime, rede ou backfill foi
implementado. Segue os padrões já estabelecidos em
`docs/architecture/phase-2-item-1-reference-data.md` e
`docs/architecture/phase-2-item-2-cvm-facts.md`.

## Objetivo

Adicionar `VersionedMarketBar`: uma barra OHLCV persistida, versionada por
fonte/revisão, exata (sem float) e consultável point-in-time sem lookahead,
sem tocar o pipeline de candles existente usado pelas tabs de ML/MT5.

## Não quebra o que já existe

- `src/domain/v1/models/market-bar.ts` (`MarketBar`, `HistoricalBarsRequest`,
  `Timeframe`) permanece inalterado — `VersionedMarketBar` é um tipo novo e
  separado em `src/domain/v1/models/versioned-market-bar.ts`, reexportando
  `Timeframe` do arquivo original.
- `IngestionRun` e `InstrumentVersion` recebem apenas relações Prisma
  aditivas (`versionedMarketBars VersionedMarketBar[]`) — nenhuma coluna
  nova, nenhuma migration de alteração nessas tabelas.
- A migration `20260713131546_add_market_bar_foundation` contém somente
  `CREATE TABLE`/`CREATE INDEX`/`CREATE UNIQUE INDEX`, gerada e validada
  contra um SQLite temporário (nunca `prisma/dev.db`).

## Identidade e fonte

- `VersionedMarketBar.instrumentVersionId` é FK obrigatória para
  `InstrumentVersion`. A unit of work de barras **nunca** cria uma
  `InstrumentVersion` — referência desconhecida falha fechado
  (`UnknownInstrumentVersionReferenceError`).
- `sourceKey` **nunca** é enviado na submission. É sempre derivado da
  `IngestionRun` corrente que está fazendo o commit (`run.sourceKey`),
  garantindo que um único commit nunca mistura mais de uma fonte.
- Leitura (`MarketBarRepository.findBars`) exige `sourceKey` explícito como
  parâmetro obrigatório e intervalo semiaberto `[from,to)` com `from < to` — nunca há fusão implícita entre fontes distintas
  para o mesmo instrumento/timeframe/openedAt (testado com duas fontes
  coexistindo sobre o mesmo `openedAt`).
- Regra SQX: se `sourceKey` (normalizado, minúsculo) começa com `sqx`, o
  `InstrumentVersion.symbol` referenciado deve começar com `WIN` ou `WDO`;
  caso contrário, falha fechada com `SourceSymbolRuleViolationError`. A
  camada de persistência genérica nunca escolhe uma fonte sozinha — esta é
  a única regra especial hardcoded, e só nessa direção (fontes não-SQX não
  são restringidas por símbolo).
- Validação point-in-time da `InstrumentVersion` referenciada: sua
  `createdByRun` deve estar `SUCCEEDED` com `completedAt <=` o
  `completedAt` desta run (`InstrumentVersionNotKnownError` caso
  contrário); o `openedAt` da barra deve pertencer ao intervalo de negócio
  `[validFrom, validTo)` conhecido nesse mesmo `completedAt` — `validTo` só
  é honrado se a run que fechou o intervalo (`closedByRun`) também estiver
  `SUCCEEDED` e completa a tempo, replicando exatamente o padrão bitemporal
  de `PrismaInstrumentRepository` (Item 1). Fora do intervalo →
  `OpenedAtOutOfKnownRangeError`.

## Observação/revisão append-only

- Submission exige `sourceRecordKey` normalizada, única dentro do
  `sourceKey` (constraint `@@unique([sourceKey, sourceRecordKey])`).
- `isRevision: boolean` + `supersedesSourceRecordKey?: string | null`.
  Root: `isRevision=false`, sem predecessor, `revisionNumber=1`. Revisão:
  predecessor obrigatório (resolvível no lote ou já persistido), mesma
  `sourceKey`/`instrumentVersionId`/`timeframe`/`openedAt`,
  `revisionNumber = predecessor.revisionNumber + 1`, `sourceAvailableAt`
  estritamente posterior ao do predecessor.
- Cronologia cross-run: quando o predecessor foi criado por uma run
  **diferente** da run atual, o `completedAt` desta run deve ser
  estritamente posterior ao `completedAt` da run que criou o predecessor
  (decisão de design: quando o predecessor foi criado **na mesma run**/
  mesmo lote atômico, essa checagem é dispensada — não há "viagem no
  tempo" a proteger dentro de um único commit atômico, e a ordem já é
  garantida pela ordenação topológica do lote; isto permite cadeias
  profundas root→revisão dentro de um único batch, exercido no teste de
  cadeia com 5 revisões fora de ordem).
- Ordenação topológica determinística das submissions no lote (profundidade
  da cadeia, depois `sourceRecordKey`) + detecção de ciclo
  (`BarChainViolationError`) e de `sourceRecordKey` duplicada no mesmo lote
  (erro mesmo se idêntica — `DuplicateSourceRecordError`).
- Reenvio do MESMO `sourceRecordKey` já persistido com conteúdo e identidade de cadeia integralmente idênticos (`isRevision`/predecessor incluídos) é no-op idempotente; qualquer divergência é `BarConflictError`.
- Nova root para cadeia já existente (mesma
  `instrumentVersionId`/`timeframe`/`sourceKey`/`openedAt`) é
  `BarChainViolationError`. Conteúdo divergente nunca vira revisão
  automática — exige `isRevision=true` + `supersedesSourceRecordKey`
  explícito.
- Predecessor já supersedido por outra barra (bifurcação) →
  `PredecessorAlreadySupersededError`, detectado tanto na validação quanto
  via captura de `P2002` na constraint única `supersedesBarId`.
- Toda violação `P2002` do Prisma é capturada e convertida em erro de
  domínio tipado — nunca vaza `PrismaClientKnownRequestError` (mesmo padrão
  do adapter CVM).

## Tempos e point-in-time

- `openedAt < closedAt` (ambos explícitos); `closedAt <= sourceAvailableAt
  <= completedAt` da run atual. Timestamps ISO-8601 com offset explícito,
  precisão máxima de milissegundo (mesma regra de `hasAtMostMillisecondPrecision`
  do adapter CVM/reference-data).
- Leitura recebe `MarketBarPointInTimeView { decisionTime, knowledgeTime }`;
  rejeita `knowledgeTime > decisionTime`.
- Visibilidade: `closedAt <= decisionTime`, `sourceAvailableAt <=
  decisionTime`, e a run criadora `SUCCEEDED` com `completedAt <=
  knowledgeTime`.
- Para cada `openedAt` distinto, o repositório seleciona a MAIOR
  `revisionNumber` visível antes de qualquer projeção adicional — uma
  revisão futura nunca suprime seu predecessor ainda visível.

## Valores exatos

- `openRaw/highRaw/lowRaw/closeRaw`: `BigInt` estritamente positivo (`>=
  1`), cabendo em signed 64-bit; `priceScalePow: Int` no intervalo técnico
  fechado `[-18,18]`, compartilhado; preço real = `raw * 10^priceScalePow`.
  Esse limite é um contrato de segurança computacional para impedir expansão
  decimal patológica em consumidores futuros; não é um filtro de plausibilidade
  econômica. Valores de fonte fora do contrato exigem revisão explícita do
  formato, nunca truncamento ou coerção silenciosa.
- Validação cruzada OHLC: `high >= open/close/low`; `low <= open/close/high`.
- `volumeRaw: BigInt` obrigatório, não-negativo, signed 64-bit;
  `volumeScalePow: Int` no mesmo intervalo técnico `[-18,18]`; `volumeSemantics: TICKS | CONTRACTS | SHARES |
  NOTIONAL`.
- `tradeCount: BigInt?` opcional, não-negativo se presente.
- `priceBasis: TRADE | MID | BID | ASK`; `quality: FINAL | PROVISIONAL |
  ESTIMATED | CORRECTED`.
- `rawSha256`: 64 caracteres hexadecimais minúsculos, validado por regex.

## Modelo Prisma

Nome escolhido: `VersionedMarketBar` (sugerido no enunciado, sem conflito
com `MarketData`/`HistoricalCandle`). Campos e constraints conforme
especificação; `supersedesBarId` auto-relação `@unique` (self-relation
`MarketBarRevisionChain`, mesmo padrão de `CvmFiling.supersedesFilingId`).

Índices/uniques:
- `@@unique([instrumentVersionId, timeframe, sourceKey, openedAt, revisionNumber])`
- `@@unique([sourceKey, sourceRecordKey])`
- `@@index([instrumentVersionId, timeframe, sourceKey, openedAt])`
- `@@index([createdByRunId])`
- `@@index([sourceAvailableAt])`

## Migration

Gerada e validada com um banco SQLite temporário fora do repositório,
nunca `prisma/dev.db`:

```bash
TMPDB=$(mktemp -d)
DATABASE_URL="file:$TMPDB/temp.db" npx prisma migrate deploy   # aplica as 4 migrations existentes
DATABASE_URL="file:$TMPDB/temp.db" npx prisma migrate dev --name add_market_bar_foundation --create-only
# gera prisma/migrations/20260713131546_add_market_bar_foundation/migration.sql
# (o --create-only não aplica no banco temporário; o arquivo .sql já é
# escrito diretamente em prisma/migrations/ do projeto real, que é onde
# ele deve permanecer)
rm -rf "$TMPDB"

# Verificação de não-drift em um segundo banco temporário limpo:
TMPDB2=$(mktemp -d)
DATABASE_URL="file:$TMPDB2/verify.db" npx prisma migrate deploy
DATABASE_URL="file:$TMPDB2/verify.db" npx prisma migrate status  # "Database schema is up to date!"
rm -rf "$TMPDB2"

npx prisma generate   # regenera o Prisma Client com os novos tipos
```

A migration contém apenas `CREATE TABLE "VersionedMarketBar"` e `CREATE
(UNIQUE) INDEX` — nenhum `ALTER TABLE`/`DROP TABLE`/`DROP INDEX`, verificado
também via asserção automatizada no harness de teste.

## Ports e código

- `src/domain/v1/models/versioned-market-bar.ts`: `VersionedMarketBar`,
  `VersionedMarketBarSubmission`, `MarketBarPointInTimeView`,
  `VolumeSemantics`, `PriceBasis`, `MarketBarQuality`.
- `src/domain/v1/ports/market-bar-ingestion-unit-of-work.ts`:
  `MarketBarIngestionUnitOfWork`, `MarketBarIngestionBatch`.
- `src/domain/v1/ports/market-bar-repository.ts`: `MarketBarRepository`.
- `src/adapters/prisma/market-bar/`: `normalize.ts`, `schemas.ts`
  (validação Zod estrita), `errors.ts` (erros tipados), `mapping.ts`
  (linha Prisma → domínio), `unit-of-work.ts`
  (`PrismaMarketBarIngestionUnitOfWork`), `repository.ts`
  (`PrismaMarketBarRepository`), `timestamps.ts`, `index.ts` (barrel).

## Escopo de arquivos

Permitidos (todos tocados nesta implementação):
- `prisma/schema.prisma` (apenas relações aditivas + novo modelo);
- nova migration `prisma/migrations/20260713131546_add_market_bar_foundation/migration.sql`;
- `src/domain/v1/models/versioned-market-bar.ts` + atualização de
  `src/domain/v1/models/index.ts`;
- `src/domain/v1/ports/market-bar-ingestion-unit-of-work.ts`,
  `src/domain/v1/ports/market-bar-repository.ts` + atualização de
  `src/domain/v1/ports/index.ts`;
- `src/adapters/prisma/market-bar/**`;
- `scripts/market-bar/**`;
- script `test:market-bar` em `package.json`;
- este documento.

Proibidos e respeitados:
- `docs/CODEX_HANDOFF.md` não foi tocado;
- nenhuma alteração em `src/app`, UI, Electron, Python, MT5 real;
- `prisma/dev.db` nunca foi usado — apenas bancos SQLite temporários
  (`os.tmpdir()`), removidos em `finally`.

## Gates de teste (todos executados, ver relatório de execução)

- migration estritamente aditiva (sem `ALTER`/`DROP`), índices únicos
  presentes;
- lifecycle completo da unit of work (RUNNING → SUCCEEDED/FAILED, CAS,
  rollback em erro no meio do lote);
- rejeições: instrumento desconhecido, `InstrumentVersion` ainda não
  conhecida point-in-time, `openedAt` fora do intervalo conhecido;
- validação de timestamps/ordem (`openedAt < closedAt <= sourceAvailableAt
  <= completedAt`);
- limites BigInt int64 min/max, preços estritamente positivos, validação
  cruzada OHLC, volume/tradeCount não-negativos;
- cadeias root/revisão: revisão válida, predecessor errado, predecessor
  desconhecido, predecessor já superseded (bifurcação), ciclo, cadeia
  profunda (5 revisões) fora de ordem no lote;
- `sourceRecordKey` idempotente vs divergente; duplicata no mesmo lote
  (erro mesmo idêntica);
- revisão futura não vaza com `knowledgeTime` anterior; `sourceAvailableAt`
  futuro não visível; `knowledgeTime > decisionTime` rejeitado;
- duas fontes coexistindo sem fusão; `sourceKey` obrigatório; regra SQX
  restrita a WIN/WDO (erro e sucesso);
- timeframes diário/semanal com `closedAt` explícito;
- regressões: `test:reference-data`, `test:cvm-facts`,
  `smoke:domain-contracts`, `tsc --noEmit` no projeto inteiro.

## Pendências / limitações conhecidas

- Nenhuma ingestão real (MT5/B3/SQX) foi implementada — apenas a
  fundação de persistência e os contratos de leitura/escrita.
- A regra SQX é intencionalmente unidirecional (sqx ⇒ WIN/WDO); ela não
  impede que um símbolo WIN/WDO seja ingerido por uma fonte não-SQX.
- Reconciliação automática de revisões fora de ordem (predecessor ainda
  não existente) está fora do escopo — o chamador deve reenviar depois
  que o predecessor existir, mesmo padrão adotado em `phase-2-item-2-cvm-facts.md`.
