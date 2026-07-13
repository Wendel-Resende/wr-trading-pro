# Fase 2 / Item 6 — Reconciliação e paridade com legado (somente leitura)

Status: **especificação para implementação aditiva e não destrutiva**.
Não elimina rotas, serviços, tabelas ou comportamentos legados.
Este item só introduz medição, comparação e decisão humana; nenhum
corte é automatizado.

## Problema

Após os Itens 1-5, o projeto possui fundações novas point-in-time:
- `Issuer`/`InstrumentVersion`/`IngestionRun`
- `VersionedMarketBar`
- `DatasetSnapshot`/`FeatureValue`
- CVM point-in-time

Ao mesmo tempo, rotas/serviços legados continuam respondendo a UI:
- `HistoricalCandle`/`MarketData`
- `historicalDataService`
- `stockMonitoringService`
- `stock-reports`/`stock-monitoring`
- `MLPredictionsTab`

Precisamos saber **se as novas fundações conseguem substituir os
legados** sem promover migração big-bang. O critério é paridade
observada, não intenção de engenharia.

## Objetivo

Adicionar uma camada de reconciliação que:
1. Apresente contagens/amostras por domínio novo vs legado.
2. Compare para um conjunto pequeno de instrumentos/tempo.
3. Produza um relatório de paridade estruturado para decisão humana.
4. NÃO desative, exclua ou reescreva dados legados.

## Princípios fixos

- **Somente leitura**: sem escrita, sem delete, sem migração.
- **Sem lookahead**: manter `knowledgeTime <= decisionTime`.
- **BigInt exato**: sem `Float`/`Decimal`.
- **Identidade canônica**: `instrumentVersionId`, `runId`, IDs.
- **UI não-canônica**: read models recebem proveniência, mas a UI
  legada continua funcionando até corte manual futuro.
- **Nenhuma ingestão, trading, rede ou banco real**.
- **`docs/CODEX_HANDOFF.md` não tocado**.

## 1. Modelo de reconciliação

### 1.1 Entidades de medição

Para cada domínio comparável, gerar contagens e amostras:

- `HistoricalCandle`/`MarketData` → `VersionedMarketBar`
- `CvmFact`/`ShareCapitalFact` existentes na nova fundação → contagem
  por emissor/tipo/referência
- `StockMonitoring` resumo → contagens de monitoramento/ativo

Domínios fora do escopo de paridade automatizada neste item:
- `MLPredictionsTab` é avaliação de modelo, não verdade factual;
- rotas de escrita legadas permanecem intactas;
- MT5 Profit/SQX permanecem como fontes vivas separadas.

### 1.2 Campos mínimos da comparação

```ts
interface ReconciliationRow {
  readonly domain: 'cvm-facts' | 'market-bars' | 'stock-monitoring';
  readonly legacySource: string;
  readonly newSource: string;
  readonly legacyCount: bigint | number;
  readonly newCount: bigint | number;
  readonly sampleLegacyIds: readonly string[];
  readonly sampleNewIds: readonly string[];
  readonly matchedSamples: number;
  readonly mismatchSamples: number;
  readonly decidedAt: string;
  readonly knowledgeTime: string;
  readonly decisionTime: string;
  readonly provenance: { runId: string; sourceKey: string };
}
```

- `matchedSamples`: amostras cujo identificador canônico/rótulo
  temporá́rio coincide.
- `mismatchSamples`: amostras divergentes ou não mapeáveis.

Regra: se `mismatchSamples > 0` em qualquer domínio, o relatório
marca **PARIDADE_PARCIAL**. Nenhum corte é sugerido/executado
automaticamente.

### 1.3 Relatório estruturado

```ts
interface ReconciliationReport {
  readonly reportId: string;
  readonly from: string;
  readonly to: string;
  readonly domains: ReconciliationRow[];
  readonly overall: 'PARIDADE' | 'PARIDADE_PARCIAL' | 'SEM_PARIDADE';
  readonly computedAt: string;
  readonly knowledgeTime: string;
  readonly decisionTime: string;
  readonly provenance: { runId: string; sourceKey: string };
}
```

- `PARIDADE`: amostras iguais em todos os domínios pedidos.
- `PARIDADE_PARCIAL`: pelo menos um domínio sem mismatch, outro com.
- `SEM_PARIDADE`: todos os domínios comparados apresentam mismatch.

## 2. APIs novas

Seguir o mesmo padrão do Item 4/5.

- `GET /api/v1/reconciliation/plan`
  query: `decisionTime`, `knowledgeTime?`, `domain?`, `subjectId?`, `limit?`, `offset?`
  resposta: `ReconciliationRow[]`
- `GET /api/v1/reconciliation/report`
  query: `decisionTime`, `knowledgeTime?`, `from?`, `to?`, `domain?`
  resposta: `ReconciliationReport`

Restrições:
- sem POST/PUT/PATCH/DELETE;
- sem alterar rotas legadas;
- sem alterar schema destes domínios, apenas criação nova.

## 3. Modelagem Prisma

Nova migration ADITIVA apenas.

Tabelas:
- `ReconciliationPlan`
- `ReconciliationReport`
- `ReconciliationRow`

Constraints/índices sugeridos:
- `@@index([domain, decisionTime, knowledgeTime])`
- `@@index([createdByRunId])`
- unique por `(planId, domain)` nas rows do relatório.

Uso de `TEXT` para JSON/campos livres; sem `ALTER` em tabelas
existentes.

## 4. Repositório e serviço

Adicionar:
- `src/domain/v1/models/reconciliation/*`
- `src/domain/v1/ports/reconciliation-repository.ts`
- `src/adapters/prisma/reconciliation/**`
- `src/application/reconciliation/**`
- `src/app/api/v1/reconciliation/plan/route.ts`
- `src/app/api/v1/reconciliation/report/route.ts`

Regras:
- serviço não altera legado;
- queries são específicas:
  - contagens por domínio novo;
  - mesma contagem em legado via serviços/repositórios legados,
    SEM migrá-los;
- geração de amostras para matching baseada em IDs canônicos
  compostos quando disponíveis;
- todo erro inesperado é sanitizado em 500 genérico.

## 5. Testes obrigatórios

Harness `scripts/reconciliation/` com SQLite temporário.

Cobertura mínima:

1. migration aditiva sem ALTER/DROP;
2. `knowledgeTime <= decisionTime` rejeitado em ambos endpoints;
3. plan retorna domínios e contagens;
4. report falha com **SEM_PARIDADE** quando mismatch > 0;
5. report **PARIDADE** quando todas amostras coincidem;
6. paginação determinística;
7. erro interno sanitizado;
8. regressões: `test:dataset-feature`, `test:cvm-facts`,
   `test:market-bar`, `test:reference-data`, `smoke:auth`,
   `prisma validate`, `tsc --noEmit`, build Next.js em WSL.

## 6. Escopo permitido

- `prisma/schema.prisma` apenas com novas tabelas;
- nova migration;
- `src/domain/v1/models/reconciliation/**`;
- `src/domain/v1/ports/reconciliation-repository.ts`;
- `src/adapters/prisma/reconciliation/**`;
- `src/application/reconciliation/**`;
- `src/app/api/v1/reconciliation/plan/route.ts`;
- `src/app/api/v1/reconciliation/report/route.ts`;
- `scripts/reconciliation/**`;
- `package.json`: `test:reconciliation`;
- `docs/architecture/phase-2-item-6-reconciliation.md`.

## 7. Escopo proibido

- `docs/CODEX_HANDOFF.md`;
- remover/desativar rotas legadas ou serviços legados;
- backfill, ingestão live, MT5/Profit/SQX real;
- endpoints de escrita financeira;
- alterar `HistoricalCandle`, `MarketData`,
  `historicalDataService`, `stockMonitoringService`,
  `tradingAgentsService`, `MLPredictionsTab`.

## 8. Decisões de arquitetura

1. Somente medição e decisão humana; corte é manual e futuro.
2. Sem lookahead: validar `knowledgeTime <= decisionTime`.
3. BigInt exato para contagens; sem `Float`.
4. Identidade por IDs; evitar matching por símbolo solto.
5. Legado permanece 100% operacional.
6. Um mismatch *não* bloqueante causa PARIDADE_PARCIAL,
   mas é destacado claramente.

## Critério de aceitação do Item 6

Aceito quando:
1. novas tabelas e APIs só executam leitura;
2. testes de paridade automatizados passam;
3. relatório pode ser gerado em WSL e Windows;
4. nenhum comportamento legado é alterado;
5. branch/commit futuros de corte legado serão criados APENAS
   após aprovação humana com base nesse relatório.
