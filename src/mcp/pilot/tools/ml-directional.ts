/**
 * MCP Piloto — tools do escore de fator direcional (Item D).
 *
 * Reposição de uma lacuna: as tools `ml.run_prediction`/`ml.run_backtest`
 * foram removidas com o motor híbrido (rodavam heurísticas MA Crossover /
 * Regressão Linear que se apresentavam como ML), e a substituição prevista no
 * plano nunca foi feita — o agente ficou sem superfície nenhuma de ML.
 *
 * ARQUITETURA: falam com a camada de aplicação DIRETAMENTE, como as tools
 * `trade.*`, e não por HTTP contra `/api/v1/*`. Motivo concreto:
 * `resolveRequestedBy` deriva o principal do COOKIE DE SESSÃO, e o piloto
 * autentica por Bearer (`WR_SERVICE_TOKEN`) — toda rota `/api/v1/ml/*`
 * responderia `UNAUTHENTICATED` para o agente.
 *
 * `requestedBy` é FIXADO aqui como `'mcp:hermes'`, nunca vem do argumento —
 * mesma regra de segurança do trilho de trade (um agente que pudesse variar a
 * identidade contornaria qualquer limite por requisitante).
 *
 * PRIVILÉGIO: todas `'free'`. Neste catálogo `'gated'` significa
 * especificamente "passa pelo trilho propose/approve com código de
 * confirmação", e são exatamente as 4 tools `trade.*`. O treino NÃO passa por
 * esse trilho, então rotulá-lo `gated` seria mentir sobre a proteção que ele
 * tem. As guardas reais do treino são outras, e estão documentadas em
 * `ml.directional_train`.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { parseToolArgs, toToolError, type McpToolDefinition } from '../../tools/registry-types';
import {
  createDirectionalService,
  createHttpDirectionalMlApiPort,
  toDirectionalModelVersionPublicDTO,
  toDirectionalPredictionPublicDTO,
} from '../../../application/ml-directional';
import { createBacktestCostProfileService } from '../../../application/backtest-cost-profile';
import {
  createHttpMlTrainJobPort,
  createMlTrainingRunService,
  ensureReconciledOnce,
  scheduleTrainingRun,
  toMlTrainingRunPublicDTO,
} from '../../../application/ml-training-run';
import { ReadModelError } from '../../../application/read-models-v1/errors';

const MCP_REQUESTED_BY = 'mcp:hermes';

function mlApiBaseUrl(): string {
  return process.env.WR_ML_API_URL ?? 'http://127.0.0.1:5560';
}

function json(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

export function buildMlDirectionalTools(prisma: PrismaClient): readonly McpToolDefinition[] {
  const directional = () =>
    createDirectionalService({ prisma, mlApi: createHttpDirectionalMlApiPort(mlApiBaseUrl()) });
  const trainingPorts = () => ({
    prisma,
    trainJobPort: createHttpMlTrainJobPort(mlApiBaseUrl()),
    mlApiBaseUrl: mlApiBaseUrl(),
  });

  return [
    {
      name: 'ml.directional_model',
      description:
        'Modelo de fator ativo: métricas out-of-sample (IC, t-stat, excesso por quintil, spread topo-fundo, '
        + 'consistência entre anos) e a conferência dos 5 gates de aceitação. Consulte ANTES de repassar um '
        + 'ranking, para saber com que evidência ele existe.',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try {
          const ativos = await directional().listModels({ status: 'ACTIVE', limit: 5 });
          if (ativos.length === 0) {
            return json({
              active: null,
              aviso: 'Nenhum modelo passou nos gates de aceitação — a plataforma não emite sinal. '
                + 'Não infira ranking na ausência de modelo ativo.',
            });
          }
          return json({ active: toDirectionalModelVersionPublicDTO(ativos[0]) });
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: 'ml.directional_ranking',
      description:
        'Ranking transversal mais recente das empresas pelo escore de fator fundamentalista (horizonte de 60 '
        + 'pregões). Devolve quintil, percentil e escore por empresa — NÃO é probabilidade de subir. Vem '
        + 'acompanhado da evidência do modelo e das empresas excluídas do universo validado.',
      privilege: 'free',
      inputSchema: {
        // Filtro por QUINTIL, não por sinal de compra/venda: o motor ordena,
        // não recomenda. 1 = fundo do ranking, 5 = topo.
        quantile: z.number().int().min(1).max(5).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      handler: async (args) => {
        try {
          const { quantile, limit } = parseToolArgs(
            { quantile: z.number().int().min(1).max(5).optional(), limit: z.number().int().min(1).max(200).optional() },
            args,
          );
          const service = directional();
          const ativos = await service.listModels({ status: 'ACTIVE', limit: 1 });
          if (ativos.length === 0) {
            return json({
              ranking: [],
              aviso: 'Nenhum modelo ativo — não há ranking. Não invente ordenação a partir de fundamentos crus.',
            });
          }
          const modelo = ativos[0];
          const previsoes = await service.listPredictions(modelo.modelVersion);
          const filtradas = (quantile ? previsoes.filter((p) => p.quantile === quantile) : previsoes)
            .slice(0, limit ?? 200)
            .map(toDirectionalPredictionPublicDTO);

          // A evidência viaja JUNTO com o dado: sem isso o agente repassaria o
          // ranking como verdade, sem as ressalvas que a tela mostra.
          return json({
            modelVersion: modelo.modelVersion,
            geradoEm: filtradas[0]?.generatedAt ?? null,
            evidencia: {
              ic: modelo.metrics.ic,
              icTStat: modelo.metrics.icTStat,
              spreadTopoFundo: modelo.metrics.topBottomSpread,
              anosPositivos: modelo.metrics.positiveYearsRatio,
              excessoPorQuintil: modelo.metrics.quantileExcess,
            },
            ressalvas: [
              'O escore ORDENA empresas dentro do trimestre; não estima probabilidade de alta.',
              'A posição é o QUINTIL (5 = topo, 1 = fundo). Não é recomendação de compra ou venda — '
                + 'estar no quintil 5 significa "melhor ranqueada entre as pares neste trimestre", nada além disso.',
              'Métricas herdam viés de sobrevivência: o universo são as empresas listadas hoje.',
              'Empresas sem série de preços ficam FORA do ranking — ver `excluidasDoUniverso` na geração.',
            ],
            ranking: filtradas,
          });
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: 'ml.cost_profiles',
      description:
        'Perfis de custo (BacktestCostProfile) ativos. Necessário para treinar: nenhum treino aceita custo '
        + 'default — o perfil escolhido fica gravado na proveniência e alimenta a economia líquida do gate.',
      privilege: 'free',
      inputSchema: {},
      handler: async () => {
        try {
          const perfis = await createBacktestCostProfileService(prisma).listActive(20);
          return json(perfis.map((p) => ({ id: p.id, label: p.label, version: p.version })));
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: 'ml.directional_train',
      description:
        'Dispara um treino do escore de fator. Use SOMENTE quando o usuário pedir explicitamente — é operação '
        + 'cara (minutos de CPU) que cria estado governado (MlTrainingRun, ResearchRun, versão de modelo). '
        + 'Responde imediatamente com o id para acompanhar via `ml.training_status`; o trabalho roda em '
        + 'processo separado e é cancelável.',
      privilege: 'free',
      inputSchema: { costProfileId: z.string().min(1).max(64) },
      handler: async (args) => {
        try {
          const { costProfileId } = parseToolArgs({ costProfileId: z.string().min(1).max(64) }, args);
          const ports = trainingPorts();
          // Mesma reconciliação de boot que a rota faz: um restart do Node não
          // pode deixar run anterior preso em RUNNING para sempre.
          await ensureReconciledOnce(ports);

          const costProfile = await createBacktestCostProfileService(prisma).resolveActiveForTraining(costProfileId);
          const service = createMlTrainingRunService(prisma);
          const run = await service.requestTraining(
            MCP_REQUESTED_BY,
            costProfile.id,
            costProfile.version,
            null, // universo canônico resolvido pelo motor — o agente não escolhe símbolos
          );
          scheduleTrainingRun(run.trainingRunId, ports);
          return json({
            ...toMlTrainingRunPublicDTO(run),
            aviso: 'Treino aceito e rodando fora deste request. Acompanhe com `ml.training_status`. '
              + 'Um modelo só fica servível se passar nos 5 gates — reprovação é resultado legítimo.',
          });
        } catch (error) {
          return toToolError(error);
        }
      },
    },
    {
      name: 'ml.training_status',
      description:
        'Estado do treino mais recente (ou de um id específico): status, fase, progresso, veredito dos gates e '
        + 'métricas do fator. Sem isto o agente dispara um treino e nunca consegue relatar o desfecho.',
      privilege: 'free',
      inputSchema: { trainingRunId: z.string().min(1).max(64).optional() },
      handler: async (args) => {
        try {
          const { trainingRunId } = parseToolArgs({ trainingRunId: z.string().min(1).max(64).optional() }, args);
          const service = createMlTrainingRunService(prisma);
          if (trainingRunId) {
            return json(toMlTrainingRunPublicDTO(await service.get(trainingRunId)));
          }
          const recentes = await service.list(1);
          if (recentes.length === 0) {
            throw new ReadModelError('TRAINING_RUN_NOT_FOUND', 'nenhum treino registrado ainda');
          }
          return json(toMlTrainingRunPublicDTO(recentes[0]));
        } catch (error) {
          return toToolError(error);
        }
      },
    },
  ];
}
