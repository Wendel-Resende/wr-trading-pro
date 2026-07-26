import type { PrismaClient } from '@prisma/client';
import { createResearchRunService } from '../research-run';
import { createBacktestCostProfileService } from '../backtest-cost-profile';
import { ReadModelError } from '../read-models-v1/errors';
import { PrismaDirectionalRepository } from '../../adapters/prisma/ml-directional';
import type { DirectionalRepository } from '../../domain/v1/ports/ml-directional-repository';
import type {
  DirectionalModelStatus,
  DirectionalModelVersion,
  DirectionalPrediction,
} from '../../domain/v1/models/ml-directional';
import { withNetEconomics } from './costs';
import { evaluateDirectionalGate, type DirectionalGateResult } from './gate';
import type { DirectionalMlApiPort, DirectionalTrainResponse } from './port';

/**
 * Item D — orquestração do classificador direcional.
 *
 * Divisão de responsabilidade idêntica ao resto do motor ML: o Python treina
 * e prevê; TODA a governança (ResearchRun, gate, versão ativa, persistência
 * de sinais) vive aqui. O gate é reavaliado NO SERVIDOR a partir das métricas
 * recebidas — nunca se confia num "aprovado" vindo do upstream.
 */

const MODEL_LABEL = 'directional-ensemble-v1';

export interface DirectionalServicePorts {
  readonly prisma: PrismaClient;
  readonly mlApi: DirectionalMlApiPort;
  readonly repository?: DirectionalRepository;
}

export interface RunDirectionalTrainingResult {
  readonly researchRunId: string;
  readonly modelVersion: string;
  readonly status: DirectionalModelStatus;
  readonly gate: DirectionalGateResult;
  readonly model: DirectionalModelVersion;
  /**
   * `true` quando o gate aprovou mas o claim CAS falhou (cancelamento venceu
   * a corrida): a versão permanece DRAFT para sempre, nunca servível.
   */
  readonly publicationAborted: boolean;
}

export interface GenerateDirectionalPredictionsResult {
  readonly modelVersion: string;
  readonly universeDigest: string;
  readonly generatedAt: string;
  readonly saved: number;
  readonly predictions: readonly DirectionalPrediction[];
}

export class DirectionalService {
  private readonly repository: DirectionalRepository;

  constructor(private readonly ports: DirectionalServicePorts) {
    this.repository = ports.repository ?? new PrismaDirectionalRepository(ports.prisma);
  }

  /**
   * Treina, registra proveniência e aplica o gate.
   *
   * `costProfileId` é obrigatório pelo mesmo motivo do Item A (D5): nenhum
   * número econômico da plataforma nasce de custo default. Aqui ele não
   * alimenta um backtest ainda, mas amarra o treino a um perfil de custo
   * versionado e auditável — sem ele, um modelo aprovado não teria como ser
   * comparado economicamente depois.
   *
   * O `ResearchRun` é criado SEMPRE, aprovado ou não: um treino reprovado é
   * exatamente o que precisa ficar registrado.
   */
  async runTraining(
    createdBy: string,
    costProfileId: string,
    symbols?: readonly string[],
  ): Promise<RunDirectionalTrainingResult> {
    if (!costProfileId) {
      throw new ReadModelError('COST_PROFILE_REQUIRED', 'informe um BacktestCostProfile — nenhum custo default é aceito');
    }
    const costProfileService = createBacktestCostProfileService(this.ports.prisma);
    const costProfile = await costProfileService.resolveActiveForTraining(costProfileId);

    const trainResult = await this.ports.mlApi.train(symbols);
    return this.finalizeTraining(createdBy, costProfile, trainResult);
  }

  /**
   * Orquestração pós-treino, compartilhada entre o fluxo síncrono
   * (`runTraining`) e o worker assíncrono do Item C
   * (`src/application/ml-training-run/worker.ts`), que já tem o resultado em
   * mãos — obtido via job Python cancelável, nunca via chamada bloqueante.
   *
   * `hooks.claimAndPublish` é o CLAIM CAS: a versão aprovada nasce **DRAFT**
   * (inerte, invisível na UI, incapaz de gerar sinal) e só vira ACTIVE se o
   * claim confirmar, numa única transação, que o `MlTrainingRun` dono do
   * treino ainda estava RUNNING. Um cancelamento que vença a corrida deixa a
   * versão DRAFT para sempre. Sem hooks (fluxo síncrono, não cancelável), a
   * publicação é imediata.
   */
  async finalizeTraining(
    createdBy: string,
    costProfile: {
      readonly id: string;
      readonly version: number;
      readonly emolumentsPct?: number;
      readonly spreadBps?: number;
      readonly slippageBps?: number;
    },
    trainResult: DirectionalTrainResponse,
    hooks?: { readonly claimAndPublish?: (modelVersion: string) => Promise<boolean> },
  ): Promise<RunDirectionalTrainingResult> {
    const researchRunService = createResearchRunService(this.ports.prisma);
    const researchRun = await researchRunService.submit(
      {
        name: MODEL_LABEL,
        hypothesis:
          'fundamentos CVM point-in-time preveem o EXCESSO de retorno sobre os pares em 60 pregões '
          + '(alvo relativo desde 2026-07-25: o alvo absoluto embutia o movimento de mercado, que '
          + 'fundamentos trimestrais não preveem)',
        datasetId: `sha256:${trainResult.datasetDigest}`,
        windowStart: toInstant(trainResult.windowStart),
        windowEnd: toInstant(trainResult.windowEnd),
        paramsJson: JSON.stringify({
          hyperparameters: trainResult.hyperparameters,
          features: trainResult.features,
          horizonTradingDays: trainResult.horizonTradingDays,
          targetMode: trainResult.targetMode ?? 'absolute',
          gate: trainResult.gate,
          universeBarsDigest: trainResult.universeBarsDigest,
          universeSize: trainResult.universe.length,
          costProfileId: costProfile.id,
          costProfileVersion: costProfile.version,
        }),
      },
      createdBy,
    );

    // Custos aplicados NO SERVIDOR, a partir do perfil versionado do treino —
    // o motor Python reporta economia bruta e nunca opina sobre custo.
    const metrics = withNetEconomics(trainResult.metrics, {
      emolumentsPct: costProfile.emolumentsPct ?? 0,
      spreadBps: costProfile.spreadBps ?? 0,
      slippageBps: costProfile.slippageBps ?? 0,
    });

    // Gate reavaliado no servidor a partir das métricas — o upstream não vota.
    const gate = evaluateDirectionalGate(metrics);
    // Aprovado nasce DRAFT quando há claim a fazer (treino cancelável);
    // reprovado já nasce FAILED — não há o que publicar.
    const initialStatus: DirectionalModelStatus = gate.approved
      ? (hooks?.claimAndPublish ? 'DRAFT' : 'ACTIVE')
      : 'FAILED';

    const existing = await this.repository.findModelVersionById(trainResult.modelVersion);
    // Retreino idempotente: a mesma `modelVersion` (mesmos dados, mesma
    // configuração) já registrada não cria uma segunda linha nem reabre o
    // veredito do gate — devolve o que já está persistido.
    let model =
      existing ??
      (await this.repository.createModelVersion({
        modelVersion: trainResult.modelVersion,
        researchRunId: researchRun.runId,
        metrics,
        artifactPath: trainResult.artifactPath,
        status: initialStatus,
        gateFailures: gate.failures,
      }));

    let publicationAborted = false;

    if (gate.approved && model.status === 'DRAFT' && hooks?.claimAndPublish) {
      const published = await hooks.claimAndPublish(model.modelVersion);
      if (published) {
        model = await this.repository.publish(model.modelVersion);
      } else {
        // Claim perdido: cancelamento venceu a corrida. A versão fica DRAFT
        // para sempre — nunca servível, mas auditável pelo ResearchRun.
        publicationAborted = true;
      }
    }

    if (model.status === 'ACTIVE') {
      await researchRunService.linkModelVersion(researchRun.runId, model.modelVersion);
      await this.repository.supersedeOthers(model.modelVersion);
    }

    return {
      researchRunId: researchRun.runId,
      modelVersion: model.modelVersion,
      status: model.status,
      gate,
      model,
      publicationAborted,
    };
  }

  /**
   * Gera e persiste as previsões vivas de uma versão ACTIVE.
   *
   * Modelo reprovado no gate (FAILED) ou substituído (SUPERSEDED) nunca gera
   * sinal: é a mesma regra da UI, aplicada no servidor para que uma chamada
   * direta à API não contorne o gate.
   */
  async generatePredictions(modelVersion: string, symbols?: readonly string[]): Promise<GenerateDirectionalPredictionsResult> {
    const model = await this.repository.findModelVersionById(modelVersion);
    if (!model) {
      throw new ReadModelError('MODEL_VERSION_NOT_FOUND', `modelo direcional ${modelVersion} não encontrado`);
    }
    if (model.status !== 'ACTIVE') {
      throw new ReadModelError(
        'INVALID_STATE',
        `modelo direcional ${modelVersion} está ${model.status} — apenas modelos ACTIVE (aprovados no gate) geram sinais`,
      );
    }

    const response = await this.ports.mlApi.predict(modelVersion, symbols);
    if (response.modelVersion !== modelVersion) {
      throw new ReadModelError(
        'UPSTREAM_MALFORMED_RESPONSE',
        'motor ML respondeu com uma versão de modelo diferente da solicitada',
      );
    }

    const saved = await this.repository.savePredictions(
      response.predictions.map((p) => ({
        modelVersion,
        cdCvm: p.cdCvm,
        ticker: p.ticker,
        signal: p.signal,
        confidence: p.confidence,
        prob: p.prob,
        score: p.score ?? null,
        quantile: p.quantile ?? null,
        knowledgeDate: toInstant(p.knowledgeDate),
        topFeatures: p.topFeatures,
        universeDigest: response.universeDigest,
        generatedAt: response.generatedAt,
      })),
    );

    const predictions = await this.repository.listLatestPredictions(modelVersion);
    return {
      modelVersion,
      universeDigest: response.universeDigest,
      generatedAt: response.generatedAt,
      saved,
      predictions,
    };
  }

  async listModels(params: {
    readonly status?: DirectionalModelStatus;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<readonly DirectionalModelVersion[]> {
    return this.repository.listModelVersions(params);
  }

  async getModel(modelVersion: string): Promise<DirectionalModelVersion> {
    const model = await this.repository.findModelVersionById(modelVersion);
    if (!model) {
      throw new ReadModelError('MODEL_VERSION_NOT_FOUND', `modelo direcional ${modelVersion} não encontrado`);
    }
    return model;
  }

  async listPredictions(modelVersion: string): Promise<readonly DirectionalPrediction[]> {
    await this.getModel(modelVersion);
    return this.repository.listLatestPredictions(modelVersion);
  }
}

/**
 * O motor Python trafega datas em `YYYY-MM-DD`; os schemas de domínio exigem
 * timestamp ISO-8601 completo. Normaliza para meia-noite UTC sem alterar
 * valores que já trazem componente de hora.
 */
function toInstant(value: string): string {
  return value.includes('T') ? value : `${value}T00:00:00.000Z`;
}

export function createDirectionalService(ports: DirectionalServicePorts): DirectionalService {
  return new DirectionalService(ports);
}
