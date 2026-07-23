# Item C — Treino ML assíncrono, persistido e cancelável

**Status:** especificação para implementação aditiva e não destrutiva do
Item B. Sem execução financeira, sem `execute_order`, sem exposição de
segredos. Codificação a cargo do **Claude Code (modelo Sonnet 5)**
no Windows; revisão e testes pelo Guardião_Hermes em WSL + Windows.
**Precedentes:** Item A (`docs/architecture/2026-07-20-item-a-backtest-real-ml-hibrido-design.md`, commit `9c04dea`), Item B (`docs/architecture/2026-07-21-item-b-unified-ml-predictions-v1.md`, commit `9a78f97`).

> INSTRUÇÃO DE CODIFICAÇÃO: usar o modelo **Sonnet 5** no Claude Code (Windows).
> O repositório está em `C:\WR\wr_trade_pro_`; o Claude Code deve `git pull` antes
> de iniciar e **NÃO fazer commit/push** — o Guardião publica após revisão.
> Não alterar itens anteriores.

## Problema

`POST /api/v1/ml/train` chama `MlHybridService.runTraining()` de forma
síncrona dentro do request HTTP. O treino do universo completo (138 tickers)
ultrapassa o timeout do Next.js (600 s). Evidência real (2026-07-22):
backfill `PARTIAL` (126/138), Python com ~2.05 GB e 1 núcleo de CPU após o
timeout, sem `ResearchRun` nem `ModelVersion` — o cálculo continuou, mas a
camada de aplicação nunca recebeu o resultado.

Além disso:

- Não há cancelamento real: abortar o `fetch` no navegador não interrompe o
  Python, e o `AbortSignal.timeout()` do Next não alcança o subprocesso.
- Após reload ou restart do Next/Electron, o estado do treino desaparece —
  não há persistência, o usuário não sabe se o trabalho ainda roda.
- Não há concorrência controlada: dois cliques em "treinar" podem disparar
  jobs duplicados.

## Objetivo

Substituir a execução síncrona por um **job manager durável** com:

1. **POST /api/v1/ml/train → 202 + jobId**: cria o job, persiste antes de
   iniciar o Python, retorna imediatamente.
2. **Worker dedicado** (fora do request HTTP) com lease persistente,
   heartbeat e reconciliação no boot.
3. **GET /api/v1/ml/jobs/:jobId**: consulta status, progresso, fase e
   resultado (ou erro sanitizado).
4. **POST /api/v1/ml/jobs/:jobId/cancel**: cancelamento real da árvore de
   processos Python + atualização do ledger, com confirmação de término.
5. **GET /api/v1/ml/jobs**: listagem paginada do histórico com filtro de
   status.
6. **Gate preservado**: `MlHybridService.runTraining()` continua sendo o
   motor — sua lógica (gate, baselines, `ResearchRun`, `ModelVersion`,
   `BacktestRun`) NÃO é reescrita, apenas invocada pelo worker.

O que **não** é escopo deste item: horizontes 5/21 pregões, logs MCP, remoção
de legado (MA Crossover/Regressão Linear).

## Princípios fixos

1. **Identidade antes do efeito:** `jobId` é gerado e persistido antes de
   iniciar o Python. Retry do POST é idempotente (mesmo payload → mesmo
   `jobId` quando o job ainda está ativo).
2. **Worker durável:** não usa Promise solta, timer ou fila em memória do
   handler Next. Usa lease persistente com `ownerId`, expiração e heartbeat.
3. **Cancelamento real:** `taskkill /T /F` no Windows (árvore inteira).
   Confirmação de término antes de `CANCELLED` no ledger.
4. **Corrida cancelamento vs publicação:** o claim de publicação é atômico
   contra o status do job (CAS). Cancelamento aceito antes da publicação
   impede criação de `ModelVersion`.
5. **Validação runtime:** resultado do Python (`TrainResult`) é validado com
   envelope completo antes de qualquer efeito colateral (Zod runtime, não
   cast `as TrainResult`). IDs canônicos, hashes 64-hex, datas ISO válidas,
   números finitos, baselines exatas.
6. **Point-in-time preservado:** `knowledgeTime <= decisionTime`. O worker
   consome os mesmos dados de corte que o fluxo síncrono atual.
7. **Sem custo implícito:** treino exige `costProfileId` explícito (herdado
   do Item A/B). Worker valida antes de iniciar.
8. **Aditivo:** nova tabela `TrainingJob` no Prisma. Nenhuma coluna/tabela
   removida. `MlHybridService.runTraining()` NÃO é alterado em assinatura
   — apenas chamado de dentro do worker em vez do handler HTTP.
9. **Sem trading:** não criar/modificar `OrderIntent`, execução, broker,
   MT5, kill switch ou regra DEMO-only.
10. **Não tocar:** `docs/CODEX_HANDOFF.md`, `tradingAgentsService`,
    `MLPredictionsTab`, `src/app/api/agents/**`, `python/agents`.

## 1. Modelo de domínio — TrainingJob

### 1.1 Status e fases

```ts
type JobStatus =
  | 'QUEUED'
  | 'CLAIMED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'INTERRUPTED';

type JobPhase =
  | 'SNAPSHOT'
  | 'TRAINING'
  | 'GATE'
  | 'BACKTESTS'
  | 'FINALIZING';
```

Transições válidas (máquina de estados determinística):

```
QUEUED → CLAIMED (worker toma posse com lease)
CLAIMED → RUNNING (Python iniciado)
RUNNING → SUCCEEDED | REJECTED | FAILED | CANCEL_REQUESTED
CANCEL_REQUESTED → CANCELLED (árvore confirmadamente morta)
RUNNING → INTERRUPTED (reconciliação: lease expirado, processo morto)
```

### 1.2 Schema Prisma (aditivo)

```prisma
model TrainingJob {
  jobId             String    @id @default(cuid())
  status            String    // JobStatus
  phase             String?   // JobPhase (null até CLAIMED)
  progressPct       Int?      // 0-100, monotônico
  payloadJson       String    // snapshot imutável do payload de criação
  costProfileId     String
  costProfileVersion Int
  universeTickers   String?   // JSON array ou null (= universo completo)
  requestedBy       String
  createdAt         DateTime  @default(now())
  claimedAt         DateTime?
  claimedBy         String?   // ownerId do worker
  leaseExpiresAt    DateTime?
  heartbeatAt       DateTime?
  startedAt         DateTime?
  completedAt       DateTime?
  researchRunId     String?
  modelVersionId    String?
  gateJson          String?   // resultado do gate, mesmo reprovado
  metricsJson       String?   // métricas agregadas (sanitizadas)
  backtestIdsJson   String?   // JSON array de backtestId
  errorPublic       String?   // mensagem sanitizada para UI (nunca stack/bruto)
  errorCode         String?   // código de erro público
  lastPhaseFailed   String?   // fase que falhou

  @@index([status, createdAt])
  @@index([requestedBy, createdAt])
}
```

`payloadJson` é o corpo original do POST (`{ costProfileId, symbols? }`)
congelado no momento da criação — imutável, usado para idempotência e
auditoria.

## 2. Contratos de API

### 2.1 POST /api/v1/ml/train → 202 (já existe; comportamento alterado)

**Request** (mesmo contrato do Item B):
```ts
{ costProfileId: string; symbols?: string[] }
```
**Response 202:**
```ts
{ jobId: string; status: 'QUEUED'; createdAt: string }
```

Comportamento:
- Valida `costProfileId` (Zod `.strict()`) e resolve perfil ativo.
- Se `symbols` fornecidos, valida tickers B3 (formato e existência).
- Se já existe `TrainingJob` QUEUED/CLAIMED/RUNNING/CANCEL_REQUESTED
  com mesmo `payloadJson`, retorna 200 com o `jobId` existente (idempotente).
- Cria `TrainingJob` com status `QUEUED`.
- Retorna 202 imediatamente. **NÃO inicia o Python aqui.**
- Concorrência: no máximo 1 job ativo (não terminal) por `requestedBy`.
  Segundo POST concorrente retorna 409.

### 2.2 GET /api/v1/ml/jobs/:jobId

**Response 200:**
```ts
{
  jobId: string;
  status: JobStatus;
  phase: JobPhase | null;
  progressPct: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  researchRunId: string | null;
  modelVersionId: string | null;
  gate: { approved: boolean; ... } | null;
  errorPublic: string | null;
  errorCode: string | null;
}
```

### 2.3 GET /api/v1/ml/jobs

**Query:** `?status=...&limit=20&cursor=...`

**Response 200 (paginado):**
```ts
{
  items: JobSummary[];  // DTO allowlist, sem payload/bruto
  nextCursor: string | null;
}
```

Ordenação: `createdAt DESC`.

### 2.4 POST /api/v1/ml/jobs/:jobId/cancel

**Response 200:**
```ts
{
  jobId: string;
  status: 'CANCELLED' | 'CANCEL_REQUESTED';
  processConfirmedTerminated: boolean;
}
```

Regras:
- Só cancela jobs em estado QUEUED, CLAIMED, RUNNING ou CANCEL_REQUESTED.
- Se QUEUED: transição direta para CANCELLED (sem processo para matar).
- Se CLAIMED/RUNNING: transição para CANCEL_REQUESTED, sinaliza o worker,
  worker mata a árvore (`taskkill /T /F`), confirma término,
  transição para CANCELLED.
- Se `processConfirmedTerminated: false`, NÃO transiciona para CANCELLED.
- Dono ou admin podem cancelar (autorização pela sessão).

### 2.5 GET /api/v1/ml/train/status (compatibilidade)

Mantido como alias para `GET /api/v1/ml/jobs?limit=1` (último job),
para não quebrar a UI do Item B durante a transição. A UI do Item B
chama esse endpoint para saber se há treino em andamento.

## 3. Worker e lease

### 3.1 Lifecycle

O worker NÃO é um endpoint HTTP. Opções de implementação (escolher 1):

**A) Processo filho do Electron** (preferencial): `spawn(process.execPath,
[entry], { env: { ELECTRON_RUN_AS_NODE: '1' } })` no boot do Electron.
Mesmo padrão do MCP Pilot (Fase 7).

**B) Intervalo no Next.js**: `setInterval` registrado no bootstrap do
servidor (não no handler de rota). Menos isolado, mas aceitável como
fallback se A for muito complexo para este item.

O worker, em loop:
1. Consulta jobs QUEUED (mais antigo primeiro).
2. Tenta claim com CAS: `UPDATE ... SET status='CLAIMED', claimedBy=?, leaseExpiresAt=?, claimedAt=now WHERE jobId=? AND status='QUEUED'`.
3. Se claim OK: inicia Python, atualiza para RUNNING.
4. Durante execução: heartbeat periódico (atualiza `heartbeatAt` e `progressPct`).
5. Ao final: chama `MlHybridService.runTraining()` com o resultado do Python,
   atualiza job com researchRunId/modelVersionId/gate/backtests.
6. Se CANCEL_REQUESTED: mata processo, confirma, atualiza para CANCELLED.

### 3.2 Reconciliação no boot

No startup do worker, varre jobs CLAIMED/RUNNING/CANCEL_REQUESTED com
`leaseExpiresAt < now()`:
- Se o processo Python correspondente ainda existe (PID + creation time):
  readota o job (atualiza lease).
- Se não existe: transição para INTERRUPTED.

### 3.3 Heartbeat e expiração

- Heartbeat: a cada 15s enquanto RUNNING.
- Lease: expira em 60s sem heartbeat.
- Dois workers não podem reivindicar o mesmo job (CAS no claim).

## 4. Regras determinísticas

1. **Idempotência de criação:** mesmo `payloadJson` + job ainda não terminal
   → mesmo `jobId`. Time window: enquanto o job existir no banco.
2. **Um job ativo por usuário:** 409 se já existe job não terminal.
3. **Validação pré-efeito:** `costProfileId` válido e ativo; `symbols`
   válidos (se fornecidos); perfil NUNCA é inventado (erro se não encontrado).
4. **Gate preservado:** `evaluateGate()` do Item A continua idêntico.
   Reprovação persiste `ResearchRun` + `gateJson`, sem `modelVersionId`.
5. **Cancelamento vence publicação:** claim atômico. Se `CANCEL_REQUESTED`
   antes da criação de `ModelVersion`, a publicação é abortada.
6. **Sanitização de erros:** `errorPublic` nunca contém stack trace, path,
   token, URL interna ou mensagem Python bruta.
7. **Métricas sanitizadas:** `metricsJson` expõe apenas agregados seguros
   (nunca artefatos brutos, paths ou conteúdo de arquivo).

## 5. Camadas (evolução aditiva)

```
src/domain/v1/models/ml/training-job.ts      — tipos JobStatus, JobPhase, DTOs
src/domain/v1/ports/training-job-repository.ts
src/adapters/prisma/ml/training-job/         — migration + repository
src/application/ml/training-job-manager.ts   — service: create, get, list, cancel
src/application/ml/training-worker.ts         — worker loop: claim, execute, heartbeat, reconcile
src/app/api/v1/ml/train/route.ts             — MODIFICADO: assíncrono (202)
src/app/api/v1/ml/jobs/[jobId]/route.ts      — NOVO: GET detalhe
src/app/api/v1/ml/jobs/[jobId]/cancel/route.ts — NOVO: POST cancel
src/app/api/v1/ml/jobs/route.ts              — NOVO: GET listagem
scripts/training-job/                        — harness de teste
package.json                                 — adicionar test:training-job
```

**NÃO criar** novas pastas `src/workers/` ou `src/jobs/` separadas da
aplicação. O worker registration fica no bootstrap existente do Next.js
ou Electron, reutilizando os mesmos adapters/compose.

## 6. Migração Prisma

**Aditiva** — `prisma/migrations/*_add_training_job/migration.sql`:

```sql
CREATE TABLE TrainingJob (
  jobId TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  ...
);
```

Nenhuma alteração em `ResearchRun`, `ModelVersion`, `BacktestRun`,
`BacktestCostProfile`, `BackfillRun` ou qualquer modelo existente.

## 7. Testes obrigatórios

Harness `scripts/training-job/` com SQLite temporário:

1. **POST /train → 202 + jobId**: resposta imediata, job persiste com status QUEUED.
2. **GET /jobs/:id**: retorna status, fase, progresso.
3. **GET /jobs**: paginação, ordenação, filtro por status.
4. **Idempotência**: POST com mesmo payload enquanto job ativo → mesmo jobId.
5. **Concorrência**: segundo POST enquanto job ativo → 409.
6. **Cancelamento QUEUED**: transição direta para CANCELLED.
7. **Cancelamento RUNNING**: CANCEL_REQUESTED → worker confirma → CANCELLED.
8. **Worker claim + execução**: fluxo completo QUEUED → CLAIMED → RUNNING → SUCCEEDED.
9. **Gate reprovado**: job SUCCEEDED mas gate=false → REJECTED, sem modelVersionId.
10. **Reconciliação**: lease expirado → INTERRUPTED, sem duplicar.
11. **Sanitização de erro**: `errorPublic` sem path/token/stack.
12. **Validação runtime**: `TrainResult` inválido → FAILED, sem efeitos colaterais.
13. **Corrida cancel vs publish**: cancelamento antes da publicação → CANCELLED sem `ModelVersion`.
14. **Autorização**: 401 sem sessão, 403 para cancelar job de outro usuário (exceto admin).

**Regressões:** `prisma validate`, `npx tsc --noEmit`, `npm run build`,
`npm run test:ml-hybrid`, `npm run test:backtest-run`, `npm run test:research-run`,
`npm run test:model-version`, `npm run test:b3-session`,
testes Python ML relevantes e `smoke:auth`.

**Teste de restart real (não apenas reload no mesmo processo):**
- Iniciar worker → criar job → derrubar worker → iniciar novo worker →
  reconciliar (INTERRUPTED ou readotar se processo ainda vivo). O harness
  deve usar `child_process` para simular crash do worker.

**Teste de cancelamento de árvore:** worker cria subprocesso-neto (ex.:
`python -c "import time; time.sleep(60)"`). Cancelamento deve matar líder
E neto. Teste falha se `CHILD_PID_FOUND` for null ou se neto sobreviver.

## 8. Escopo permitido

- Criar `TrainingJob` no schema Prisma + migration aditiva.
- Criar `src/application/ml/training-job-manager.ts` e `training-worker.ts`.
- Criar rotas `jobs/[jobId]`, `jobs/[jobId]/cancel`, `jobs`.
- Modificar `src/app/api/v1/ml/train/route.ts` (síncrono → 202).
- Modificar `src/app/api/v1/ml/train/status/route.ts` (se existir) ou
  criar alias para compatibilidade com UI do Item B.
- Criar `scripts/training-job/` com harness.
- Adicionar `test:training-job` em `package.json`.
- Registrar worker no bootstrap do Electron `electron/main.ts` com
  `ELECTRON_RUN_AS_NODE` (ou, se opção B, no `instrumentation.ts` do Next).

## 9. Escopo proibido

- Alterar assinatura pública de `MlHybridService.runTraining()`.
- Alterar `evaluateGate()`, baselines ou critérios de aprovação.
- Alterar `ResearchRun`, `ModelVersion`, `BacktestRun`, `BacktestCostProfile`
  ou qualquer modelo existente.
- Tocar `docs/CODEX_HANDOFF.md`.
- Tocar `tradingAgentsService`, `MLPredictionsTab`, `src/app/api/agents/**`.
- Conectar a `ExecutionBroker`/ordens reais.
- `Float`/`Decimal` em verdades.
- Expor paths, tokens, stack traces ou conteúdo bruto de artefatos.

## 10. Decisões de arquitetura

1. **Worker no Electron, não no Next isolado:** o Electron é dono do
   lifecycle da plataforma. O worker iniciado por ele sobrevive a reloads
   do Next dev e é dono natural de subprocessos Python. Mesmo padrão do
   MCP Pilot (Fase 7, `ELECTRON_RUN_AS_NODE`).
2. **MlHybridService.runTraining() NÃO é reescrito:** ele é o motor
   validado (gate, baselines, ResearchRun, ModelVersion, BacktestRun).
   O worker apenas o invoca com o resultado do Python, em vez do handler HTTP.
   Se o Python já produziu o `TrainResult`, o resto é determinístico e rápido.
3. **Um job ativo por vez:** simplicidade operacional. Treino do universo
   completo é intensivo (CPU/memória); concorrência real degradaria ambos.
4. **Lease, não fila:** não implementar Redis/Bull/bullmq. SQLite com
   lease/claim é suficiente e evita dependência externa.
5. **Cancelamento Windows-first:** `taskkill /T /F` cobre a árvore.
   Em dev/Linux, `killpg` ou equivalente. Testado em ambos.
6. **Compatibilidade com UI do Item B:** `GET /api/v1/ml/train/status`
   (ou a rota que a UI usa para polling) continua funcionando como alias
   para o último job. A UI do Item B NÃO é modificada neste item.

## Critério de aceitação do Item C

1. POST /train retorna 202 em < 1s, com jobId.
2. Worker processa o job e produz ResearchRun (+ ModelVersion se aprovado).
3. GET /jobs/:id reflete estado real após reload/restart do Electron.
4. Cancelamento interrompe a árvore Python e atualiza o ledger.
5. Gate reprovado persiste ResearchRun sem ModelVersion.
6. Crash do worker + restart reconcilia jobs não-terminais (INTERRUPTED).
7. Sanitização: erro público nunca expõe stack/path/token.
8. Validação runtime rejeita `TrainResult` malformado sem efeitos.
9. Todas as regressões verde.
10. Nenhuma alteração em modelos/tabelas existentes.
