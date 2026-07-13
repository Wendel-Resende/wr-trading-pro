# Fase 2 / Item 5 — DatasetSnapshot e FeatureValue com `knowledgeTime`

Status: **especificação pronta para implementação aditiva**.
Sem ingestão live, backfill, UI, MT5, rede ou banco real.
Sem tocar `MarketData`/`HistoricalCandle`/serviços legados.
Sem habilitação de ML/agent scoring; esta camada é apenas leitura e metadados.

## Problema

A UI e ferramentas futuras precisam saber, em um ponto de decisão,
o estado **exato** do repositório de dados:
- ingestões concluídas;
- contagem de registros por domínio;
- última atualização conhecida.
Sem isso, qualquer dashboard pode exibir números de “última atualização”
sem verdadeira fundamentação point-in-time.

## Objetivo

Adicionar dois read models:
- `DatasetSnapshot`: metadados point-in-time do conjunto de dados;
- `FeatureValue`: valores de atributo/fatura imutáveis com `knowledgeTime`,
  estritamente separados de qualquer modelo de ML, agente ou scoring.

## Princípio fixo

- **Somente leitura**: nenhuma rota ou método de escrita é exposto;
- **API reuse**: o Item 4 já demonstrou como compor HTTP GET com
  validação Zod, provenance e serialização segura;
- **Sem lookahead**: `knowledgeTime <= decisionTime` sempre;
- **BigInt exato**: todo número financeiro permanece como `BigInt + scalePow`,
  sem `Float`/`Decimal`;
- **Identidade canônica**: usar IDs, não símbolos como chave única;
- **Append-only**: snapshots e features não são apagados/atualizados,
  novas entrys são inserções atômicas identadas por `knowledgeTime`.

## 1. DatasetSnapshot

Finalidade: “o que o repositório sabia/sabia fazer até o instante X?”

Campos sugeridos:

- `snapshotId`: identificador imutável;
- `asOf`: data/hora do snapshot (civil + offset);
- `knowledgeTime`:
  instante em que o sistema passou a conhecer/exibir este snapshot;
  `knowledgeTime <= decisionTime`;
- `decisionTime`:
  instante externo de decisão a que este snapshot se refere;
- `domains`: mapa JSON com contagens por domínio:
  - `referenceData.issuers`
  - `referenceData.instrumentVersions`
  - `cvm.filings`
  - `cvm.facts`
  - `cvm.shareCapitalFacts`
  - `marketBars.count`
- `provenance.runId`: `IngestionRun` que produziu/escreveu este snapshot;
- `createdAt`: timestamp back-end de insert real (sempre > knowledgeTime).

Regra: duas linhas com o mesmo `decisionTime` NÃO são conflitantes se
tiverem `knowledgeTime` distintos — representam estados diferentes
de conhecimento ao longo do tempo.

Consulta pública:
```ts
interface DatasetSnapshotQuery {
  readonly decisionTime: string;
  readonly knowledgeTime?: string;
  readonly from?: string;
  readonly to?: string;
}
```
Se `knowledgeTime === undefined` assume `decisionTime`.
Aplicar `knowledgeTime <= decisionTime` como Zod `.strict()` cross-field;
senão 400.

API pública prevista:
- `GET /api/v1/dataset/snapshot`
  query: `decisionTime`, `knowledgeTime?`, `from?`, `to?`
  resposta: lista ordenada por `knowledgeTime ASC` com counts e provenance.

## 2. FeatureValue

Finalidade: **somente valores de feature brutos já calculados e aprovados**.
NÃO é um motor de ML; não aplica scoring, ranking, sinal, decisão,
anomalia ou texto de agente. A intenção é dar transparência point-in-time
a valores que já existem em outro lugar, sem torná-los “verdades financeiras”
se já não o forem.

Tipos aceitos:
- `STRING`
- `BIGINT` — decimal exato em pair `{raw, scalePow}`
- `DATE` — `YYYY-MM-DD`
- `ENUM` — set fechado já modelado em `src/domain/v1`

Proibidos:
- `FLOAT`
- classificações de sinal
- narrativas de agente

Campos sugeridos:
- `featureId`: identificador canônico;
- `knowledgeTime`/`decisionTime`: eixos point-in-time;
- `sourceKey`: exatamente derivado da IngestionRun criadora, igual ao `VersionedMarketBar`;
- `subjectId`: ID canônico do instrumento/issuer;
- `featureType`: um dos tipos acima;
- `valueRaw`: string ou bigint;
- `scalePow?`: obrigatório quando `featureType === 'BIGINT'`; intervalo `[-18,18]`;
- `enumValue?`: obrigatório quando `featureType === 'ENUM'`;
- `label?`: opcional para exibição humana;
- `provenance.runId`: referência à run criadora.

Imutabilidade:
- `FeatureValue` é append-only.
- Para “atualizar”, insira nova entry com `knowledgeTime` posterior.
- O passado nunca é alterado; histories anteriores continuam válidas.

Validação:
- `knowledgeTime <= decisionTime`;
- `sourceKey` igual ao da run;
- `featureType === 'BIGINT'` implica `scalePow` em `[-18,18]`;
- máximo razoável de payload: `valueRaw.length <= 200`.

API pública prevista:
- `GET /api/v1/features/values`
  query: `featureId?`, `subjectId?`, `decisionTime?`, `knowledgeTime?`, `from?`, `to?`
  resposta: série ordenada por `knowledgeTime ASC`, sem aplicar qualquer cálculo.

## Modelagem Prisma

Restrições para este item:

- **Não criar migration de alteração em tabelas existentes**.
- SQLite aceita JSON em campo `TEXT`; usar `TEXT` para `domains` e `valueRaw`.
- Nova migration deve conter apenas `CREATE TABLE` e `CREATE INDEX`.
- Tabelas esperadas:
  - `DatasetSnapshot`
  - `FeatureValue`

Campos índices relevantes:
- `@@index([decisionTime, knowledgeTime])` em ambas tabelas;
- `@@index([subjectId, featureType, knowledgeTime])` em `FeatureValue`;
- `@@unique([featureId, decisionTime, knowledgeTime])` em `FeatureValue`.

## Ports e camada HTTP

Seguir o mesmo padrão do Item 4:
- serviço em `src/application/dataset-snapshot/` (puro, sem I/O direto);
- assemblers puros e DTOs serializados;
- rotas em `src/app/api/v1/dataset/snapshot/route.ts`
  e `src/app/api/v1/features/values/route.ts`;
- `_shared/http.ts` reutilizado do Item 4;
- nenhum método `POST/PUT/PATCH/DELETE` exportado.

## Testes obrigatórios

Harness em `scripts/dataset-feature/` usando SQLite temporário,igual ao padrão do Item 3/4.

Cobertura mínima:

1. migração aditiva aplicada sem alterar schema existente;
2. `knowledgeTime <= decisionTime` rejeitado na borda HTTP nos dois endpoints;
3. `DatasetSnapshot` ordenação determinística por `knowledgeTime ASC`;
4. `FeatureValue` com `BIGINT` preserva `scalePow [-18,18]` sem float;
5. `FeatureValue` sem tipos proibidos (`FLOAT`, scoring, texto de agente);
6. idempotência: mesma `featureId/decisionTime/knowledgeTime` com conteúdo igual é no-op ou rejeitado por constraint única antes de escrita;
7. append-only: deleções e updates via repo são bloqueados;
8. paginação determinística em ambos endpoints;
9. erro interno sanitizado sem vazar stack/SQL/Prisma;
10. caller info/headers nunca vão para payload público;
11. regressões: `test:cvm-facts`, `test:market-bar`, `test:reference-data`,
    `smoke:auth`, `prisma validate`, `tsc --noEmit`, `electron:compile`,
    build Next.js em WSL e Windows.

## Escopo permitido

- `prisma/schema.prisma` (somente appends em novas tabelas, sem ALTER em tabelas existentes);
- nova migration `prisma/migrations/...add_dataset_feature_foundation/migration.sql`;
- `src/domain/v1/models/dataset-snapshot.ts`, `feature-value.ts`;
- `src/domain/v1/ports/dataset-snapshot-repository.ts`, `feature-value-repository.ts`;
- `src/adapters/prisma/dataset-snapshot/**`, `feature-value/**`;
- `src/application/dataset-snapshot/**`, `src/application/feature-value/**`;
- `src/app/api/v1/dataset/snapshot/route.ts`, `src/app/api/v1/features/values/route.ts`;
- `scripts/dataset-feature/**`, item em `package.json`;
- `docs/architecture/phase-2-item-5-dataset-feature.md`.

## Escopo proibido

- `docs/CODEX_HANDOFF.md`;
- `src/app` fora do prefixo `/api/v1/dataset` e `/api/v1/features`;
- qualquer endpoint de escrita, ML scoring, ranking ou execução financeira;
- alteração em `prisma/dev.db`, `HistoricalCandle`, `MarketData`,
  `historicalDataService`, `stockMonitoringService`, `tradingAgentsService`,
  `MLPredictionsTab`, `CTRL`/`KillSwitch`, rotas de trading/ordens.

## Decisões de arquitetura (não negociáveis para o Item 5)

1. Sem lookahead: `knowledgeTime <= decisionTime`.
2. Sem float canônico: valores financeiros permanecem em `BigInt + scalePow`.
3. Identidade por IDs (`subjectId`, `featureId`), nunca por símbolo solto.
4. Append-only: snapshots e features são só inserções; histórico não é
   sobrescrito nem removido.
5. Read model não altera nenhum módulo legado.
6. `FeatureValue` é apenas “valor observado em um dado knowledgeTime”,
   não decisão, não sinal, não narrativa.

## Próximo passo

1. Implementar em Claude Code Windows, mantendo o padrão de:
   - `phase-2-item-5-dataset-feature.md`;
   - schema Prisma + migration aditiva com assert de não-drift;
   - modelos/ports/adapter Riesgo;
   - testes em SQLite temporário e regressões WSL/Windows;
2. Revisar independentemente.
3. Rejeitar alterações em schema legado, endpoints de escrita ou ML scoring.
4. Somente após aprovação, fazer staging seletivo excluindo
   `docs/CODEX_HANDOFF.md`, rodar inspeção de segredos, commitar e push.
