# Fase 2 / Item 1 — Fundação de Dados de Referência (Issuer + Instrument + IngestionRun)

Status: fundação implementada e testada. Sem backfill, sem consumidores/rotas/UI/serviços/Python/MT5 alterados. Sem ingestão CVM real — esta é apenas a fundação de dados/domínio/repositório.

## Objetivo

Prover uma base aditiva, bitemporal e transacionalmente segura para dados de referência (emissores e instrumentos), preparando o terreno para ingestão futura (ex.: CVM) sem tocar em nenhum modelo, rota ou serviço existente.

## Modelos Prisma (aditivos)

Adicionados ao final de `prisma/schema.prisma`, sem alterar nenhum modelo existente:

- **`IngestionRun`** — ledger de execuções de ingestão. `sourceKey` é uma `String` livre e normalizada, sem relação com o modelo legado `DataSource`. Estados: `RUNNING → SUCCEEDED | FAILED` (transição única, imposta em runtime pela unit of work, não por triggers SQL).
- **`Issuer`** — identidade estável e imutável de emissor, chaveada por `cvmCode` único. `cnpj` é opcional e único quando presente (múltiplos `NULL` são aceitos pelo SQLite/Prisma — `UNIQUE` não colide com `NULL`).
- **`InstrumentVersion`** — versão SCD-2 de instrumento, com intervalo semiaberto `[validFrom, validTo)`. `priceScalePow`/`quantityScalePow` são **expoentes decimais** (`quantum = 10^scalePow`, podendo ser negativo), não fatores multiplicativos. `lotSize` é o lote padrão em unidades inteiras.

Nenhuma FK aponta para `Asset`/`DataSource`/demais modelos legados. A tradução entre o id canônico (`cuid`) deste subsistema e o `symbol` usado hoje pelo restante do app é **escopo futuro** — nenhuma migração de UI foi feita.

### Migração

`prisma/migrations/20260712000000_add_reference_data_foundation/migration.sql` contém **apenas** `CREATE TABLE`/`CREATE INDEX` — nenhum `ALTER`/`DROP` de tabela existente. Gerada e validada exclusivamente contra um SQLite temporário fora do repositório (nunca contra `prisma/dev.db`):

```bash
# 1. diff via shadow database temporário
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "file:<tmp>/shadow.db" --script

# 2. validação: aplicar as 3 migrations (incluindo a nova) num banco novo e
#    confirmar que um segundo diff fica vazio (schema == histórico de migrations)
npx prisma migrate deploy   # com DATABASE_URL apontando para <tmp>/validate.db
npx prisma migrate diff ... # diff vazio confirma nenhum drift
```

`prisma/migrations/` é ignorado pelo Git neste repositório (`.gitignore`), como já era o caso das duas migrations anteriores — convenção preexistente, não alterada por este trabalho.

## Modelos de domínio (`src/domain/v1/models/`)

- `ingestion.ts` — `IngestionRun`, `IngestionRunStatus`, `IngestionSourceKey`, `KnowledgeView` (contrato de leitura bitemporal: `knowledgeTime` inclusivo).
- `issuer.ts` — `Issuer`, `IssuerRegistration`.
- `instrument-version.ts` — `InstrumentVersion`, `InstrumentVersionInput`, `ValidFromBasis`, `InstrumentLifecycleStatus`.

Nenhum arquivo de domínio lê o relógio (`Date.now`) nem importa Prisma/Next/Electron — verificado pelo `smoke:domain-contracts` já existente, que varre `src/domain/**` procurando por esses acoplamentos.

`InstrumentVersionInput.validFrom` é **opcional**: obrigatório em runtime quando `validFromBasis === 'SOURCE_EFFECTIVE'`, e omissível quando `'OBSERVED_AT'` — nesse caso a unit of work o preenche, de forma conservadora, com o `completedAt` da run (nunca fingindo ser um instante declarado pela fonte).

## Portas (`src/domain/v1/ports/`)

- **`IngestionLedger`** — leitura do ledger de runs.
- **`IssuerRepository`** / **`InstrumentRepository`** — leitura **as-known-at** (e, para instrumentos, adicionalmente **as-of** no tempo de negócio).
- **`ReferenceDataIngestionUnitOfWork`** — único caminho de escrita: `begin` → (`commit` **xor** `fail`, exatamente uma vez).

As portas de leitura são deliberadamente separadas da unit of work de mutação: nada fora do adapter `PrismaReferenceDataIngestionUnitOfWork` escreve nessas três tabelas.

## Adapter Prisma (`src/adapters/prisma/reference-data/`)

| Arquivo | Responsabilidade |
|---|---|
| `normalize.ts` | normalização pura (trim/case/dígitos) de `sourceKey`, `cvmCode`, `cnpj`, `symbol`, `exchange`, `currency`. |
| `schemas.ts` | validação Zod **estrita** na fronteira do adapter — todo valor que entra na unit of work ou sai como argumento de "view" passa por aqui primeiro. |
| `errors.ts` | hierarquia de erros de domínio do adapter (`RunNotRunningError`, `IssuerIdentityConflictError`, `DuplicateCnpjError`, `UnknownIssuerReferenceError`, `InstrumentIntervalConflictError`, `InvalidReferenceDataInputError`). |
| `mapping.ts` | conversão linha-Prisma → modelo de domínio; é o único lugar que decide o `validTo`/`closedByRunId` **efetivos** de uma leitura bitemporal. |
| `unit-of-work.ts` | `PrismaReferenceDataIngestionUnitOfWork` — único caminho de escrita. |
| `ingestion-ledger.ts`, `issuer-repository.ts`, `instrument-repository.ts` | implementações de leitura. |

### Atomicidade (`commit`)

`PrismaReferenceDataIngestionUnitOfWork.commit` executa, em **um único** `prisma.$transaction`:

1. valida que a run está `RUNNING` (senão `RunNotRunningError`, fail closed);
2. processa o lote de emissores — `cvmCode` novo é criado; `cvmCode` já existente com **identidade idêntica** (mesmo `cnpj` e `name`) é tratado como reenvio idempotente (não duplica); `cvmCode` já existente com identidade **diferente** falha fechado com `IssuerIdentityConflictError` — nunca há atualização destrutiva (SCD-1);
3. resolve referências `issuerCvmCode` de instrumentos (no próprio lote ou já persistidas); referência desconhecida falha fechado com `UnknownIssuerReferenceError`;
4. para cada versão de instrumento, dentro da mesma transação: fecha o intervalo aberto anterior de `(symbol, exchange)` exatamente no `validFrom` da nova versão (rejeitando se o novo `validFrom` não for estritamente posterior), rejeita sobreposição com intervalos já fechados (`InstrumentIntervalConflictError`) e insere a nova versão aberta;
5. transiciona a run para `SUCCEEDED` com `completedAt`/`summary`.

Qualquer falha em qualquer etapa reverte a transação inteira — nenhuma linha de emissor/instrumento fica parcialmente gravada, e a run permanece `RUNNING` (podendo ser corrigida e re-commitada, ou explicitamente `fail()`ada). Isso é coberto pelo teste `full rollback` em `scripts/reference-data/reference-data-test.ts`.

`fail(runId, completedAt, summary)` é uma transição isolada `RUNNING → FAILED`; nunca toca linhas de emissor/instrumento. As duas transições terminais usam compare-and-set (`id + status=RUNNING`) por `updateMany` e exigem `count === 1`, além da leitura/validação anterior.

### Leitura bitemporal

`knowledgeTime` (tempo de sistema) e, para instrumentos, `asOf` (tempo de negócio) são dois eixos independentes:

- **as-known-at**: uma linha só é visível se sua `createdByRun` atingiu `SUCCEEDED` com `completedAt <= knowledgeTime`.
- Para o fechamento de um intervalo (`validTo`/`closedByRunId`), a mesma regra vale **para a run que fechou**: se `closedByRun.completedAt > knowledgeTime` (ou a run de fechamento ainda não completou), o repositório reporta o intervalo como **ainda aberto** naquela visão — mesmo que, fisicamente, a linha no banco já tenha `validTo` preenchido por uma run posterior já commitada. Um fechamento registrado por uma run futura nunca "vaza" para uma visão de conhecimento anterior. Isso é a garantia central testada em `bitemporalVisibilityTests` (`scripts/reference-data/reference-data-test.ts`), incluindo o caso onde a consulta é feita **depois** de a run de fechamento já ter sido commitada no banco, mas com um `knowledgeTime` anterior à conclusão dela.
- **as-of** adicionalmente restringe ao intervalo de negócio `[validFrom, validTo)` que contém o instante consultado — fronteira inclusiva em `validFrom`, exclusiva em `validTo` (testado explicitamente nos limites).

## Testes (`npm run test:reference-data`)

`scripts/reference-data/run-reference-data-tests.cjs`:

1. compila `scripts/reference-data/reference-data-test.ts` com um `tsconfig.json` dedicado (mesmo padrão de `scripts/mt5`/`scripts/workflow`);
2. cria um SQLite **temporário e descartável** fora do repositório (`os.tmpdir()`), nunca `prisma/dev.db`;
3. aplica as migrations nesse banco via `prisma migrate deploy` (invocando `node_modules/prisma/build/index.js` diretamente — evita depender de `npx`/shell no Windows);
4. roda os testes compilados apontando `DATABASE_URL` para esse banco;
5. em `finally`, remove tanto o diretório `.dist` quanto o diretório temporário do banco — mesmo se qualquer etapa acima lançar.

Cobertura: ciclo de vida da run (guards fail-closed em `commit`/`fail` fora de `RUNNING`), identidade de emissor (conflito, reenvio idempotente, `cnpj` `NULL` múltiplo, `cnpj` duplicado entre `cvmCode`s), SCD-2 (fechamento exato no novo `validFrom`, rejeição de duplicata/sobreposição/anterior-ao-aberto, fronteiras `as-of` exatas), `OBSERVED_AT` sem `validFrom` explícito, visibilidade bitemporal (incluindo o caso de vazamento de fechamento futuro), integridade referencial de emissor (FK desconhecida, resolução no mesmo lote), rollback completo de lote, e um teste estático de aditividade da migração (garante que o `.sql` só contém `CREATE TABLE`/`CREATE INDEX`).

Executado duas vezes consecutivas neste trabalho para confirmar determinismo (mesmo banco temporário recriado do zero a cada execução, sem estado compartilhado entre execuções).

## Limitações conhecidas (em aberto, deliberadamente fora de escopo)

1. **Precisão temporal**: o domínio neutro `src/domain/v1/time.ts` suporta microssegundos, mas este adapter Prisma/SQLite aceita no máximo três casas decimais. Entradas sub-milissegundo são rejeitadas na fronteira; não há truncamento silencioso.
2. **Sem tradução canônica**: a ponte entre o `id` (`cuid`) deste subsistema e o `symbol` usado hoje pelo resto do app (`Asset.symbol`, MT5, etc.) não existe ainda — é escopo futuro, conforme decisão do Guardian.
3. **Sem perfis históricos de emissor**: `Issuer` é uma identidade única e estável; alterações de `name`/`cnpj` ao longo do tempo não são versionadas (apenas rejeitadas como conflito). Perfis históricos de emissor são escopo futuro.
4. **Sem ingestão real da CVM**: não há nenhum cliente HTTP, parser de portal CVM ou agendador. Esta entrega é só a fundação de domínio/repositório/transação.
5. **Concorrência**: a detecção de sobreposição/duplicata de `InstrumentVersion` é feita por leitura-então-escrita dentro da mesma transação Prisma. SQLite serializa escritores; o índice único e o tratamento de `P2002` fornecem defesa adicional. As transições de run usam compare-and-set, mas testes concorrentes sujeitos a `SQLITE_BUSY` não são tratados como prova portátil para outro banco.
6. **Histórico tardio é um gate bloqueante**: a unit of work atual aceita uma cadeia completa desordenada quando ela chega no mesmo lote vazio, ordenando-a antes de persistir, e depois aceita somente versões cronologicamente crescentes. Se já existe uma versão corrente, uma descoberta histórica com `validFrom` anterior falha fechado. Antes de qualquer ingestão CVM/B3 histórica sobre instrumentos já presentes, deve existir desenho e teste específico para reconstrução atômica da cadeia SCD-2 e política de late-arriving data. Não iniciar backfill sem fechar esse gate.
7. **Entrega da migration**: `prisma/migrations/` é ignorado pela regra histórica do repositório. O arquivo `20260712000000_add_reference_data_foundation/migration.sql` precisa ser incluído explicitamente com staging forçado e verificado no índice Git antes do commit; alterar o `.gitignore` está fora deste item.
