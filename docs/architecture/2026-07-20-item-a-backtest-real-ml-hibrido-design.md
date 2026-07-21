# Item A — Backtest econômico real do ML Híbrido (spec aditiva)

Data: 2026-07-20 (revisão 4 — resposta à review da revisão 3)
Status: **implementada, revisada independentemente e integrada ao `main` em 2026-07-21; commit de implementação `9c04dea`**
Fila oficial: `docs/superpowers/plans/2026-07-20-vibe-informed-research-infrastructure.md`
Épico: `docs/superpowers/specs/2026-07-20-vibe-informed-research-infrastructure-design.md`
Precedente direto: `docs/superpowers/specs/2026-07-18-ml-hybrid-upgrade-design.md` (desvios conscientes #5 e #6)

## Nota da revisão 4

Os seis ajustes da revisão 3 foram aprovados (off-by-one do horizonte, ordem
snapshot→dataset, hash sem `:` em path, cadeia de persistência completa,
adaptador único de sessão, `BacktestCostProfile` Admin-only). Quatro
inconsistências finais foram apontadas antes da liberação de código: dois
hashes diferentes sendo tratados como um só, uma normalização temporal
declarada só pela metade, um `@@unique` que quebraria em linhas legadas, e
uma promessa de horário fixo que a spec não tem como garantir de verdade.
Esta revisão corrige as quatro, sem reabrir nada já aprovado.

## 1. Problema

O ML Híbrido v1 (`docs/ML_HYBRID.md`) treina e valida por gate estatístico, mas
o resultado econômico persistido é um **proxy direcional**: ±2% fixo por
acerto/erro do decil superior, custo fixo de 25 bps
(`python/ml/train.py::_decile_backtest`). Esse número fica em
`trainingEvidenceJson.backtestProxy` — nunca em `BacktestRun`, porque
`BacktestRunService` **recalcula** métricas a partir de barras e sinais reais
via `runDeterministicBacktest`; gravar o proxy nesse trilho falsificaria
proveniência (desvio #6, decisão do controller em 2026-07-18).

Objetivo deste item: fechar esse ciclo com o motor determinístico já existente
e testado (R-BT-1 a R-BT-7), sem duplicar a lógica de custo/entrada/Sharpe,
sem inventar preço e sem transformar reprovação em aprovação.

## 2. O que já existe e será reaproveitado

- `runDeterministicBacktest`: entrada em `open[t+1]`, custos reais, Sharpe com
  `periodsPerYear` real, embargo/purge, determinismo. Reaproveitado com uma
  extensão aditiva pontual (D8 — horizonte de previsão fixo, offset corrigido
  na revisão 3, mantido). Campo opcional; consumidor existente que não passa
  o campo novo mantém comportamento idêntico.
- `BacktestRunService.run()`: valida `ResearchRun`/`ModelVersion`, aplica
  embargo, chama o motor, persiste `BacktestRun`. Não muda de assinatura;
  ganha um método adicional `runForMlHybrid()` com contrato mais estrito
  (D10, revisado nesta revisão).
- Schema `BacktestRun` (Prisma): `instrumentId` é `String` livre, sem FK.
- Rota `/api/v1/backtests` já expõe `POST`/`GET` — reaproveitada.

Migration Prisma aditiva nova continua necessária (seção 5):
`BacktestCostProfile` + campos de idempotência/proveniência em `BacktestRun`,
agora explicitamente nullable (D10, corrigido).

## 3. Decisões de arquitetura

### D1 — Fonte das barras reais: `HistoricalCandle`, com snapshot imutável ANTERIOR ao dataset (mantida da revisão 3, path corrigido — item 1 do pedido)

`HistoricalCandle` é a mesma série que alimenta `price_features`/
`target_direction` no treino — única fonte que garante consistência entre o
que o modelo "viu" e o que o backtest mede.

Ordem de operações continua uma invariante de código (revisão 3, mantida):

```
1. resolve_universe(symbols)
2. PARA CADA symbol: snapshot_symbol_bars(db_path, symbol) — atômico, .tmp + os.replace
     -> escreve data/ml/bars_snapshot/<universeBarsDigest-provisório>/<symbol>.parquet
     -> calcula SHA-256 completo da série OHLCV congelada daquele símbolo
3. universeBarsDigest = SHA-256 sobre a concatenação canônica (ordenada por
   símbolo, depois por time) das linhas OHLCV de TODOS os símbolos
   snapshotados no passo 2 — ver D-hash para a definição formal, agora
   corrigida e separada de datasetDigest.
4. renomeia data/ml/bars_snapshot/<provisório>/ para
   data/ml/bars_snapshot/<universeBarsDigest>/ (rename atômico; se um
   snapshot com esse digest já existir — barras idênticas —, reaproveita e
   descarta o provisório).
5. build_dataset() lê EXCLUSIVAMENTE de data/ml/bars_snapshot/<universeBarsDigest>/
   (nunca de HistoricalCandle live) e monta o dataset final: preço + CVM
   point-in-time + TimesFM + rótulo.
6. datasetDigest = SHA-256 sobre o dataset final já montado no passo 5
   (mesmo cálculo que `build_dataset` já faz hoje sobre `ds.round(10).to_csv()`
   — inclui features de fundamentos e TimesFM, não só preço).
   datasetHash = "sha256:" + datasetDigest (identificador semântico).
7. treino, previsões, backtest — todos leem exclusivamente do snapshot em
   data/ml/bars_snapshot/<universeBarsDigest>/, nunca HistoricalCandle live.
```

**Regra dura mantida:** `build_dataset()` não aceita mais `db_path` para
preço; sem snapshot prévio, falha `SNAPSHOT_NOT_FOUND`; nenhum snapshot
retroativo.

Manifesto: `data/ml/models/<artifactHash>/bars_snapshot_manifest.json` com

```json
{
  "universeBarsDigest": "<64 hex>",
  "datasetDigest": "<64 hex>",
  "datasetHash": "sha256:<64 hex, igual ao datasetDigest>",
  "perSymbol": {
    "SYMBOL": { "sha256": "<64 hex>", "rows": 0, "from": "...", "to": "..." }
  }
}
```

### D-hash — três identificadores distintos, path sempre por `universeBarsDigest` ou `artifactHash` (corrigido — item 1 do pedido)

**Inconsistência real identificada pela review:** a revisão 3 dizia
"`datasetDigest` final = hash sobre o snapshot já congelado" — isso confunde
dois hashes de coisas diferentes: o snapshot é só OHLCV bruto; o dataset
final inclui fundamentos CVM point-in-time e features TimesFM por cima do
preço. Usar o mesmo nome para os dois teria feito o path do snapshot
(`data/ml/bars_snapshot/<...>/`) depender de um valor que só existe *depois*
de features/fundamentos serem computados — reintroduzindo, por um caminho
diferente, o mesmo tipo de ambiguidade de ordem que a revisão 3 já tinha
corrigido para `HistoricalCandle`.

**Correção — três identificadores, cada um com um único papel:**

```
universeBarsDigest — SHA-256 completo (64 hex, sem prefixo) SOMENTE sobre as
                      barras OHLCV cruas do snapshot (D1, passo 3). É o
                      ÚNICO usado no path data/ml/bars_snapshot/<...>/.
                      Calculado ANTES de qualquer feature ser computada.

datasetDigest       — SHA-256 completo (64 hex, sem prefixo) sobre o dataset
                       FINAL já com preço + fundamentos CVM + TimesFM + rótulo
                       (o que `build_dataset` já hasheia hoje). NUNCA usado
                       para nomear um diretório — é puramente um identificador
                       de proveniência/auditoria, guardado dentro do manifesto
                       e do envelope de persistência (D10).

datasetHash         — identificador SEMÂNTICO, "sha256:" + datasetDigest.
                       Usado em ResearchRun.datasetId e em qualquer
                       JSON/DTO exposto para humano/API. NUNCA usado para
                       montar um path (mesma razão da revisão 3: ':' quebra
                       nome de arquivo/diretório no Windows).

artifactHash        — SHA-256 completo (64 hex, sem prefixo) do modelo
                       LightGBM treinado (já existia, truncamento removido
                       na revisão 3, mantido). Usado no path
                       data/ml/models/<artifactHash>/.
```

Nenhum desses quatro valores é intercambiável com outro em nenhum ponto do
código ou da spec — qualquer lugar que hoje diz genericamente "hash" deve
dizer explicitamente qual dos quatro.

### D-session — `B3DailySessionCalendar` com fallback fail-safe de fim de dia civil (corrigido — item 4 do pedido)

**Promessa incorreta identificada pela review:** a revisão 3 fixava
`b3DailyCloseKnowledgeInstant` em 21:00 UTC + 30min de margem e afirmava que
isso "nunca antecipa" e é "sempre depois de qualquer sessão B3". Essa é uma
afirmação que a spec não tem como sustentar — um horário fixo codificado sem
fonte (calendário real de pregões, feriados, fechamentos antecipados de
véspera de feriado, mudanças de regra da B3) pode, em algum dia real, ser
**anterior** ao fechamento verdadeiro daquele pregão específico, o que
violaria point-in-time silenciosamente. Prometer "sempre posterior" sobre um
número que não vem de nenhuma fonte é o mesmo tipo de erro que motivou toda
a exigência de "não fabricar fato de mercado" em outras partes desta spec —
só que aplicado a tempo em vez de a preço.

**Correção — calendário versionado quando existe fato, fallback radical
quando não existe:**

```ts
// src/domain/v1/time/b3-session.ts (TS) e python/ml/b3_session.py (Python) —
// implementações espelhadas.

/**
 * Fonte de fatos sobre quando uma sessão B3 de um dia civil específico
 * efetivamente fechou. "Versionado" no sentido em que qualquer entrada
 * publicada aqui é um registro auditável (com fonte), nunca um número
 * inventado; correções a uma entrada não alteram retroativamente
 * knowledgeTime já persistido em BacktestRuns existentes (a entrada
 * corrigida vale só para leituras futuras).
 */
export interface B3DailySessionCalendar {
  /** Retorna o instante de fechamento registrado para aquele dia civil, ou
   *  null se não há entrada de calendário conhecida para essa data. */
  closeInstantFor(tradingDayUtcMidnight: Instant): Instant | null;
}

/**
 * Instante conservador em que o OHLC de um pregão D1 B3 pode ser
 * considerado conhecido.
 *
 * - Se o calendário tem uma entrada REAL e versionada para o dia: usa
 *   exatamente esse instante (fato auditável, não estimativa).
 * - Se não tem (calendário vazio/incompleto — estado inicial honesto desta
 *   v1.1, ver desvio consciente): usa 23:59:59.999 UTC do MESMO dia civil
 *   como fallback fail-safe. Esse fallback não afirma "às 23:59:59 a B3
 *   fechou" — afirma apenas "o dia civil inteiro já passou, então
 *   qualquer coisa que aconteceu nesse pregão, aconteceu antes deste
 *   instante". É a única afirmação sobre "posterioridade garantida" que
 *   esta spec pode fazer sem inventar um fato de calendário de mercado.
 *
 * NUNCA retorna um instante anterior ao fim do dia civil quando o
 * calendário não tem a entrada — não há hora fixa "sempre depois de
 * qualquer sessão B3" sem fonte; a única garantia sem fonte é o fim do
 * próprio dia.
 */
export function b3DailyCloseKnowledgeInstant(
  tradingDayUtcMidnight: Instant,
  calendar: B3DailySessionCalendar,
): Instant {
  const known = calendar.closeInstantFor(tradingDayUtcMidnight);
  if (known !== null) return known;
  return endOfUtcCivilDay(tradingDayUtcMidnight); // 23:59:59.999 UTC do mesmo dia
}
```

**Estado inicial declarado desta v1.1:** `B3DailySessionCalendar` pode (e
provavelmente vai, no primeiro incremento) ser implementado como um
calendário **vazio** (`closeInstantFor` sempre retorna `null`) — o que
significa, honestamente, que toda barra/sinal usa o fallback de fim de dia
civil até que um calendário real de sessões B3 (com fonte, versão, datas de
feriado/fechamento antecipado) seja efetivamente cadastrado. Isso é
declarado como limitação explícita (seção 7), não escondido atrás de uma
implementação que parece precisa mas não é.

### D-session aplicado a barras E sinais (corrigido — item 2 do pedido)

**Lacuna identificada pela review:** a revisão 3 normalizava só
`knowledgeTime`, deixando implícito (e ambíguo) o que acontece com `.time`/
`.barTime`. Isso importa de verdade porque o motor casa sinal com barra por
**igualdade exata de string** (`barIndexByTime.get(signal.barTime)` em
`runDeterministicBacktest`) — se `bar.time` e `signal.barTime` fossem
normalizados de formas diferentes (ou um dos dois não fosse normalizado),
todo sinal deixaria de casar com sua barra **silenciosamente** (o motor só
ignora: `if (signalBarIndex === undefined) continue`), zerando o backtest
sem erro nenhum.

**Declaração explícita, sem ambiguidade:**

```
BacktestBar.time          = b3DailyCloseKnowledgeInstant(diaCivilDoPregao, calendar)
BacktestBar.knowledgeTime = b3DailyCloseKnowledgeInstant(diaCivilDoPregao, calendar)   — mesmo valor
BacktestSignalInput.barTime      = b3DailyCloseKnowledgeInstant(diaCivilDaPrevisao, calendar)
BacktestSignalInput.knowledgeTime = b3DailyCloseKnowledgeInstant(diaCivilDaPrevisao, calendar)   — mesmo valor
```

Os **quatro** campos (`bar.time`, `bar.knowledgeTime`, `signal.barTime`,
`signal.knowledgeTime`) passam pela mesma função, com o mesmo dia civil de
entrada — nunca calculados por caminhos de código diferentes. Isso garante
por construção que `bar.time === signal.barTime` para o mesmo dia civil
(pré-requisito para o casamento por igualdade de string funcionar) e que
`knowledgeTime <= time` trivialmente (são o mesmo valor).

**O timestamp bruto de abertura (meia-noite UTC, como `HistoricalCandle`/MT5
gravam) fica exclusivamente dentro do arquivo de snapshot** (usado
internamente para ordenar/localizar linhas, indexar por dia civil, e casar
`open[t+1]` corretamente — a regra `t+1` continua operando sobre a ordem
cronológica real dos dias civis, só o **rótulo** de tempo exposto ao motor é
que muda). Nenhum consumidor fora da camada de montagem do
`BacktestBar`/`BacktestSignalInput` (aplicação, dentro do fluxo do ML
Híbrido) vê o timestamp de abertura bruto — o motor determinístico só recebe
os valores já normalizados.

### D2 — Granularidade do `BacktestRun`: um por instrumento (mantida)

`BacktestRun.instrumentId` é singular → um `BacktestRun` por ticker por
treino, todos referenciando o mesmo `researchRunId`/`modelVersionId`.

### D3 — Sinais: previsões out-of-sample do walk-forward (mantida, referencia D-session corrigido)

Reusar as previsões de teste do walk-forward (`walkforward_predictions.csv`),
nunca recomputar via `/ml/predict`. Mapeamento de direção mantido
(`pModel > 0.5 → BUY`, caso contrário `HOLD`, ver D4). `barTime`/
`knowledgeTime` do sinal seguem a declaração de "D-session aplicado a barras
E sinais" acima — nunca uma constante paralela, nunca só um dos dois campos.

Metadata de fold por previsão (mantida): `foldId, trainEnd, testStart,
embargoCalDays` por linha de `walkforward_predictions.csv`. `embargoDays: 0`
na chamada ao `BacktestRunService` continua correto — embargo já aplicado
pelo walk-forward Python, auditável por linha.

### D4 — Direção `SELL` → `HOLD` (mantida)

Sem custo de aluguel B3 modelado, `pModel <= 0.5` vira `HOLD`, não posição
vendida.

### D5 — `BacktestCostProfile`: entidade versionada, obrigatória, Admin-only (mantida da revisão 3)

```prisma
model BacktestCostProfile {
  id              String    @id @default(cuid())
  version         Int
  label           String
  fixedBrokerage  Float
  emolumentsPct   Float
  spreadBps       Float
  slippageBps     Float
  lotSize         Float
  source          String    // obrigatório, nunca "default"
  createdBy       String    // obrigatório, da sessão autenticada
  createdAt       DateTime  @default(now())
  archivedAt      DateTime?
  archivedBy      String?   // obrigatório quando archivedAt não é nulo

  @@unique([label, version])
}
```

`POST /api/v1/ml/cost-profiles` e `.../:id/archive` exigem autenticação +
papel Admin (403 para não-admin); `createdBy`/`archivedBy` vêm da sessão,
nunca do corpo da requisição; `source === 'default'` é rejeitado pela
validação. Treino sem `costProfileId` → `COST_PROFILE_REQUIRED` (400), nada
é executado. Nenhum valor numérico de custo é proposto nesta spec.

### D6 — Falha parcial: por ticker (mantida)

Mesmo padrão do `/ml/backfill`: por ticker, `BacktestRun` real ou motivo
explícito (`INSUFFICIENT_BARS`, `NO_SIGNALS`, `SNAPSHOT_NOT_FOUND`), nunca
fabricado. Ver D12 para a política de cobertura agregada.

### D7 — Endpoint de artefatos: seguro, paginado, validado (mantida)

- `hash` no path: `^[0-9a-f]{64}$` (aqui, o `artifactHash` — D-hash); fora
  do padrão → `400 INVALID_HASH` antes de tocar o filesystem.
- `symbol`: `^[A-Z]{4}\d{1,2}$` e pertencente ao universo do
  `bars_snapshot_manifest.json` daquele `artifactHash`; fora →
  `404 SYMBOL_NOT_IN_ARTIFACT`.
- Paginação obrigatória: `limit` (`1..2000`, default `500`), `offset`
  (`>=0`, default `0`); resposta `{ rows, total, limit, offset }`.
- `ml_api.py` loopback-only; rota Next pública revalida com Zod — dupla
  validação. CSV corrompido/parcial → `422 ARTIFACT_UNREADABLE`.
- `MlApiPort` ganha `getWalkforwardPredictions(artifactHash, symbol, { limit, offset })`.

### D8 — Horizonte de previsão fixo (10 pregões), offset de saída corrigido (mantida da revisão 3)

Alvo `close[t+10] > close[t]`, contado a partir do sinal (`t`), não da
entrada (`t+1`):

```
exitBarIndex (por horizonte) = signalBarIndex + predictionHorizonBars  = t + 10
entryBarIndex                = signalBarIndex + 1                       (open_next_bar)
barras de holding entre entrada e saída                                 = predictionHorizonBars - 1 = 9
```

`predictionHorizonBars` opcional em `BacktestEngineInput`; omitido preserva
comportamento atual do motor (teste de regressão obrigatório). Preço de
saída por horizonte = `close` da barra `t+10` (mesmo ponto de comparação de
`target_direction`). Stop/TP anteriores ao horizonte têm prioridade.
`predictionHorizonBars = 10` para o ML Híbrido.

### D9 — Não sobreposição por ticker e sizing (mantida)

Política de não sobreposição usa o `exitBarIndex` corrigido de D8: um sinal
só é aceito se seu `barTime` (índice `t`) for `>=` ao `exitBarIndex` do
último sinal aceito do mesmo ticker. Sinais dentro da janela são descartados
e contados (`skippedOverlapping`), nunca silenciosamente ignorados.
`signalCoverage` vai dentro do envelope de persistência (D10). Sizing:
`lotSize` fixo do `BacktestCostProfile`, uma unidade de posição por trade
aceito, sem simulação de portfólio multi-ticker.

### D10 — Persistência: envelope versionado, campos nullable para linhas legadas, `runForMlHybrid` estrito (corrigido — item 3 do pedido)

**Inconsistência real identificada pela review:** a revisão 3 declarava os
seis campos novos de `BacktestRun` (`costProfileId`, `costProfileVersion`,
`predictionHorizonBars`, `exitRuleKey`, `idempotencyKey`,
`metricsSchemaVersion`) como não-nulos, com `@@unique([idempotencyKey])`.
Isso quebra para qualquer `BacktestRun` que já exista hoje (criado pela rota
genérica `/api/v1/backtests`, fora do fluxo ML) ou para chamadas legadas do
`BacktestRunService.run()` que continuam existindo (seção 2): uma migration
que adiciona uma coluna `NOT NULL` sem default a uma tabela com linhas
existentes falha, e mesmo com um valor de preenchimento retroativo, um
`@@unique` não-nulo forçaria todo `BacktestRun` — inclusive os que nunca
tiveram cost profile, idempotência ou horizonte de previsão — a inventar um
valor só para satisfazer a constraint.

**Correção — todos os seis campos nullable, unique nullable, contrato de
API estrito só na função nova:**

```prisma
model BacktestRun {
  // ...campos existentes inalterados...
  costProfileId         String?
  costProfileVersion    Int?
  predictionHorizonBars Int?
  exitRuleKey           String?
  idempotencyKey        String?
  metricsSchemaVersion  Int?

  @@unique([idempotencyKey])
  // NULL não colide com NULL em índice único (SQLite e a maioria dos
  // bancos relacionais): múltiplas linhas legadas com idempotencyKey=NULL
  // coexistem sem violar a constraint; a unicidade só é exigida quando o
  // valor é de fato preenchido — exatamente o comportamento desejado.
}
```

**`runForMlHybrid()` (nome ilustrativo, a definir na implementação) usa um
tipo de entrada mais estrito que exige os seis campos:**

```ts
export interface MlHybridBacktestRunRequestV1 extends BacktestRunRequestV1 {
  readonly costProfileId: string;               // obrigatório aqui, opcional no request genérico
  readonly costProfileVersion: number;           // obrigatório aqui
  readonly predictionHorizonBars: number;        // obrigatório aqui (10 para o ML Híbrido)
  readonly signalCoverage: BacktestMetricsEnvelopeV1['signalCoverage'];
  readonly provenance: BacktestMetricsEnvelopeV1['provenance'];
}
```

`BacktestRunService.run()` (função existente, genérica) continua aceitando
`BacktestRunRequestV1` sem esses campos — grava `null` nas seis colunas
novas, `metricsJson` sem o envelope versionado (formato legado `{ metrics,
trades }`). `runForMlHybrid()` só aceita `MlHybridBacktestRunRequestV1`
completo — a obrigatoriedade é imposta **pelo tipo TypeScript e por
validação Zod na fronteira**, não pela constraint do banco (que precisa ficar
permissiva para não quebrar linhas legadas). Isso separa corretamente "o
banco tolera ausência" de "o fluxo do ML Híbrido nunca aceita ausência".

**Envelope versionado de `metricsJson`** (mantido da revisão 3, sem
mudança de conteúdo — só reafirmado aqui no contexto da correção de
nullability):

```ts
interface BacktestMetricsEnvelopeV1 {
  readonly envelopeVersion: 1;
  readonly metrics: BacktestMetrics;
  readonly trades: readonly BacktestTrade[];
  readonly signalCoverage: {
    readonly totalSignalsInWindow: number;
    readonly acceptedSignals: number;
    readonly skippedOverlapping: number;
  };
  readonly provenance: {
    readonly artifactHash: string;         // 64 hex, sem prefixo
    readonly universeBarsDigest: string;   // 64 hex, sem prefixo — D-hash
    readonly datasetDigest: string;        // 64 hex, sem prefixo — D-hash
    readonly foldsCovered: readonly {
      readonly foldId: number;
      readonly trainEnd: string;
      readonly testStart: string;
      readonly embargoCalDays: number;
    }[];
  };
  readonly costProfileRef: { readonly id: string; readonly version: number };
}
```

Assembler (`assembleBacktestRun`) faz parse condicional por
`metricsSchemaVersion`: presente → devolve `signalCoverage`/`provenance`/
`costProfileRef`; ausente (`null`, linha legada) → devolve só `{ metrics,
trades }`, campos novos omitidos no DTO de leitura. Nenhuma migração
retroativa de dados é necessária — leitura tolerante por construção.

Toda a cadeia (DTO, `service.ts`, `BacktestRepository` port, mapper Prisma,
assembler) permanece explicitamente listada como precisando de extensão
aditiva (mantido da revisão 3, seção 5).

### D11 — Fold metadata auditável (mantida)

Cada linha de `walkforward_predictions.csv` carrega `foldId, trainEnd,
testStart, embargoCalDays`; endpoint (D7) devolve sem omissão; teste de que
toda previsão tem fold correspondente e `trainEnd < testStart` sempre.

### D12 — Política de cobertura parcial ou zero (mantida)

```
backtestCoverage:
  'COMPLETE' — todo símbolo do universo resultou em BacktestRun (CREATED ou ALREADY_EXISTS)
  'PARTIAL'  — pelo menos um símbolo com BacktestRun e pelo menos um skipped/failed
  'NONE'     — nenhum símbolo resultou em BacktestRun
```

`'NONE'` não reverte gate/`ModelVersion`, mas nunca é apresentado como
`'COMPLETE'`; `skipped` sempre retornado por completo.

## 4. Fluxo proposto (alto nível, sem código ainda, ordem e hashes corrigidos)

```
runTraining(createdBy, symbols?, costProfileId)   [costProfileId obrigatório — D5]
  -> costProfile = lookup(costProfileId) — 404 se não existe/arquivado
  -> PARA CADA symbol: snapshot_symbol_bars(db_path, symbol) ANTES de qualquer feature (D1)
  -> universeBarsDigest = hash do snapshot cru do universo (D-hash) — usado no PATH do snapshot
  -> build_dataset() lê EXCLUSIVAMENTE de bars_snapshot/<universeBarsDigest>/
  -> datasetDigest = hash do dataset final (preço+CVM+TimesFM) — NUNCA usado como path
  -> datasetHash = "sha256:" + datasetDigest — só em ResearchRun.datasetId/DTOs
  -> train() no ml_api — grava bars_snapshot_manifest.json com {universeBarsDigest, datasetDigest, datasetHash} (D1/D-hash)
  -> evaluateGate()
  -> ResearchRun sempre (datasetId = datasetHash)
  -> se gate.approved: ModelVersion
       -> runRealBacktests(researchRunId, modelVersionId, artifactHash, universe, costProfile)
            para cada symbol em universe:
              1. manifest = lê bars_snapshot_manifest.json do artifactHash
                 se symbol ausente -> skip SNAPSHOT_NOT_FOUND
              2. previsões = mlApi.getWalkforwardPredictions(artifactHash, symbol, paginado) (D7)
                 inclui foldId/trainEnd/testStart/embargoCalDays (D3/D11)
                 se vazio -> skip NO_SIGNALS
              3. signals = previsões -> BacktestSignalInput[] (D3/D4),
                 barTime/knowledgeTime via b3DailyCloseKnowledgeInstant(calendar) (D-session, ambos campos)
                 filtradas por não sobreposição usando o offset corrigido (D8/D9)
              4. bars = snapshot imutável do symbol (D1), time/knowledgeTime via
                 b3DailyCloseKnowledgeInstant(calendar) (D-session, ambos campos — mesma função, mesmo dia civil)
                 se insuficiente/sem t+1 -> skip INSUFFICIENT_BARS
              5. windowStart/windowEnd = min/max date das previsões aceitas
              6. idempotencyKey = hash(modelVersion, artifactHash, symbol,
                    costProfile.id:version, exitRuleKey) (D10)
                 se já existe -> status ALREADY_EXISTS, não recria, não rechama o motor
              7. senão: runForMlHybrid() monta BacktestMetricsEnvelopeV1 (D10)
                 chamando o motor com predictionHorizonBars=10 (D8) -> status CREATED
       -> retorno consolidado: { backtestCoverage, created, alreadyExists, skipped } (D12)
```

## 5. Contratos afetados (aditivos, revisados)

- **Migration Prisma:** `BacktestCostProfile` (D5); seis campos **nullable**
  novos em `BacktestRun` (D10) — `costProfileId?`, `costProfileVersion?`,
  `predictionHorizonBars?`, `exitRuleKey?`, `idempotencyKey?`,
  `metricsSchemaVersion?`, com `@@unique([idempotencyKey])` (nullable-safe).
  Nenhum campo existente é removido/muda de tipo.
- `src/domain/v1/models/backtest-run/index.ts`: campo opcional
  `predictionHorizonBars`, novo membro `'HORIZON_END'` em `TradeExitReason`.
- `src/domain/v1/time/b3-session.ts` (novo): `B3DailySessionCalendar`
  (interface) + `b3DailyCloseKnowledgeInstant` com fallback fail-safe de fim
  de dia civil (D-session, corrigido).
- `src/application/backtest-run/dto.ts`: `BacktestRunRequestV1` (existente,
  campos novos opcionais) + `MlHybridBacktestRunRequestV1` (novo, campos
  obrigatórios — D10).
- `src/application/backtest-run/service.ts`: `run()` inalterado;
  `runForMlHybrid()` novo.
- `src/domain/v1/ports/backtest-repository.ts`,
  `src/adapters/prisma/backtest-run/mapping.ts`,
  `src/application/backtest-run/assemblers.ts`: estendidos aditivamente,
  tolerantes a valores `null` nos seis campos novos.
- `MlApiPort`: `getWalkforwardPredictions(artifactHash, symbol, { limit, offset })` (D7).
- `python/ml_api.py`: rota `GET /ml/predictions/<hash64hex>` validada (D7).
- `python/ml/train.py`: separa `universeBarsDigest` (path) de `datasetDigest`/
  `datasetHash` (semântico) (D-hash); grava fold metadata (D3/D11) e
  `bars_snapshot_manifest.json` com os três identificadores (D1).
- `python/ml/dataset.py::build_dataset`: lê do diretório de snapshot
  (`universeBarsDigest`), nunca de `HistoricalCandle` diretamente (D1).
- Novo `python/ml/bars_snapshot.py`: escrita atômica + `universeBarsDigest`
  (D1), chamado ANTES de `build_dataset`.
- Novo `python/ml/b3_session.py`: espelho Python de `B3DailySessionCalendar`
  + fallback fail-safe (D-session).
- `RunTrainingResult`: ganha `costProfileId` (obrigatório no request) e
  `backtests: { coverage, created, alreadyExists, skipped }`.

## 6. Testes obrigatórios (revisado/ampliado)

- **Regressão do motor:** `predictionHorizonBars` omitido → saída idêntica à
  versão atual, byte a byte.
- **D8 (offset):** trade fecha exatamente em `t + predictionHorizonBars`,
  preço de saída = `close` dessa barra, comparado contra fixture real.
- **D9 (não sobreposição):** usa o `exitBarIndex` corrigido; nenhum trade
  com `entryTime` dentro da janela de holding do trade anterior do mesmo
  ticker.
- **D1/D-hash (separação de identificadores):** `universeBarsDigest`
  calculado só sobre OHLCV cru, ANTES de qualquer feature; `datasetDigest`
  calculado sobre o dataset final (preço+CVM+TimesFM) e **nunca** aparece em
  um `os.path.join`/`path.join`; alterar CVM/TimesFM sem alterar OHLCV muda
  `datasetDigest` mas não muda `universeBarsDigest` (teste direto dessa
  independência); `datasetHash` sempre igual a `"sha256:" + datasetDigest`.
- **D-session (barras e sinais, ambos os campos):** `bar.time === signal.barTime`
  para o mesmo dia civil (pré-condição do casamento por igualdade de string
  no motor); os quatro campos (`bar.time`, `bar.knowledgeTime`,
  `signal.barTime`, `signal.knowledgeTime`) usam a mesma chamada de função;
  timestamp bruto de abertura nunca aparece fora do arquivo de snapshot;
  busca textual/lint garantindo chamada única de
  `b3DailyCloseKnowledgeInstant` em todo o código de montagem de
  barra/sinal.
- **D-session (calendário/fallback):** `closeInstantFor` retornando valor
  conhecido → usado exatamente; `closeInstantFor` retornando `null` →
  fallback `23:59:59.999 UTC` do mesmo dia civil, nunca um horário
  intermediário fixo; calendário vazio (estado inicial) → todo dia cai no
  fallback, comportamento determinístico e testável.
- **D10 (nullability):** migration aplicada sobre uma tabela `BacktestRun`
  com linhas pré-existentes não falha; múltiplas linhas com
  `idempotencyKey = NULL` coexistem sem violar `@@unique`; `run()` genérico
  sem os seis campos grava `null`/formato legado de `metricsJson`;
  `runForMlHybrid()` chamado com qualquer um dos seis campos ausente falha
  em tempo de validação (Zod/tipo), nunca grava uma linha parcial.
- **D10 (cadeia de persistência):** round-trip DTO → service → repository →
  mapper → assembler → DTO de leitura preservando
  `signalCoverage`/`provenance`/`costProfileRef`; leitura de linha legada
  (`metricsSchemaVersion = null`) não quebra o assembler.
- **D10 (idempotência):** duas chamadas com a mesma chave → uma linha só
  (`CREATED` depois `ALREADY_EXISTS`, sem rechamar o motor); mudar qualquer
  componente da chave → nova linha.
- **D5 (cost profile, Admin-only):** não-admin → `403`; `source` ausente ou
  `'default'` → rejeitado; `createdBy`/`archivedBy` da sessão, nunca do
  corpo; treino sem `costProfileId` → `COST_PROFILE_REQUIRED`.
- **D7 (endpoint):** hash malformado → `400` sem tocar filesystem; símbolo
  fora do universo → `404`; paginação respeitada; CSV corrompido → `422`.
- **D3/D11 (fold metadata):** toda previsão com fold completo;
  `trainEnd < testStart` sempre.
- **D12 (cobertura):** `NONE`/`PARTIAL`/`COMPLETE` corretos; gate/
  `ModelVersion` nunca revertidos por cobertura de backtest.
- Suítes de regressão que já passam e não podem quebrar: `test:ml-hybrid`,
  `test:backtest-run`, `test:signal`, `test:model-version`, `test:research-run`,
  `prisma validate`, `tsc --noEmit`, `npm run build`.
- E2E DEMO/read-only: execução real em subconjunto pequeno (3–5 tickers),
  validando `GET /api/v1/backtests?modelVersionId=...`, `signalCoverage`
  plausível, `provenance` com os três identificadores presentes e
  corretos, e que nenhum `OrderIntent` é criado.

## 7. Desvios conscientes desta spec

1. Fonte de barras é `HistoricalCandle` via snapshot imutável, não
   `VersionedMarketBar` — proveniência bitemporal formal da Fase 2 fica
   pendente.
2. `SELL` é tratado como `HOLD` nesta v1.1 (D4) — sem custo de aluguel B3.
3. `embargoDays: 0` na chamada ao `BacktestRunService` (D3) — embargo já
   aplicado no walk-forward Python, auditável via `embargoCalDays` (D11).
4. Sizing fixo de 1 lote por trade aceito, sem simulação de portfólio
   multi-ticker com capital compartilhado (D9).
5. `predictionHorizonBars = 10` replica o horizonte do modelo sem
   verificação automática de drift entre Python e TS — risco documentado.
6. **`B3DailySessionCalendar` nasce vazio nesta v1.1** (corrigido nesta
   revisão): sem entradas de calendário cadastradas, todo `knowledgeTime`
   usa o fallback de fim de dia civil (`23:59:59.999 UTC`) — mais
   conservador do que uma hora de fechamento real seria, o que é seguro
   (nunca antecipa point-in-time) mas reduz a precisão de quão cedo um
   sinal poderia legitimamente ter sido gerado no mesmo dia. Popular o
   calendário com sessões reais é trabalho futuro explícito, não coberto
   por esta spec.

## 8. Fora de escopo (fica para itens B+ da fila ou trabalho futuro explícito)

- Run Card, hash de configuração/código, dossiê humano-legível (Item B).
- `ResearchHypothesis`/`ResearchGoal` (Item C).
- Validação estatística (bootstrap em blocos) sobre o retorno econômico real
  (Item F).
- Simulação de portfólio multi-ticker com capital compartilhado e sizing por
  convicção/score.
- Posição vendida real com custo de aluguel B3 modelado (D4).
- Verificação automática de drift do horizonte de previsão entre Python e TS
  (D8/desvio 5).
- População real de `B3DailySessionCalendar` com sessões/feriados/
  fechamentos antecipados verificados (D-session/desvio 6) — a v1.1 entrega
  só o adaptador e o fallback fail-safe.

## 9. Critério de aceitação

Depois de um treino aprovado no gate **e com `costProfileId` válido
cadastrado por um Admin identificado**, para cada ticker do universo existe
um `BacktestRun` real com proveniência auditável — horizonte de previsão de
10 pregões contado corretamente a partir do sinal, sem sobreposição por
ticker, barras vindas de um snapshot imutável tirado **antes** de
`build_dataset` ler qualquer preço e identificado por `universeBarsDigest`
(nunca confundido com `datasetDigest`), `bar.time`/`bar.knowledgeTime`/
`signal.barTime`/`signal.knowledgeTime` todos normalizados pela mesma função
de sessão B3 (com fallback fail-safe honesto quando não há calendário real),
metadados de fold/embargo auditáveis por previsão, custo
explícito/versionado/Admin-only, cadeia de persistência estendida de ponta a
ponta com os seis campos novos nullable para não quebrar `BacktestRun`
legado, e idempotência garantida por chave (unique nullable-safe) — **ou** um
motivo explícito de por que não foi possível gerá-lo, agregado num status de
cobertura nunca omitido. Nunca um número econômico inventado, nunca um proxy
apresentado como resultado real, nunca um custo default silencioso, nunca um
path quebrado no Windows, nunca uma promessa de horário de mercado sem fonte.

---

**Próximo passo:** revisão final do Guardião/usuário sobre as quatro
correções desta revisão 4 (separação `universeBarsDigest`/`datasetDigest`,
normalização declarada dos quatro campos temporais, nullability dos seis
campos novos + contrato estrito de `runForMlHybrid`, `B3DailySessionCalendar`
com fallback fail-safe). Nenhum código foi escrito. Só após aprovação começa
a implementação, em worktree, item único, sem commit/push até revisão do
diff.
