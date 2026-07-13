# Fase 2 / Item 2 — CVM Filings e Fatos Point-in-Time

Status: arquitetura aprovada para implementação aditiva. Sem ingestão live, backfill, UI, MT5 ou alteração de modelos legados.

## Objetivo

Adicionar `CvmFiling`, `CvmFact` e `ShareCapitalFact` com proveniência imutável, valores exatos e consultas point-in-time sem lookahead.

## Dois tempos obrigatoriamente distintos

- `publishedAt`: instante em que o documento se tornou publicamente disponível; eixo de disponibilidade de mercado.
- `createdByRun.completedAt`: instante em que a plataforma concluiu com sucesso a ingestão; eixo `knowledgeTime` da plataforma.

`referenceDate`, `periodStart` e `periodEnd` são datas contábeis e nunca provam disponibilidade.

Toda consulta histórica recebe:

```ts
interface CvmPointInTimeView {
  readonly decisionTime: string;
  readonly knowledgeTime: string;
}
```

A fronteira rejeita `knowledgeTime > decisionTime`. Uma linha é visível somente quando:

1. `filing.publishedAt <= decisionTime`;
2. `createdByRun.status === 'SUCCEEDED'`;
3. `createdByRun.completedAt <= knowledgeTime`.

`knowledgeTime` não é persistido em `CvmFact` ou `ShareCapitalFact`; é derivado da run criadora para evitar drift.

## Decisões de modelagem

### Datas e instantes

- `referenceDate`, `periodStart`, `periodEnd`: `String` civil `YYYY-MM-DD` validada estritamente.
- `filedAt`, `publishedAt`: Prisma `DateTime`, entrada/saída ISO-8601 com offset explícito e precisão máxima de milissegundo.
- `filedAt <= publishedAt`.

### CvmFiling

Campos mínimos:

- `issuerId` → `Issuer` já existente;
- `documentType`: `DFP | ITR | FRE`;
- `cvmProtocol` globalmente único;
- `referenceDate`, `fiscalYear`, `fiscalQuarter`;
- `filedAt`, `publishedAt`;
- `versionNumber`, `isRestatement`;
- auto-relação `supersedesFilingId`;
- `sourceUrl`, `rawSha256` lowercase hexadecimal de 64 caracteres;
- `createdByRunId` → `IngestionRun`.

Política:

- primeira versão: `versionNumber=1`, `isRestatement=false`, sem predecessor;
- retificação: `isRestatement=true`, predecessor obrigatório, mesmo issuer/tipo/referenceDate, `publishedAt` estritamente posterior e `versionNumber = predecessor.versionNumber + 1`;
- predecessor já supersedido por outro documento causa conflito;
- `supersedesFilingId` possui índice único e `(issuerId, documentType, referenceDate, versionNumber)` possui chave única, reforçando as invariantes também sob concorrência;
- protocolo existente com conteúdo e metadados integralmente idênticos é reenvio idempotente;
- mesmo protocolo com qualquer divergência, inclusive hash, falha fechado;
- hash igual sob outro protocolo pode ser aceito se a identidade e a cadeia de versão forem válidas;
- nenhuma linha anterior é atualizada ou apagada.

### CvmFact

Campos:

- `filingId`, `issuerId`, `createdByRunId`;
- `statementType`: `BPA | BPP | DRE | DFC_MD | DFC_MI | DVA | DMPL`;
- `scope`: `CON | IND`;
- `accountCode`, `accountLabel`;
- `periodStart` não nullable e `periodEnd`;
- `durationType`: `INSTANT | DURATION`;
- `valueRaw: BigInt`, `scalePow: Int`, `originalScale: UNIT | THOUSAND | MILLION`, `currency`;
- `quality: AUDITED | REVIEWED | UNAUDITED | RESTATED`.

Valor real = `valueRaw * 10^scalePow`. `originalScale` preserva a representação declarada pela fonte; não se presume que `scalePow` seja zero.

Para `INSTANT`, `periodStart === periodEnd`; nenhum `NULL` é usado em chave única. Para `DURATION`, `periodStart <= periodEnd`.

Valores aceitos somente no intervalo SQLite signed 64-bit:
`[-9223372036854775808, 9223372036854775807]`.
Não aplicar limite de plausibilidade arbitrário neste item.

Unicidade dentro do filing:
`filingId + statementType + scope + accountCode + periodStart + periodEnd`.
Duplicata exata dentro do mesmo lote falha fechado; não há last-write-wins. Reenvio posterior da mesma chave com conteúdo integralmente idêntico é no-op idempotente; qualquer divergência falha fechado.

### ShareCapitalFact

Campos:

- `filingId`, `issuerId`, `createdByRunId`;
- `shareClass` normalizada;
- `periodStart === periodEnd` e ambos não nullable;
- `quantity: BigInt` não negativa e signed 64-bit;
- `quantityType`: `ISSUED | OUTSTANDING | TREASURY`;
- `quality`.

Unicidade:
`filingId + shareClass + periodEnd + quantityType`.

## Unit of Work

Criar `CvmIngestionUnitOfWork` separada da Unit of Work de referência.

Fluxo:

```text
begin(sourceKey, startedAt)
  -> commit(runId, completedAt, summary, batch)
  xor fail(runId, completedAt, summary)
```

O commit, em uma única transação:

1. valida run RUNNING e cronologia;
2. exige todos os emissores previamente existentes;
3. valida filings, idempotência e cadeias de retificação;
4. resolve referências dos fatos por `filingCvmProtocol` no lote ou no banco;
5. garante que issuer do fato seja o mesmo do filing;
6. insere filings/fatos/capital em ordem canônica;
7. transiciona run com CAS para SUCCEEDED.

Qualquer erro reverte tudo. `fail` usa CAS e não toca fatos.

Late/out-of-order restatement falha fechado e deverá ser reenviado depois que o predecessor existir. Reconciliação automática fica fora do escopo.

## Repositórios

- `CvmFilingRepository`: busca por protocolo e listagem por emissor/tipo/referenceDate sob `CvmPointInTimeView`.
- `CvmFactRepository`: fatos por emissor, conta, demonstrativo, escopo e período sob a mesma view.
- `ShareCapitalFactRepository`: capital por emissor, classe, tipo e período sob a mesma view.

As consultas preservam todas as versões, mas devem oferecer seleção efetiva que não devolva simultaneamente uma versão superseded e sua retificação quando ambas já eram públicas e conhecidas na view. A escolha efetiva é a maior versão visível da mesma cadeia; nenhuma retificação futura vaza para uma view anterior.

## Escopo de arquivos

Permitidos:

- `prisma/schema.prisma`;
- nova migration `prisma/migrations/*_add_cvm_facts_foundation/migration.sql`;
- novos modelos/ports em `src/domain/v1` e respectivos indexes;
- novo adapter `src/adapters/prisma/cvm/**`;
- testes `scripts/cvm-facts/**`;
- script `test:cvm-facts` em `package.json`;
- este documento.

Proibidos:

- `docs/CODEX_HANDOFF.md`;
- `src/app`, UI, serviços legados, Electron, Python e MT5;
- bancos reais, `prisma/dev.db`, backfill ou rede.

## Gates de teste

- migration estritamente aditiva;
- lifecycle/CAS/rollback;
- protocolo+hash idempotente e conflitos;
- cadeia de retificação e visibilidade anterior/posterior;
- separação `publishedAt`/`knowledgeTime`;
- rejeição de `knowledgeTime > decisionTime`;
- INSTANT sem NULL e DURATION cronológico;
- limites BigInt signed 64-bit;
- duplicatas de fatos;
- capital por classe/tipo;
- issuer e filing desconhecidos;
- ordem canônica e resultado determinístico;
- testes em SQLite temporário no WSL e Windows;
- domínio sem Prisma/relógio/rede;
- regressões existentes.
