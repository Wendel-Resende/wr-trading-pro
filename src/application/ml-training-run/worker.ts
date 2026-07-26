import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createBacktestCostProfileService } from '../backtest-cost-profile';
import { createHttpDirectionalMlApiPort, DirectionalService, type DirectionalTrainResponse } from '../ml-directional';
import { ReadModelError } from '../read-models-v1/errors';
import type { MlTrainingRun } from '../../domain/v1/models/ml-training-run';
import { createMlTrainingRunService } from './compose';
import type { MlTrainingRunService } from './service';
import type { MlTrainJobPort, TrainJobStatus } from './train-job-port';
import { sanitizeErrorSummary, toKnownErrorCode } from './sanitize';

/**
 * Item C: worker in-process que roda o treino fora do request HTTP (agendado
 * via `scheduleTrainingRun`, chamado logo após o `POST /api/v1/ml/training-runs`
 * responder 202) — o processo Node continua vivo entre requests (não é uma
 * function serverless efêmera), então este `void` fire-and-forget é seguro
 * enquanto o processo não reiniciar. Reinício é tratado por
 * `reconcileOnStartup` (spec §5): nada fica "RUNNING" para sempre.
 *
 * Cancelamento real: o job Python roda em PROCESSO SEPARADO
 * (`python/ml/directional_worker.py` via `job_runner.JobRegistry`), nunca thread
 * cooperativa — `trainJobPort.cancel(jobId)` mata o processo do SO. Abortar
 * só o `fetch` do Next NUNCA é suficiente (é exatamente o bug documentado
 * na spec) — por isso o cancelamento aqui sempre chama o endpoint Python
 * dedicado antes de marcar o run como `CANCELLED`.
 */
// Item C: configurável só para a suíte de testes (`WR_ML_TRAINING_POLL_INTERVAL_MS`)
// acelerar o polling sem esperar 3s reais por iteração — produção sempre
// usa o default de 3000ms (spec §5: "atualizar fases/progresso de forma
// limitada", nunca a cada amostra).
const POLL_INTERVAL_MS = Number(process.env.WR_ML_TRAINING_POLL_INTERVAL_MS ?? 3_000);
const MAX_POLL_ITERATIONS = 4_000; // ~3h20min de teto absoluto de segurança

export interface MlTrainingRunWorkerPorts {
  readonly prisma: PrismaClient;
  readonly trainJobPort: MlTrainJobPort;
  readonly mlApiBaseUrl: string;
  readonly sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * LOTE 2 (Item C): sentinela interna usada só para abortar a transação do
 * claim CAS (`claimAndPublish`) sem propagar um erro real — `prisma.
 * $transaction` faz ROLLBACK de qualquer `throw` dentro do callback, então
 * lançar isto garante que nenhuma escrita (nem `progress`, nem a ativação da
 * versão) sobrevive quando o claim falha. Nunca deve escapar de
 * `claimAndPublish` — sempre capturada e traduzida para `return false`.
 */
class PublicationClaimLostError extends Error {}

export function scheduleTrainingRun(trainingRunId: string, ports: MlTrainingRunWorkerPorts): void {
  void processRun(trainingRunId, ports).catch((error) => {
    // Falha inesperada no próprio worker (não no treino) — nunca deixa o
    // run travado em RUNNING; loga server-side, nunca vaza detalhe.
    console.error(`[ml-training-run] worker falhou para ${trainingRunId}:`, error);
  });
}

async function processRun(trainingRunId: string, ports: MlTrainingRunWorkerPorts): Promise<void> {
  const service = createMlTrainingRunService(ports.prisma);
  const sleep = ports.sleep ?? defaultSleep;

  const queued = await service.get(trainingRunId);
  // Bloqueador 9/19 (revisão Guardião): jobId GERADO E PERSISTIDO no
  // MlTrainingRun ANTES de qualquer chamada ao motor Python — elimina a
  // janela persistência→efeito em que uma resposta de start perdida (timeout
  // de rede) deixaria um processo Python órfão sem ID conhecido do lado
  // Node. `trainJobPort.start` é idempotente para este jobId.
  const jobId = randomUUID().replace(/-/g, '');
  const running = await service.transition(trainingRunId, 'QUEUED', {
    status: 'RUNNING',
    phase: 'SNAPSHOT',
    progress: 5,
    startedAt: new Date(),
    pythonJobId: jobId,
  });
  if (!running) {
    // QUEUED -> RUNNING falhou: outro caminho já mudou o status (cancelado
    // antes do worker sequer iniciar o job Python). Como nenhum job chegou
    // a existir, não há processo para encerrar — só finaliza o registro.
    const current = await service.get(trainingRunId);
    if (current.status === 'CANCEL_REQUESTED') {
      await finalizeAsCancelled(service, trainingRunId);
    }
    return;
  }

  try {
    await ports.trainJobPort.start(jobId, queued.symbols);
  } catch (error) {
    // Bloqueador 9/19: perda/timeout de resposta do POST /ml/train-jobs não
    // significa necessariamente que o processo Python não iniciou — o
    // jobId já está persistido, então recupera por consulta de status antes
    // de desistir. Só falha o run se o motor também não reconhecer o jobId.
    try {
      const recovered = await ports.trainJobPort.getStatus(jobId);
      if (recovered.state === 'UNKNOWN') {
        await failRun(service, trainingRunId, 'RUNNING', error);
        return;
      }
      // motor reconhece o job (start realmente aconteceu apesar da resposta
      // perdida) — segue para o loop de polling normalmente.
    } catch {
      await failRun(service, trainingRunId, 'RUNNING', error);
      return;
    }
  }

  let lastPhase = 'SNAPSHOT';
  let lastProgress = 5;

  for (let i = 0; i < MAX_POLL_ITERATIONS; i += 1) {
    const current = await service.get(trainingRunId);

    if (current.status === 'CANCEL_REQUESTED') {
      // Bloqueador 17 (revisão Guardião): só finaliza CANCELLED quando a
      // árvore de processos é CONFIRMADAMENTE encerrada. Sem confirmação,
      // NÃO terminaliza — tenta de novo na próxima iteração do polling em
      // vez de mentir sobre o estado do processo.
      const confirmed = await tryConfirmPythonJobStopped(ports.trainJobPort, jobId);
      if (confirmed) {
        await finalizeAsCancelled(service, trainingRunId);
        return;
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (current.status !== 'RUNNING') {
      return; // já finalizado por outro caminho (defensivo)
    }

    let status: TrainJobStatus;
    try {
      status = await ports.trainJobPort.getStatus(jobId);
    } catch (error) {
      await failRun(service, trainingRunId, 'RUNNING', error);
      return;
    }

    // Item C: atualiza fase/progresso de forma limitada — só escreve
    // quando o valor reportado pelo Python realmente muda, nunca a cada
    // amostra de treino (spec §5).
    if (status.phase !== lastPhase || status.progress !== lastProgress) {
      await service.transition(trainingRunId, 'RUNNING', { phase: mapPhase(status.phase), progress: Math.min(status.progress, 94) });
      lastPhase = status.phase;
      lastProgress = status.progress;
    }

    if (status.state === 'RUNNING') {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (status.state === 'UNKNOWN') {
      // Bloqueador 2: o motor Python não reconhece mais este jobId (ex.:
      // reiniciou e perdeu o metadado em disco, ou o PID foi reciclado por
      // outro processo). Nunca inventamos SUCCEEDED/CANCELLED aqui — vira
      // uma falha explícita e auditável, nunca um estado silenciosamente
      // mascarado.
      await terminalizeAsFailed(service, trainingRunId, {
        errorCode: 'UPSTREAM_ERROR',
        errorSummary: 'motor de treino perdeu o registro do job (possível restart) — encerrado por segurança',
      });
      return;
    }

    if (status.state === 'CANCELLED') {
      await finalizeAsCancelled(service, trainingRunId);
      return;
    }

    if (status.state === 'FAILED') {
      await terminalizeAsFailed(service, trainingRunId, {
        errorCode: toKnownErrorCode(status.errorCode),
        errorSummary: sanitizeErrorSummary(status.errorCode ?? 'erro no motor de treino'),
      });
      return;
    }

    // status.state === 'SUCCEEDED'
    if (!status.result) {
      await terminalizeAsFailed(service, trainingRunId, {
        errorCode: 'TRAINING_ERROR',
        errorSummary: 'motor de treino reportou sucesso sem resultado',
      });
      return;
    }

    await finalizeSucceeded(service, ports, trainingRunId, queued, status.result);
    return;
  }

  // Teto de segurança atingido: nunca deixa "RUNNING" para sempre. Tenta
  // confirmar o encerramento do processo Python antes de terminalizar —
  // Bloqueador 17: nunca finaliza FAILED silenciosamente enquanto a árvore
  // de processos ainda puder estar viva sem que isso fique auditável.
  const confirmedAtTimeout = await tryConfirmPythonJobStopped(ports.trainJobPort, jobId);
  await terminalizeAsFailed(service, trainingRunId, {
    errorCode: confirmedAtTimeout ? 'TRAINING_ERROR' : 'RECONCILE_UNCONFIRMED',
    errorSummary: confirmedAtTimeout
      ? 'treino excedeu o teto de tempo de acompanhamento'
      : 'treino excedeu o teto de tempo de acompanhamento e o encerramento do processo Python não pôde ser confirmado — requer investigação manual',
  });
}

function mapPhase(pythonPhase: string): MlTrainingRun['phase'] {
  return pythonPhase === 'SNAPSHOT' || pythonPhase === 'DATASET' || pythonPhase === 'TRAINING' ? pythonPhase : 'TRAINING';
}

/**
 * Bloqueador 2 (revisão Guardião): tenta cancelar o job Python e retorna
 * `true` SOMENTE se o motor confirmou o encerramento do processo
 * (`processConfirmedTerminated`) ou já não reconhece mais o jobId
 * (`UNKNOWN` — nada rodando para encerrar). Se o motor Python estiver
 * inacessível, ou reportar o job como ainda `RUNNING` sem confirmar
 * cancelamento, retorna `false` — o chamador NUNCA deve marcar o run como
 * `CANCELLED`/`INTERRUPTED` nesse caso, para não esconder um processo
 * potencialmente vivo.
 */
async function tryConfirmPythonJobStopped(trainJobPort: MlTrainJobPort, jobId: string): Promise<boolean> {
  try {
    const status = await trainJobPort.getStatus(jobId);
    if (status.state === 'UNKNOWN') return true;
    if (status.state !== 'RUNNING') return true; // já terminou (sucesso/erro/cancelado) do lado Python
  } catch {
    // segue para tentar cancelar mesmo sem conseguir consultar status
  }
  try {
    const result = await trainJobPort.cancel(jobId);
    return result.processConfirmedTerminated;
  } catch {
    return false;
  }
}

async function finalizeAsCancelled(service: MlTrainingRunService, trainingRunId: string): Promise<void> {
  const current = await service.get(trainingRunId);
  if (current.status !== 'CANCEL_REQUESTED') return; // já finalizado por outro caminho (defensivo)
  await service.transition(trainingRunId, 'CANCEL_REQUESTED', { status: 'CANCELLED', completedAt: new Date() });
}

/**
 * Item C: nunca assume que o `MlTrainingRun` ainda está em `RUNNING` no
 * momento de marcar uma falha — reconsulta o estado atual primeiro. Um
 * cancelamento pode ter chegado concorrentemente (ex.: o motor Python ficou
 * inacessível exatamente durante uma janela de `CANCEL_REQUESTED`); nesse
 * caso o resultado é sempre `CANCELLED`, nunca `FAILED` (o pedido de
 * cancelamento sempre vence). Um CAS malsucedido contra `RUNNING`
 * hard-coded deixaria o run preso para sempre em `CANCEL_REQUESTED` —
 * bug encontrado e corrigido durante a suíte de testes deste item.
 */
async function terminalizeAsFailed(service: MlTrainingRunService, trainingRunId: string, patch: { errorCode: string; errorSummary: string }): Promise<void> {
  const current = await service.get(trainingRunId);
  if (current.status === 'CANCEL_REQUESTED') {
    await finalizeAsCancelled(service, trainingRunId);
    return;
  }
  if (current.status !== 'RUNNING') return; // já finalizado por outro caminho (defensivo)
  await service.transition(trainingRunId, 'RUNNING', { status: 'FAILED', completedAt: new Date(), ...patch });
}

async function failRun(service: MlTrainingRunService, trainingRunId: string, _expectedStatus: 'RUNNING', error: unknown): Promise<void> {
  // Bloqueador 14 (revisão Guardião): mesmo os códigos internos de
  // `ReadModelError` (ex.: `UPSTREAM_MALFORMED_RESPONSE`) passam pelo
  // mesmo allowlist fail-closed que qualquer `errorCode` vindo do motor
  // Python — o campo público `errorCode` deste recurso só pode conter um
  // dos valores conhecidos em `sanitize.ts`, nunca repassar 1:1 um código
  // interno de outra camada sem revisão explícita.
  const rawCode = error instanceof ReadModelError ? error.code : 'UPSTREAM_ERROR';
  const code = toKnownErrorCode(rawCode);
  const message = error instanceof Error ? error.message : String(error);
  await terminalizeAsFailed(service, trainingRunId, { errorCode: code, errorSummary: sanitizeErrorSummary(message) });
}

/**
 * Item C + Item D: reaproveita a orquestração pós-treino do fluxo síncrono
 * (`DirectionalService.finalizeTraining`) — gate → ResearchRun →
 * DirectionalModelVersion (DRAFT se aprovado, FAILED se não) → publicação por
 * claim CAS. Antes de publicar, reconsulta o status: se um cancelamento foi
 * solicitado enquanto o Python computava, a publicação NUNCA acontece
 * (spec §5) — o run termina `CANCELLED`, nunca `SUCCEEDED` com uma versão
 * ativada depois do pedido de cancelamento.
 */
async function finalizeSucceeded(
  service: MlTrainingRunService,
  ports: MlTrainingRunWorkerPorts,
  trainingRunId: string,
  queued: MlTrainingRun,
  trainResult: DirectionalTrainResponse,
): Promise<void> {
  const preCheck = await service.get(trainingRunId);
  if (preCheck.status === 'CANCEL_REQUESTED') {
    await finalizeAsCancelled(service, trainingRunId);
    return;
  }
  if (preCheck.status !== 'RUNNING') return;

  await service.transition(trainingRunId, 'RUNNING', { phase: 'GATE', progress: 96 });

  try {
    const costProfileService = createBacktestCostProfileService(ports.prisma);
    const costProfile = await costProfileService.resolveActiveForTraining(queued.costProfileId);

    const mlApi = createHttpDirectionalMlApiPort(ports.mlApiBaseUrl);
    const directionalService = new DirectionalService({ mlApi, prisma: ports.prisma });
    // LOTE 2 (Item C, correção da corrida cancel/publicação, 2026-07-23):
    // `claimAndPublish` é o CLAIM CAS real: uma ÚNICA transação Prisma que
    // (a) só afeta o `MlTrainingRun` se `status='RUNNING'` no exato momento
    // do UPDATE e (b) SÓ SE essa condição valer, ativa a
    // `DirectionalModelVersion` (DRAFT → ACTIVE) na MESMA transação. Isso
    // fecha a janela de corrida do desenho anterior (bloqueadores 3/17/18):
    // um `UPDATE ... WHERE status='RUNNING'` que só tocasse `progress` deixaria
    // um cancelamento concorrente vencer a corrida entre esse UPDATE e a
    // ativação da versão. A versão já nasceu DRAFT antes deste ponto — se o
    // UPDATE afetar 0 linhas, a transação inteira é abortada (nada é ativado)
    // e a versão permanece DRAFT para sempre, órfã mas auditável via
    // `ResearchRun`.
    const claimAndPublish = async (modelVersion: string): Promise<boolean> => {
      try {
        await ports.prisma.$transaction(async (tx) => {
          const { count } = await tx.mlTrainingRun.updateMany({
            where: { trainingRunId, status: 'RUNNING' },
            data: { progress: 97 },
          });
          if (count === 0) throw new PublicationClaimLostError();
          const activated = await tx.directionalModelVersion.updateMany({
            where: { modelVersion, status: 'DRAFT' },
            data: { status: 'ACTIVE' },
          });
          if (activated.count === 0) throw new PublicationClaimLostError();
        });
        return true;
      } catch (error) {
        if (error instanceof PublicationClaimLostError) return false;
        throw error;
      }
    };
    const result = await directionalService.finalizeTraining(queued.requestedBy, costProfile, trainResult, { claimAndPublish });

    const postCheck = await service.get(trainingRunId);
    const expectedStatus = postCheck.status === 'CANCEL_REQUESTED' ? 'CANCEL_REQUESTED' : 'RUNNING';
    const finalStatus = expectedStatus === 'CANCEL_REQUESTED'
      // Mesmo com o gate aprovado, `result.publicationAborted` garante que a
      // versão ficou DRAFT para sempre — nunca ativada depois do cancelamento.
      ? 'CANCELLED'
      : result.gate.approved
        ? 'SUCCEEDED'
        : 'REJECTED';

    await service.transition(trainingRunId, expectedStatus, {
      status: finalStatus,
      phase: 'FINALIZING',
      progress: 100,
      researchRunId: result.researchRunId,
      // Só referencia a versão quando ela de fato ficou servível — uma versão
      // presa em DRAFT (claim perdido) não é apontada como resultado do run.
      modelVersionId: result.status === 'ACTIVE' ? result.modelVersion : null,
      gate: { approved: result.gate.approved, checks: result.gate.checks },
      // Resumo do FATOR (o escore composto não emite acurácia/Brier — ver
      // `ml-directional`): informação, significância, retorno do topo e
      // consistência. É o que o acompanhamento do treino precisa mostrar.
      metrics: {
        nSamples: trainResult.metrics.nSamples,
        nPeriods: trainResult.metrics.nPeriods ?? 0,
        ic: trainResult.metrics.ic ?? null,
        icTStat: trainResult.metrics.icTStat ?? null,
        topBottomSpread: trainResult.metrics.topBottomSpread ?? null,
        positiveYearsRatio: trainResult.metrics.positiveYearsRatio ?? null,
      },
      completedAt: new Date(),
    });
  } catch (error) {
    const code = error instanceof ReadModelError ? error.code : 'INTERNAL_ERROR';
    const message = error instanceof Error ? error.message : String(error);
    const current = await service.get(trainingRunId);
    const expectedStatus = current.status === 'CANCEL_REQUESTED' ? 'CANCEL_REQUESTED' : 'RUNNING';
    await service.transition(trainingRunId, expectedStatus, {
      status: expectedStatus === 'CANCEL_REQUESTED' ? 'CANCELLED' : 'FAILED',
      errorCode: code,
      errorSummary: sanitizeErrorSummary(message),
      completedAt: new Date(),
    });
  }
}

/**
 * Item C / spec §5: se a plataforma reiniciar, `QUEUED/RUNNING/
 * CANCEL_REQUESTED` nunca ficam eternamente ativos. Como o registro
 * in-memory do worker (loop de polling) não sobrevive ao restart do Node,
 * a política é conservadora: tenta encerrar o job Python associado (se
 * houver `pythonJobId`) e sempre finaliza como `CANCELLED` (se o
 * cancelamento já havia sido pedido) ou `INTERRUPTED` (caso contrário) —
 * nunca tenta "retomar" um polling que não tem mais dono.
 */
let reconciledOnce: Promise<void> | null = null;

/**
 * Item C / spec §5: dispara `reconcileOnStartup` exatamente uma vez por
 * processo Node, na primeira requisição que tocar qualquer rota
 * `/api/v1/ml/training-runs*`. Evita depender de `instrumentation.ts`
 * (mudança de configuração fora do escopo deste item) enquanto ainda
 * garante que nenhum run fica preso em `QUEUED/RUNNING/CANCEL_REQUESTED`
 * para sempre depois de um restart — a primeira rota chamada após o boot
 * reconcilia antes de responder.
 */
export function ensureReconciledOnce(ports: MlTrainingRunWorkerPorts): Promise<void> {
  if (!reconciledOnce) {
    reconciledOnce = reconcileOnStartup(ports).catch((error) => {
      console.error('[ml-training-run] reconciliação de boot falhou:', error);
    });
  }
  return reconciledOnce;
}

export async function reconcileOnStartup(ports: MlTrainingRunWorkerPorts): Promise<void> {
  const service = createMlTrainingRunService(ports.prisma);
  const pending = await service.listNonTerminal();

  for (const run of pending) {
    // Bloqueador 2 (revisão Guardião): só finaliza como CANCELLED/
    // INTERRUPTED depois de CONFIRMAR (via status/cancel do motor Python)
    // que o processo antigo não está mais rodando. Sem `pythonJobId` nunca
    // houve processo Python a confirmar — finaliza direto. Com
    // `pythonJobId` e sem confirmação, registra `RECONCILE_UNCONFIRMED`
    // (auditável) e deixa o run como está, para uma tentativa futura de
    // reconciliação em vez de mascarar um processo potencialmente vivo.
    const confirmed = run.pythonJobId ? await tryConfirmPythonJobStopped(ports.trainJobPort, run.pythonJobId) : true;

    if (!confirmed) {
      // Não muda `status` (permanece não-terminal, para nova tentativa) —
      // só anota o erro/observação para auditoria. `patch.status` fica
      // ausente de propósito: incluir o mesmo status como "transição"
      // falharia a validação da máquina de estados (que não permite
      // self-loops), e não há necessidade de mudar o estado aqui.
      await service.transition(run.trainingRunId, run.status, {
        errorCode: 'RECONCILE_UNCONFIRMED',
        errorSummary: 'reconciliação pós-restart não conseguiu confirmar o encerramento do processo Python — status mantido para nova tentativa',
      });
      continue;
    }

    const finalStatus = run.status === 'CANCEL_REQUESTED' ? 'CANCELLED' : 'INTERRUPTED';
    await service.transition(run.trainingRunId, run.status, {
      status: finalStatus,
      errorCode: finalStatus === 'INTERRUPTED' ? 'INTERNAL_ERROR' : undefined,
      errorSummary: finalStatus === 'INTERRUPTED' ? 'processo reiniciado durante o treino — encerrado por segurança' : undefined,
      completedAt: new Date(),
    });
  }
}
