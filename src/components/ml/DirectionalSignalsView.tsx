'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';

/**
 * Item D (§4.6) — aba Previsões ML.
 *
 * Consome exclusivamente os DTOs públicos de `/api/v1/ml/directional/*`
 * (nunca `artifactPath`, nunca hiperparâmetro bruto). A tela é deliberadamente
 * honesta: sem modelo aprovado no gate, ela não mostra sinal nenhum — mostra
 * QUAIS gates reprovaram e com que números, para que o usuário nunca opere um
 * modelo que a plataforma considera insuficiente.
 */

interface GateCheck {
  readonly code: string;
  readonly label: string;
  readonly threshold: number;
  readonly observed: number | null;
  readonly passed: boolean;
}

interface DirectionalMetrics {
  readonly nSamples: number;
  readonly nPeriods?: number;
  readonly nFeaturesMedian?: number | null;
  // Métricas do motor de classificação anterior — só existem em versões antigas.
  readonly nHighConfidence?: number;
  readonly accuracy?: number | null;
  readonly accuracyAllSamples?: number;
  readonly brier?: number;
  readonly coverage?: number;
  readonly coveragePeriod?: string | null;
  readonly baselineAllUp?: number;
  readonly baselineOnSignals?: number | null;
  readonly baselineDelta?: number | null;
  readonly calibrated?: boolean;
  readonly brierRaw?: number | null;
  readonly nHighConfidenceRaw?: number | null;
  readonly ic?: number | null;
  readonly icTStat?: number | null;
  readonly icPeriods?: number;
  readonly quantileExcess?: readonly {
    readonly quantile: number;
    readonly n: number;
    readonly meanExcess: number;
    readonly hitRate: number;
  }[];
  readonly topBottomSpread?: number | null;
  readonly spreadByYear?: readonly { readonly testYear: number; readonly spread: number }[];
  readonly positiveYearsRatio?: number | null;
  readonly roundTripCost?: number;
  readonly netQuantileExcess?: readonly {
    readonly quantile: number;
    readonly n: number;
    readonly meanExcess: number;
    readonly hitRate: number;
  }[];
  readonly netTopBottomSpread?: number | null;
  readonly confusionMatrix?: {
    readonly truePositive: number;
    readonly falsePositive: number;
    readonly trueNegative: number;
    readonly falseNegative: number;
  };
  readonly reliability?: readonly {
    readonly binStart: number;
    readonly binEnd: number;
    readonly n: number;
    readonly meanPredicted: number | null;
    readonly observedRate: number | null;
  }[];
  readonly byFold: readonly {
    readonly foldId: number;
    readonly testYear: number;
    readonly n: number;
    readonly nFeatures?: number | null;
    readonly ic?: number | null;
    readonly nHighConfidence?: number;
    readonly accuracy?: number | null;
    readonly brier?: number;
  }[];
}

interface DirectionalModel {
  readonly modelVersion: string;
  readonly createdAt: string;
  readonly researchRunId: string;
  readonly status: 'ACTIVE' | 'FAILED' | 'SUPERSEDED';
  readonly gateApproved: boolean;
  readonly gateFailures: readonly string[];
  readonly gateChecks: readonly GateCheck[];
  readonly metrics: DirectionalMetrics;
}

interface DirectionalPrediction {
  readonly ticker: string;
  readonly cdCvm: string;
  readonly signal: 'COMPRA' | 'VENDA' | 'NEUTRO';
  readonly confidence: number;
  readonly prob: number;
  readonly score?: number | null;
  readonly quantile?: number | null;
  readonly knowledgeDate: string;
  readonly topFeatures: readonly { readonly feature: string; readonly importance: number }[];
  readonly modelVersion: string;
  readonly universeDigest: string;
  readonly generatedAt: string;
}

interface CostProfile {
  readonly id: string;
  readonly version: number;
  readonly label: string;
}

/**
 * Espelha `MlTrainingRunPublicDTO` — nunca `pythonJobId` (infra interna).
 * O treino é assíncrono (Item C): a UI acompanha por polling e pode cancelar
 * de verdade, porque o job Python roda em processo separado.
 */
interface TrainingRun {
  readonly trainingRunId: string;
  readonly status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'REJECTED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'INTERRUPTED';
  readonly phase: 'QUEUED' | 'SNAPSHOT' | 'DATASET' | 'TRAINING' | 'GATE' | 'FINALIZING';
  readonly progress: number;
  readonly researchRunId: string | null;
  readonly modelVersionId: string | null;
  readonly gate: { readonly approved: boolean; readonly checks: readonly GateCheck[] } | null;
  readonly metrics: {
    readonly nSamples: number;
    readonly nHighConfidence: number;
    readonly nPeriods?: number;
    readonly ic?: number | null;
    readonly icTStat?: number | null;
    readonly topBottomSpread?: number | null;
    readonly positiveYearsRatio?: number | null;
  } | null;
  readonly errorCode: string | null;
  readonly errorSummary: string | null;
  readonly createdAt: string;
}

const PHASE_LABELS: Record<TrainingRun['phase'], string> = {
  QUEUED: 'na fila',
  SNAPSHOT: 'congelando barras D1',
  DATASET: 'montando painel fundamentalista',
  TRAINING: 'treinando ensemble (walk-forward)',
  GATE: 'aplicando gates',
  FINALIZING: 'finalizando',
};

const ACTIVE_RUN_STATUSES = new Set(['QUEUED', 'RUNNING', 'CANCEL_REQUESTED']);

interface ApiError {
  readonly code: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
async function getJson<T>(url: string): Promise<{ data: T; meta: Record<string, unknown> }> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const error: ApiError = body?.error ?? { code: String(res.status), message: 'falha na requisição' };
    throw error;
  }
  return { data: body.data as T, meta: (body.meta ?? {}) as Record<string, unknown> };
}

async function postJson<T>(url: string, payload: unknown): Promise<{ data: T; meta: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const error: ApiError = body?.error ?? { code: String(res.status), message: 'falha na requisição' };
    throw error;
  }
  return { data: body.data as T, meta: (body.meta ?? {}) as Record<string, unknown> };
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

function describeError(error: unknown): string {
  return isApiError(error) ? `${error.code}: ${error.message}` : 'erro inesperado';
}

const pct = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;

const num = (value: number | null | undefined, digits = 3): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);

const shortVersion = (v: string): string => `${v.slice(0, 10)}…${v.slice(-6)}`;

// ---------------------------------------------------------------------------
const SIGNAL_STYLES: Record<DirectionalPrediction['signal'], string> = {
  COMPRA: 'bg-green-500/10 text-green-400 border-green-500/40',
  VENDA: 'bg-red-500/10 text-red-400 border-red-500/40',
  NEUTRO: 'bg-gray-700/30 text-gray-400 border-gray-600/40',
};

export default function DirectionalSignalsView(): React.ReactElement {
  const toast = useToast();

  const [activeModels, setActiveModels] = useState<readonly DirectionalModel[]>([]);
  const [allModels, setAllModels] = useState<readonly DirectionalModel[]>([]);
  const [modelsError, setModelsError] = useState<ApiError | null>(null);
  const [loadingModels, setLoadingModels] = useState(true);

  const [selectedVersion, setSelectedVersion] = useState('');
  const [predictions, setPredictions] = useState<readonly DirectionalPrediction[]>([]);
  const [predictionsMeta, setPredictionsMeta] = useState<Record<string, unknown>>({});
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [costProfiles, setCostProfiles] = useState<readonly CostProfile[]>([]);
  const [selectedCostProfileId, setSelectedCostProfileId] = useState('');
  const [training, setTraining] = useState(false);
  const [trainingRun, setTrainingRun] = useState<TrainingRun | null>(null);

  const [signalFilter, setSignalFilter] = useState<'TODOS' | 'ALTA_CONFIANCA'>('ALTA_CONFIANCA');

  const selectedModel = useMemo(
    () => allModels.find((m) => m.modelVersion === selectedVersion) ?? null,
    [allModels, selectedVersion],
  );

  // --- carregamento ------------------------------------------------------
  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const [active, all] = await Promise.all([
        getJson<DirectionalModel[]>('/api/v1/ml/directional/models?status=ACTIVE&limit=20'),
        getJson<DirectionalModel[]>('/api/v1/ml/directional/models?limit=50'),
      ]);
      setActiveModels(active.data);
      setAllModels(all.data);
      setModelsError(null);
      setSelectedVersion((current) => current || active.data[0]?.modelVersion || '');
    } catch (error) {
      // Falha fecha a tela: melhor não mostrar modelo nenhum do que mostrar
      // uma lista parcial como se fosse a completa.
      setActiveModels([]);
      setAllModels([]);
      setModelsError(isApiError(error) ? error : { code: 'INTERNAL_ERROR', message: 'falha ao carregar modelos' });
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const loadCostProfiles = useCallback(async () => {
    try {
      const { data } = await getJson<CostProfile[]>('/api/v1/ml/cost-profiles?limit=50');
      setCostProfiles(data);
    } catch {
      setCostProfiles([]);
    }
  }, []);

  const loadPredictions = useCallback(async (modelVersion: string) => {
    if (!modelVersion) {
      setPredictions([]);
      setPredictionsMeta({});
      return;
    }
    setLoadingPredictions(true);
    try {
      const { data, meta } = await getJson<DirectionalPrediction[]>(
        `/api/v1/ml/directional/predictions?modelVersion=${encodeURIComponent(modelVersion)}`,
      );
      setPredictions(data);
      setPredictionsMeta(meta);
    } catch (error) {
      setPredictions([]);
      setPredictionsMeta({});
      toast.error(`Falha ao carregar sinais — ${describeError(error)}`);
    } finally {
      setLoadingPredictions(false);
    }
  }, [toast]);

  const loadLatestTrainingRun = useCallback(async () => {
    try {
      const { data } = await getJson<TrainingRun[]>('/api/v1/ml/training-runs?limit=1');
      setTrainingRun(data[0] ?? null);
    } catch {
      setTrainingRun(null);
    }
  }, []);

  useEffect(() => {
    void loadModels();
    void loadCostProfiles();
    void loadLatestTrainingRun();
  }, [loadModels, loadCostProfiles, loadLatestTrainingRun]);

  useEffect(() => { void loadPredictions(selectedVersion); }, [selectedVersion, loadPredictions]);

  // Polling do treino em andamento — para sozinho ao terminar e recarrega as
  // versões, para que um modelo recém-aprovado apareça no seletor.
  useEffect(() => {
    if (!trainingRun || !ACTIVE_RUN_STATUSES.has(trainingRun.status)) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const { data } = await getJson<TrainingRun>(`/api/v1/ml/training-runs/${trainingRun.trainingRunId}`);
          setTrainingRun(data);
          if (!ACTIVE_RUN_STATUSES.has(data.status)) await loadModels();
        } catch {
          // Falha pontual de polling não derruba a tela — a próxima iteração tenta de novo.
        }
      })();
    }, 3000);
    return () => clearInterval(timer);
  }, [trainingRun, loadModels]);

  // --- ações -------------------------------------------------------------
  const handleTrain = useCallback(async () => {
    if (!selectedCostProfileId) {
      toast.warning('Selecione um perfil de custos antes de treinar.');
      return;
    }
    setTraining(true);
    try {
      // Treino é assíncrono: responde 202 na hora e o job Python roda em
      // processo separado. A UI acompanha por polling — nunca segura a
      // conexão por minutos.
      const { data } = await postJson<TrainingRun>('/api/v1/ml/training-runs', {
        costProfileId: selectedCostProfileId,
      });
      setTrainingRun(data);
      toast.info('Treino iniciado — acompanhe o progresso abaixo.');
    } catch (error) {
      toast.error(`Falha ao iniciar o treino — ${describeError(error)}`);
    } finally {
      setTraining(false);
    }
  }, [selectedCostProfileId, toast]);

  const handleCancelTraining = useCallback(async () => {
    if (!trainingRun) return;
    try {
      const { data } = await postJson<TrainingRun>(
        `/api/v1/ml/training-runs/${trainingRun.trainingRunId}/cancel`,
        {},
      );
      setTrainingRun(data);
      toast.info('Cancelamento solicitado — o processo de treino será encerrado.');
    } catch (error) {
      toast.error(`Falha ao cancelar — ${describeError(error)}`);
    }
  }, [trainingRun, toast]);

  const handleGenerate = useCallback(async () => {
    if (!selectedVersion) return;
    setGenerating(true);
    try {
      const { data, meta } = await postJson<DirectionalPrediction[]>('/api/v1/ml/directional/predictions', {
        modelVersion: selectedVersion,
      });
      setPredictions(data);
      setPredictionsMeta(meta);
      toast.success(`${meta.highConfidence ?? 0} sinais de alta confiança em ${data.length} empresas.`);
    } catch (error) {
      toast.error(`Falha ao gerar sinais — ${describeError(error)}`);
    } finally {
      setGenerating(false);
    }
  }, [selectedVersion, toast]);

  // --- derivados ---------------------------------------------------------
  const highConfidence = predictions.filter((p) => p.signal !== 'NEUTRO');
  const visiblePredictions = signalFilter === 'ALTA_CONFIANCA' ? highConfidence : predictions;
  const failedModels = allModels.filter((m) => m.status === 'FAILED');
  const trainingRunActive = trainingRun !== null && ACTIVE_RUN_STATUSES.has(trainingRun.status);

  // -----------------------------------------------------------------------
  return (
    <div className="cyber-card p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-orbitron text-xl font-bold neon-text-cyan">
            Escore de fator fundamentalista (60 pregões · 1 trimestre)
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Ordena as empresas dentro de cada trimestre pela média dos percentis das features com sinal
            comprovado. O sinal vem da posição no ranking — não de uma probabilidade estimada.
          </p>
        </div>
        <span
          className={`text-xs font-mono px-3 py-1 rounded border ${
            activeModels.length > 0
              ? 'bg-green-500/20 text-green-400 border-green-500/40'
              : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
          }`}
        >
          {activeModels.length > 0 ? `${activeModels.length} modelo(s) aprovado(s)` : 'nenhum modelo aprovado'}
        </span>
      </div>

      {/* ---------------- Seletor de versão ---------------- */}
      <div className="bg-gray-900/40 border border-gray-800 rounded p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-300">Versão do modelo</p>

        {loadingModels ? (
          <p className="text-xs text-gray-500">Carregando versões…</p>
        ) : modelsError ? (
          <p className="text-xs text-red-400">
            Falha ao carregar versões ({modelsError.code}): {modelsError.message}
          </p>
        ) : activeModels.length === 0 ? (
          <div className="text-xs space-y-2">
            <p className="text-yellow-400">
              Nenhum modelo passou no gate de aceitação — por isso não há sinais a exibir.
            </p>
            <p className="text-gray-500">
              Um modelo só fica disponível se atender aos cinco critérios: IC ≥ 0,02, t ≥ 2,0, excesso do
              quintil superior ≥ 0,5% ao trimestre líquido de custos, spread topo−fundo positivo e ao menos
              60% dos anos com spread positivo. Modelos reprovados ficam registrados abaixo, para auditoria.
            </p>
          </div>
        ) : (
          <select
            value={selectedVersion}
            onChange={(e) => setSelectedVersion(e.target.value)}
            className="w-full max-w-2xl bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm font-mono"
          >
            {activeModels.map((m) => (
              <option key={m.modelVersion} value={m.modelVersion}>
                {shortVersion(m.modelVersion)} · IC {num(m.metrics.ic)} · t {num(m.metrics.icTStat, 2)} ·
                spread {pct(m.metrics.topBottomSpread, 2)} · {new Date(m.createdAt).toLocaleDateString('pt-BR')}
              </option>
            ))}
          </select>
        )}

        {selectedModel && <GatePanel model={selectedModel} />}
      </div>

      {/* ---------------- Sinais ---------------- */}
      <div className="bg-gray-900/40 border border-gray-800 rounded p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm font-semibold text-gray-300">Sinais</p>
          <div className="flex items-center gap-2">
            <select
              value={signalFilter}
              onChange={(e) => setSignalFilter(e.target.value as 'TODOS' | 'ALTA_CONFIANCA')}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
            >
              <option value="ALTA_CONFIANCA">Somente quintis extremos</option>
              <option value="TODOS">Todas as empresas</option>
            </select>
            <button
              onClick={() => void handleGenerate()}
              disabled={!selectedVersion || generating || activeModels.length === 0}
              className="bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 rounded px-3 py-1 text-xs font-semibold"
            >
              {generating ? 'Gerando…' : 'Gerar sinais agora'}
            </button>
          </div>
        </div>

        {Array.isArray(predictionsMeta.excludedFromUniverse) &&
          (predictionsMeta.excludedFromUniverse as string[]).length > 0 && (
            <p className="text-[11px] text-yellow-400/90 bg-yellow-500/5 border border-yellow-500/20 rounded p-2">
              {(predictionsMeta.excludedFromUniverse as string[]).length} empresa(s) ficaram FORA do ranking
              por não pertencerem ao universo em que este modelo foi validado —{' '}
              <span className="font-mono">{(predictionsMeta.excludedFromUniverse as string[]).join(', ')}</span>.
              Elas têm fundamentos, mas não têm série de preços que permita medir o resultado, então
              ranqueá-las junto daria a elas o mesmo peso das validadas.
            </p>
          )}

        {activeModels.length > 0 && (
          <p className="text-xs text-gray-500">
            <span className="text-gray-300 font-semibold">{highConfidence.length}</span> empresas nos quintis
            extremos de <span className="text-gray-300 font-semibold">{predictions.length}</span> avaliadas
            {typeof predictionsMeta.generatedAt === 'string' && (
              <> · gerado em {new Date(predictionsMeta.generatedAt).toLocaleString('pt-BR')}</>
            )}
          </p>
        )}

        {loadingPredictions ? (
          <p className="text-xs text-gray-500">Carregando sinais…</p>
        ) : visiblePredictions.length === 0 ? (
          <p className="text-xs text-gray-500">
            {activeModels.length === 0
              ? 'Sem modelo aprovado, nenhum sinal é emitido.'
              : predictions.length === 0
                ? 'Nenhuma geração de sinais ainda para esta versão — use “Gerar sinais agora”.'
                : 'Nenhuma empresa atingiu o gate de confiança nesta geração.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left py-2 px-2">Ticker</th>
                  <th className="text-left py-2 px-2">Sinal</th>
                  <th className="text-right py-2 px-2">Quintil</th>
                  <th className="text-right py-2 px-2">Percentil</th>
                  <th className="text-left py-2 px-2">Conhecido em</th>
                  <th className="text-left py-2 px-2">Principais fatores</th>
                </tr>
              </thead>
              <tbody>
                {visiblePredictions.map((p) => (
                  <tr key={`${p.ticker}-${p.generatedAt}`} className="border-b border-gray-900 hover:bg-gray-900/40">
                    <td className="py-2 px-2 font-mono text-gray-200">{p.ticker}</td>
                    <td className="py-2 px-2">
                      <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${SIGNAL_STYLES[p.signal]}`}>
                        {p.signal}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-gray-300">
                      {p.quantile ? `Q${p.quantile}` : '—'}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-gray-500">{pct(p.prob, 0)}</td>
                    <td className="py-2 px-2 font-mono text-gray-500">{p.knowledgeDate.slice(0, 10)}</td>
                    <td className="py-2 px-2 text-gray-400" title={p.topFeatures.map((f) => `${f.feature}: ${f.importance.toFixed(1)}`).join(' · ')}>
                      {p.topFeatures.slice(0, 3).map((f) => f.feature).join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-gray-600 mt-2">
  
            </p>
          </div>
        )}
      </div>

      {/* ---------------- Treinar ---------------- */}
      <div className="bg-gray-900/40 border border-gray-800 rounded p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-300">Treinar novo modelo</p>
        {costProfiles.length === 0 ? (
          <p className="text-xs text-red-400">
            Nenhum perfil de custos ativo — peça a um administrador para cadastrar um <code>BacktestCostProfile</code>{' '}
            antes de treinar.
          </p>
        ) : (
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Perfil de custos</label>
              <select
                value={selectedCostProfileId}
                onChange={(e) => setSelectedCostProfileId(e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm min-w-[16rem]"
              >
                <option value="">Selecione um perfil…</option>
                {costProfiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.label} · v{p.version}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => void handleTrain()}
              disabled={training || !selectedCostProfileId || trainingRunActive}
              className="bg-blue-700 hover:bg-blue-600 disabled:opacity-40 rounded px-4 py-2 text-sm font-semibold"
            >
              {training ? 'Iniciando…' : trainingRunActive ? 'Treino em andamento' : 'Treinar (walk-forward trimestral)'}
            </button>
          </div>
        )}
        <p className="text-[11px] text-gray-600">
          O treino roda o walk-forward anual completo e aplica os quatro gates no servidor. Um modelo reprovado é
          persistido para auditoria, mas nunca fica servível.
        </p>

        {trainingRun && (
          <div className="border-t border-gray-800 pt-3 space-y-2 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-gray-400">{trainingRun.trainingRunId}</span>
              <span
                className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                  trainingRun.status === 'SUCCEEDED'
                    ? 'bg-green-500/10 text-green-400 border-green-500/40'
                    : trainingRun.status === 'REJECTED'
                      ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/40'
                      : trainingRunActive
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/40'
                        : 'bg-red-500/10 text-red-400 border-red-500/40'
                }`}
              >
                {trainingRun.status}
              </span>
              {trainingRunActive && (
                <span className="text-gray-500">
                  {PHASE_LABELS[trainingRun.phase]} — {trainingRun.progress}%
                </span>
              )}
            </div>

            {trainingRunActive && (
              <div className="w-full bg-gray-800 rounded h-1.5 overflow-hidden">
                <div className="bg-blue-500 h-1.5 transition-all" style={{ width: `${trainingRun.progress}%` }} />
              </div>
            )}

            {trainingRun.status === 'REJECTED' && (
              <p className="text-yellow-400">
                Gate reprovado — nenhuma versão foi ativada. O modelo fica registrado no histórico para auditoria.
              </p>
            )}
            {trainingRun.status === 'SUCCEEDED' && (
              <p className="text-green-400">
                Modelo aprovado e ativado
                {trainingRun.modelVersionId ? ` — versão ${shortVersion(trainingRun.modelVersionId)}.` : '.'}
              </p>
            )}
            {(trainingRun.status === 'FAILED' || trainingRun.status === 'INTERRUPTED') && (
              <p className="text-red-400">
                {trainingRun.errorCode}: {trainingRun.errorSummary ?? 'falha no treino'}
              </p>
            )}
            {trainingRun.status === 'CANCELLED' && <p className="text-gray-400">Cancelado.</p>}

            {trainingRun.metrics && (
              <div className="font-mono text-gray-500 flex gap-3 flex-wrap">
                <span>amostras: {trainingRun.metrics.nSamples}</span>
                <span>trimestres: {trainingRun.metrics.nPeriods ?? '—'}</span>
                <span>IC: {num(trainingRun.metrics.ic)}</span>
                <span>t-stat: {num(trainingRun.metrics.icTStat, 2)}</span>
                <span>spread: {pct(trainingRun.metrics.topBottomSpread, 2)}</span>
                <span>anos+: {pct(trainingRun.metrics.positiveYearsRatio, 0)}</span>
              </div>
            )}

            {trainingRunActive && (
              <button
                onClick={() => void handleCancelTraining()}
                disabled={trainingRun.status === 'CANCEL_REQUESTED'}
                className="bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded px-3 py-1 text-xs font-semibold"
              >
                {trainingRun.status === 'CANCEL_REQUESTED' ? 'Cancelando…' : 'Cancelar treino'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ---------------- Histórico ---------------- */}
      <div className="bg-gray-900/40 border border-gray-800 rounded p-4 space-y-2">
        <p className="text-sm font-semibold text-gray-300">Histórico de treinos ({allModels.length})</p>
        {allModels.length === 0 ? (
          <p className="text-xs text-gray-500">Nenhum treino registrado ainda.</p>
        ) : (
          <div className="space-y-2">
            {allModels.map((m) => (
              <details key={m.modelVersion} className="text-xs">
                <summary className="cursor-pointer flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                      m.status === 'ACTIVE'
                        ? 'bg-green-500/10 text-green-400 border-green-500/40'
                        : m.status === 'FAILED'
                          ? 'bg-red-500/10 text-red-400 border-red-500/40'
                          : 'bg-gray-700/30 text-gray-400 border-gray-600/40'
                    }`}
                  >
                    {m.status}
                  </span>
                  <span className="font-mono text-gray-400">{shortVersion(m.modelVersion)}</span>
                  <span className="text-gray-600">{new Date(m.createdAt).toLocaleString('pt-BR')}</span>
                  {m.gateFailures.length > 0 && (
                    <span className="text-red-400">{m.gateFailures.length} de 4 gates reprovados</span>
                  )}
                </summary>
                <div className="mt-2 pl-2 border-l border-gray-800">
                  <GatePanel model={m} compact />
                  <p className="text-[11px] text-gray-600 mt-2 font-mono">ResearchRun: {m.researchRunId}</p>
                </div>
              </details>
            ))}
          </div>
        )}
        {failedModels.length > 0 && (
          <p className="text-[11px] text-gray-600">
            {failedModels.length} tentativa(s) reprovada(s) permanecem registradas — nunca aparecem no seletor de
            versão nem geram sinais.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function GatePanel({ model, compact = false }: { model: DirectionalModel; compact?: boolean }): React.ReactElement {
  const m = model.metrics;
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3 pt-2'}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {model.gateChecks.map((c) => (
          <div
            key={c.code}
            className={`rounded border p-2 ${
              c.passed ? 'bg-green-500/5 border-green-500/30' : 'bg-red-500/5 border-red-500/30'
            }`}
          >
            <p className="text-[10px] text-gray-500 leading-tight">{c.label}</p>
            <p className={`text-sm font-mono ${c.passed ? 'text-green-400' : 'text-red-400'}`}>
              {c.code === 'COVERAGE_BELOW_MIN'
                ? `${c.observed ?? '—'}`
                : c.code === 'BRIER_ABOVE_MAX'
                  ? num(c.observed)
                  : pct(c.observed)}
            </p>
            <p className="text-[10px] text-gray-600">
              exigido: {c.code === 'COVERAGE_BELOW_MIN'
                ? `≥ ${c.threshold}`
                : c.code === 'BRIER_ABOVE_MAX'
                  ? `< ${c.threshold}`
                  : `≥ ${pct(c.threshold, 0)}`}
            </p>
          </div>
        ))}
      </div>

      {m.quantileExcess && m.quantileExcess.length > 0 && (
        <div className="bg-gray-900/40 border border-gray-800 rounded p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-300">Retorno por quintil do escore</p>
          <p className="text-[11px] text-gray-600">
            Excesso médio sobre os pares, por trimestre, fora da amostra. É aqui que a vantagem do
            modelo aparece (ou não) — a acurácia binária não distingue o percentil 51 do 99.
          </p>
          <div className="flex gap-1 items-end h-24">
            {(m.netQuantileExcess ?? m.quantileExcess).map((q) => {
              const barras = m.netQuantileExcess ?? m.quantileExcess!;
              const maior = Math.max(...barras.map((x) => Math.abs(x.meanExcess)), 0.001);
              const altura = Math.max(4, (Math.abs(q.meanExcess) / maior) * 70);
              const positivo = q.meanExcess >= 0;
              return (
                <div key={q.quantile} className="flex-1 flex flex-col items-center justify-end gap-1">
                  <span className={`text-[10px] font-mono ${positivo ? 'text-green-400' : 'text-red-400'}`}>
                    {(q.meanExcess * 100).toFixed(2)}%
                  </span>
                  <div
                    className={`w-full rounded-t ${positivo ? 'bg-green-500/40' : 'bg-red-500/40'}`}
                    style={{ height: `${altura}px` }}
                  />
                  <span className="text-[10px] text-gray-500">Q{q.quantile}</span>
                </div>
              );
            })}
          </div>
          {m.spreadByYear && m.spreadByYear.length > 0 && (
            <p className="text-[11px] font-mono text-gray-500">
              spread topo−fundo por ano:{' '}
              {m.spreadByYear.map((a) => (
                <span key={a.testYear} className={a.spread >= 0 ? 'text-gray-400 mr-2' : 'text-red-400 mr-2'}>
                  {a.testYear}: {(a.spread * 100).toFixed(1)}pp
                </span>
              ))}
            </p>
          )}
          <p className="text-[11px] text-gray-600">
            {m.roundTripCost !== undefined && (
              <>
                Líquido de custos: {(m.roundTripCost * 100).toFixed(2)}% de ida-e-volta por posição
                (perfil de custo do treino){' '}
                {m.netTopBottomSpread !== null && m.netTopBottomSpread !== undefined && (
                  <>· spread líquido {(m.netTopBottomSpread * 100).toFixed(2)} p.p.</>
                )}
                {' — '}
              </>
            )}
            IC {num(m.ic)} (t {num(m.icTStat, 2)}, {m.icPeriods ?? '—'} períodos) — mede se a ordenação
            das empresas antecipa o excesso de retorno. Um ano negativo no spread não é detalhe: é o
            tamanho do risco de o fator falhar quando você precisar dele.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-[11px] font-mono text-gray-500">
        <span>amostras: {m.nSamples}</span>
        <span>trimestres: {m.nPeriods ?? '—'}</span>
        <span>features no escore: {m.nFeaturesMedian ?? '—'}</span>
        <span>IC: {num(m.ic)}</span>
      </div>

      {m.byFold.length > 0 && (
        <div className="text-[11px] text-gray-500 font-mono">
          por ano:{' '}
          {m.byFold.map((f) => (
            <span key={f.foldId} className="mr-3">
              {f.testYear}: IC {num(f.ic)} ({f.nFeatures ?? '—'} feat.)
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
