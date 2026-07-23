'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';

const MODEL_LABEL = 'ml-hybrid-swing-v1';
const TICKER_REGEX = /^[A-Z]{4}\d{1,2}$/;

/**
 * Bloqueador 1 (revisão final do Guardião, 2026-07-22): consome
 * `GET /api/v1/ml/model-versions` (DTO público allowlist), nunca
 * `GET /api/v1/model-versions` (que devolve `hyperparametersJson`/
 * `trainingEvidenceJson` brutos, incluindo `artifact.path` local).
 */
interface ModelVersionReadModel {
  readonly modelVersion: string;
  readonly kind: string;
  readonly label: string;
  readonly asOf: string;
  readonly invalidatedAt: string | null;
  readonly createdAt: string;
  readonly gateApproved: boolean;
  readonly evidence: TrainingEvidenceSummary | null;
}

interface GateComparison {
  readonly baseline: string;
  readonly accuracyDiff: number;
  readonly ciLower: number;
  readonly passed: boolean;
}

interface TrainingEvidenceSummary {
  readonly nSamples: number;
  readonly accuracy: number;
  readonly baselines: {
    readonly alwaysUp: number;
    readonly timesfmOnly: number;
    readonly fundamentalOnly: number;
    readonly priceOnlyLgbm: number;
  };
  readonly gateApproved: boolean;
  readonly gateComparisons: readonly GateComparison[];
  readonly datasetHash: string;
  readonly artifactHash: string;
  readonly timesfmVersion: string | null;
  readonly windowStart: string;
  readonly windowEnd: string;
}

interface PredictResult {
  symbol: string;
  date: string;
  direction: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  topFeatures: readonly { name: string; importance: number }[];
  sourceMeta: {
    readonly candlesFrom: string | null;
    readonly candlesTo: string | null;
    readonly candlesSource: string | null;
    readonly timesfmVersion: string | null;
  };
}

type CostProfile = CostProfilePublicDTO;

interface BacktestMetrics {
  readonly trades: number;
  readonly totalNetReturn: number;
  readonly maxDrawdown: number;
  readonly sharpe: number;
  readonly winRate: number;
}

interface BacktestRunReadModel {
  readonly backtestId: string;
  readonly modelVersionId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly metrics: unknown;
  readonly createdAt: string;
  readonly signalCoverage?: {
    readonly totalSignalsInWindow: number;
    readonly acceptedSignals: number;
  };
  readonly costProfileRef?: { readonly id: string; readonly version: number };
}

interface ResearchRunReadModel {
  readonly runId: string;
  readonly name: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly createdAt: string;
  readonly modelVersionId: string | null;
  readonly outcome: 'APROVADO' | 'REPROVADO';
}

interface ApiEnvelopeSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}
interface ApiEnvelopeError {
  success: false;
  error: { code: string; message: string };
}
type ApiEnvelope<T> = ApiEnvelopeSuccess<T> | ApiEnvelopeError;

/**
 * Achado alto 9 (auditoria final do Guardião, 2026-07-22): `DADOS_INSUFICIENTES`
 * e `SERVIÇO_INDISPONÍVEL` precisam ser estados distintos por CÓDIGO, nunca
 * uma única string fundida. `classifyError` mapeia o `code` do envelope de
 * erro (`ReadModelErrorCode` do backend) para um destes dois — ou `OUTRO`
 * quando não há classificação segura (ex.: erro de validação de entrada).
 */
type ErrorKind = 'DADOS_INSUFICIENTES' | 'SERVICO_INDISPONIVEL' | 'OUTRO';
interface ClassifiedError {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly message: string;
}

const SERVICE_UNAVAILABLE_CODES = new Set(['UPSTREAM_ERROR', 'UPSTREAM_TIMEOUT', 'INTERNAL_ERROR']);
const INSUFFICIENT_DATA_CODES = new Set([
  'MODEL_VERSION_NOT_FOUND',
  'RESEARCH_RUN_NOT_FOUND',
  'BACKTEST_NOT_FOUND',
  'INSUFFICIENT_DATA',
  'COST_PROFILE_NOT_FOUND',
  'ARTIFACT_NOT_FOUND',
  'SNAPSHOT_NOT_FOUND',
  'SYMBOL_NOT_IN_ARTIFACT',
]);

function classifyError(code: string, message: string): ClassifiedError {
  const kind: ErrorKind = SERVICE_UNAVAILABLE_CODES.has(code)
    ? 'SERVICO_INDISPONIVEL'
    : INSUFFICIENT_DATA_CODES.has(code)
      ? 'DADOS_INSUFICIENTES'
      : 'OUTRO';
  return { kind, code, message };
}

function classifyNetworkError(message: string): ClassifiedError {
  // Falha de rede/fetch nunca chega a um `code` do backend — é sempre
  // tratada como indisponibilidade de serviço.
  return { kind: 'SERVICO_INDISPONIVEL', code: 'NETWORK_ERROR', message };
}

function errorHeadline(err: ClassifiedError): string {
  return err.kind === 'OUTRO' ? err.code : err.kind;
}

/** Item B (bloqueador crítico 1): DTO público de `GET /api/v1/ml/backfill-runs`. */
interface BackfillFailurePublicDTO {
  readonly ticker: string;
  readonly reasonSummary: string;
}
interface BackfillRunPublicDTO {
  readonly backfillRunId: string;
  readonly createdAt: string;
  readonly status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  readonly eligibleCount: number;
  readonly updatedCount: number;
  readonly failedCount: number;
  readonly updatedSymbols: readonly string[];
  readonly failuresPage: readonly BackfillFailurePublicDTO[];
  readonly failuresNextCursor: number | null;
}

/** Bloqueador 3 (auditoria focada do Guardião, 2026-07-22): `sourceMeta` já
 *  chega do servidor como objeto plano e allowlisted (`_dto.ts` de
 *  `/api/v1/ml/predict`) — a UI só decide rótulo/visibilidade, nunca mais
 *  precisa filtrar chaves desconhecidas de um `Record<string, unknown>`. */
const SOURCE_META_LABELS = {
  candlesFrom: 'candles.from',
  candlesTo: 'candles.to',
  candlesSource: 'candles.source',
  timesfmVersion: 'timesfm',
} as const;

interface CostProfilePublicDTO {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly fixedBrokerage: number;
  readonly emolumentsPct: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
  readonly lotSize: number;
  readonly sourceSummary: string;
}

function isBacktestMetrics(value: unknown): value is BacktestMetrics {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.trades === 'number' &&
    typeof v.totalNetReturn === 'number' &&
    typeof v.maxDrawdown === 'number' &&
    typeof v.sharpe === 'number'
  );
}

const DIRECTION_STYLES: Record<PredictResult['direction'], string> = {
  BUY: 'bg-green-500/20 text-green-400 border border-green-500/40',
  SELL: 'bg-red-500/20 text-red-400 border border-red-500/40',
  HOLD: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
};

export default function HybridGovernedView() {
  const toast = useToast();

  const [loadingVersions, setLoadingVersions] = useState(true);
  const [activeVersion, setActiveVersion] = useState<ModelVersionReadModel | null>(null);
  const [loadError, setLoadError] = useState<ClassifiedError | null>(null);

  const [backfilling, setBackfilling] = useState(false);
  const [training, setTraining] = useState(false);

  const [ticker, setTicker] = useState('');
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState<PredictResult | null>(null);
  // Achado alto 4: referência canônica devolvida pelo PRÓPRIO
  // `POST /api/v1/ml/predict` — nunca reaproveita `activeVersion`, que pode
  // já estar obsoleto sob concorrência (retreino aprovado nesse meio-tempo).
  const [predictionMeta, setPredictionMeta] = useState<{
    readonly modelVersionId: string;
    readonly datasetHash: string;
    readonly artifactHash: string;
  } | null>(null);

  const [costProfiles, setCostProfiles] = useState<CostProfile[]>([]);
  const [loadingCostProfiles, setLoadingCostProfiles] = useState(true);
  const [costProfilesError, setCostProfilesError] = useState<ClassifiedError | null>(null);
  const [selectedCostProfileId, setSelectedCostProfileId] = useState('');

  const [backtestRuns, setBacktestRuns] = useState<BacktestRunReadModel[]>([]);
  const [loadingBacktests, setLoadingBacktests] = useState(false);
  const [backtestsError, setBacktestsError] = useState<ClassifiedError | null>(null);
  const [researchRuns, setResearchRuns] = useState<ResearchRunReadModel[]>([]);
  const [loadingResearch, setLoadingResearch] = useState(false);
  const [researchError, setResearchError] = useState<ClassifiedError | null>(null);

  // Bloqueador 5: cache de perfis de custo já resolvidos por id, para
  // mostrar os componentes de custo de fato usados em cada BacktestRun
  // histórico (nunca apenas a referência opaca id/versão). Achado médio 11:
  // erro por id fica explícito (nunca "carregando..." eterno).
  const [costProfileCache, setCostProfileCache] = useState<Record<string, CostProfilePublicDTO>>({});
  const [costProfileCacheError, setCostProfileCacheError] = useState<Record<string, string>>({});

  // Bloqueador crítico 1 (auditoria final do Guardião, 2026-07-22): estado
  // hidratado a partir do read model server-side `GET /api/v1/ml/backfill-runs`
  // — sobrevive a reload/nova sessão. `localStorage` nunca é usado.
  const [backfillReport, setBackfillReport] = useState<BackfillRunPublicDTO | null>(null);
  const [loadingBackfillReport, setLoadingBackfillReport] = useState(true);
  const [backfillError, setBackfillError] = useState<ClassifiedError | null>(null);
  const [failuresOffset, setFailuresOffset] = useState(0);
  const FAILURES_PAGE_SIZE = 10;

  const loadActiveVersion = useCallback(async () => {
    setLoadingVersions(true);
    setLoadError(null);
    try {
      // Achado alto 3: a rota agora pagina server-side — segue `nextCursor`
      // até encontrar uma candidata aprovada ou esgotar a coleção (teto de
      // segurança), nunca assume que a primeira página basta.
      const all: ModelVersionReadModel[] = [];
      let cursor: string | null = null;
      const MAX_ITERATIONS = 20;
      let iterations = 0;
      for (;;) {
        const url = cursor
          ? `/api/v1/ml/model-versions?kind=ML&limit=50&cursor=${encodeURIComponent(cursor)}`
          : '/api/v1/ml/model-versions?kind=ML&limit=50';
        const res = await fetch(url);
        let json: ApiEnvelope<ModelVersionReadModel[]>;
        try {
          json = (await res.json()) as ApiEnvelope<ModelVersionReadModel[]>;
        } catch {
          setActiveVersion(null);
          setLoadError(classifyNetworkError('Resposta inválida do servidor ao consultar versões do modelo.'));
          return;
        }
        if (!json.success) {
          setActiveVersion(null);
          setLoadError(classifyError(json.error.code, json.error.message));
          return;
        }
        all.push(...json.data);
        const meta = json.meta as { nextCursor?: string | null } | undefined;
        cursor = meta?.nextCursor ?? null;
        iterations += 1;
        // Já achou uma candidata aprovada nesta página? A ordenação global
        // `asOf desc, createdAt desc, modelVersion desc` do backend garante
        // que a primeira aprovada encontrada nesta varredura trans-páginas
        // já é a correta — não precisa esgotar tudo.
        const hasApproved = json.data.some((v) => v.label === MODEL_LABEL && v.invalidatedAt === null && v.gateApproved && v.evidence !== null);
        if (hasApproved || !cursor || iterations >= MAX_ITERATIONS) break;
      }
      const candidates = all
        .filter((v) => v.label === MODEL_LABEL && v.invalidatedAt === null && v.gateApproved && v.evidence !== null)
        .slice()
        .sort((a, b) => {
          if (a.asOf !== b.asOf) return a.asOf < b.asOf ? 1 : -1;
          if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
          return a.modelVersion < b.modelVersion ? 1 : a.modelVersion > b.modelVersion ? -1 : 0;
        });
      setActiveVersion(candidates[0] ?? null);
    } catch (e: unknown) {
      setActiveVersion(null);
      setLoadError(classifyNetworkError(e instanceof Error ? e.message : 'Falha ao consultar o serviço de versões do modelo.'));
    } finally {
      setLoadingVersions(false);
    }
  }, []);

  const loadCostProfiles = useCallback(async () => {
    setLoadingCostProfiles(true);
    setCostProfilesError(null);
    try {
      // Bloqueador 9 / achado médio 10: segue `nextCursor` até esgotar todas
      // as páginas. Falha em QUALQUER página intermediária, ou teto de
      // iterações atingido com `nextCursor` ainda pendente, falha FECHADO —
      // nunca preserva uma seleção parcial silenciosa que pareça completa.
      const all: CostProfile[] = [];
      let cursor: string | null = null;
      const MAX_ITERATIONS = 20; // salvaguarda contra loop infinito por bug futuro (até 2000 perfis com limit=100)
      let iterations = 0;
      for (;;) {
        const url = cursor
          ? `/api/v1/ml/cost-profiles?limit=100&cursor=${encodeURIComponent(cursor)}`
          : '/api/v1/ml/cost-profiles?limit=100';
        const res = await fetch(url);
        const json = (await res.json()) as ApiEnvelope<CostProfile[]>;
        if (!json.success) {
          toast.error(`${json.error.code}: ${json.error.message}`);
          setCostProfiles([]);
          setCostProfilesError(classifyError(json.error.code, json.error.message));
          return;
        }
        all.push(...json.data);
        const meta = json.meta as { nextCursor?: string | null } | undefined;
        cursor = meta?.nextCursor ?? null;
        iterations += 1;
        if (!cursor) break;
        if (iterations >= MAX_ITERATIONS) {
          setCostProfiles([]);
          setCostProfilesError(
            classifyError('RESULT_LIMIT_EXCEEDED', 'muitos perfis de custo ativos para carregar com segurança — contate um administrador.'),
          );
          return;
        }
      }
      setCostProfiles(all);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(message);
      setCostProfiles([]);
      setCostProfilesError(classifyNetworkError(message));
    } finally {
      setLoadingCostProfiles(false);
    }
  }, [toast]);

  // Bloqueador crítico 1 (auditoria final do Guardião, 2026-07-22): hidrata
  // o último relatório de backfill persistido server-side — sobrevive a
  // reload/nova sessão, nunca depende só de `useState` do navegador.
  const loadBackfillReport = useCallback(async (offset: number) => {
    setLoadingBackfillReport(true);
    setBackfillError(null);
    try {
      const res = await fetch(`/api/v1/ml/backfill-runs?limit=${FAILURES_PAGE_SIZE}&offset=${offset}`);
      const json = (await res.json()) as ApiEnvelope<BackfillRunPublicDTO | null>;
      if (!json.success) {
        setBackfillReport(null);
        setBackfillError(classifyError(json.error.code, json.error.message));
        return;
      }
      setBackfillReport(json.data);
    } catch (e: unknown) {
      setBackfillReport(null);
      setBackfillError(classifyNetworkError(e instanceof Error ? e.message : 'Falha de rede ao consultar relatório de backfill.'));
    } finally {
      setLoadingBackfillReport(false);
    }
  }, []);

  useEffect(() => {
    void loadActiveVersion();
    void loadCostProfiles();
    void loadBackfillReport(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadActiveVersion, loadCostProfiles]);

  useEffect(() => {
    void loadBackfillReport(failuresOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failuresOffset]);

  useEffect(() => {
    if (!activeVersion) {
      setBacktestRuns([]);
      setBacktestsError(null);
      return;
    }
    let cancelled = false;

    setLoadingBacktests(true);
    setBacktestsError(null);
    // Bloqueador 3 (revisão final do Guardião): paginação server-side —
    // pede exatamente os 5 mais recentes (ordenados desc pelo backend),
    // nunca a coleção inteira com slice no cliente.
    fetch(`/api/v1/backtests?modelVersionId=${encodeURIComponent(activeVersion.modelVersion)}&limit=5`)
      .then((res) => res.json())
      .then((json: ApiEnvelope<BacktestRunReadModel[]>) => {
        if (cancelled) return;
        if (json.success) {
          setBacktestRuns(json.data);
          setBacktestsError(null);
        } else {
          // Bloqueador 8: falha HTTP nunca vira lista vazia silenciosa —
          // o usuário precisa distinguir "sem dados" de "serviço falhou".
          setBacktestRuns([]);
          setBacktestsError(classifyError(json.error.code, json.error.message));
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setBacktestRuns([]);
        setBacktestsError(classifyNetworkError(e instanceof Error ? e.message : 'Falha de rede ao consultar backtests.'));
      })
      .finally(() => {
        if (!cancelled) setLoadingBacktests(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeVersion]);

  // Bloqueador único (revisão 2026-07-22) + achado alto 5 (auditoria final,
  // 2026-07-22): pesquisas recentes por `name=ml-hybrid-swing-v1` SEMPRE são
  // carregadas, independentemente de haver `activeVersion` — reprovações
  // recentes (sem `modelVersionId`) precisam aparecer mesmo quando já existe
  // uma versão aprovada ativa. Quando há versão ativa, o caminho por
  // `modelVersionId` (mais preciso: só runs ligados à versão) é buscado EM
  // PARALELO e os resultados são mesclados sem duplicar (por `runId`).
  useEffect(() => {
    let cancelled = false;
    setLoadingResearch(true);
    setResearchError(null);

    const byNameUrl = `/api/v1/research-runs?name=${encodeURIComponent(MODEL_LABEL)}&limit=10`;
    const byModelVersionUrl = activeVersion
      ? `/api/v1/research-runs?modelVersionId=${encodeURIComponent(activeVersion.modelVersion)}&limit=10`
      : null;

    Promise.all([
      fetch(byNameUrl).then((res) => res.json() as Promise<ApiEnvelope<ResearchRunReadModel[]>>),
      byModelVersionUrl ? (fetch(byModelVersionUrl).then((res) => res.json() as Promise<ApiEnvelope<ResearchRunReadModel[]>>)) : Promise.resolve(null),
    ])
      .then(([byNameJson, byModelVersionJson]) => {
        if (cancelled) return;
        if (!byNameJson.success) {
          setResearchRuns([]);
          setResearchError(classifyError(byNameJson.error.code, byNameJson.error.message));
          return;
        }
        if (byModelVersionJson && !byModelVersionJson.success) {
          setResearchRuns([]);
          setResearchError(classifyError(byModelVersionJson.error.code, byModelVersionJson.error.message));
          return;
        }
        const merged = new Map<string, ResearchRunReadModel>();
        for (const r of byNameJson.data) merged.set(r.runId, r);
        if (byModelVersionJson) for (const r of byModelVersionJson.data) merged.set(r.runId, r);
        setResearchRuns([...merged.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)));
        setResearchError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setResearchRuns([]);
        setResearchError(classifyNetworkError(e instanceof Error ? e.message : 'Falha de rede ao consultar pesquisas.'));
      })
      .finally(() => {
        if (!cancelled) setLoadingResearch(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeVersion]);

  // Bloqueador 5: para cada BacktestRun carregado, resolve (e cacheia) o
  // BacktestCostProfile referenciado, para mostrar os componentes de custo
  // de fato usados — nunca só a referência opaca id/versão.
  useEffect(() => {
    const idsToResolve = Array.from(
      new Set(
        backtestRuns
          .map((run) => run.costProfileRef?.id)
          .filter((id): id is string => typeof id === 'string' && !(id in costProfileCache) && !(id in costProfileCacheError)),
      ),
    );
    if (idsToResolve.length === 0) return;
    let cancelled = false;
    void Promise.all(
      idsToResolve.map(async (id) => {
        try {
          const res = await fetch(`/api/v1/ml/cost-profiles/${encodeURIComponent(id)}`);
          const json = (await res.json()) as ApiEnvelope<CostProfilePublicDTO>;
          if (json.success) return { id, ok: true as const, profile: json.data };
          // Achado médio 11: erro explícito por id — nunca fica
          // "carregando componentes de custo..." indefinidamente.
          return { id, ok: false as const, error: `${json.error.code}: ${json.error.message}` };
        } catch (e: unknown) {
          return { id, ok: false as const, error: e instanceof Error ? e.message : 'Falha de rede ao consultar perfil de custo histórico.' };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setCostProfileCache((prev) => {
        const next = { ...prev };
        for (const r of results) if (r.ok) next[r.id] = r.profile;
        return next;
      });
      setCostProfileCacheError((prev) => {
        const next = { ...prev };
        for (const r of results) if (!r.ok) next[r.id] = r.error;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [backtestRuns, costProfileCache, costProfileCacheError]);

  const handleBackfill = useCallback(async () => {
    setBackfilling(true);
    setBackfillError(null);
    setFailuresOffset(0);
    try {
      const res = await fetch('/api/v1/ml/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as ApiEnvelope<{ updatedCount: number; failedCount: number; backfillRunId: string }>;
      if (!json.success) {
        toast.error(`${json.error.code}: ${json.error.message}`);
        setBackfillError(classifyError(json.error.code, json.error.message));
        return;
      }
      toast.success(`Backfill D1: ${json.data.updatedCount} símbolo(s) OK, ${json.data.failedCount} falha(s)`);
      // Bloqueador crítico 1: o relatório exibido vem do read model
      // server-side (já persistido pelo backend nesta mesma chamada), nunca
      // do corpo bruto da resposta de `/ml/backfill` diretamente.
      await loadBackfillReport(0);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(message);
      setBackfillError(classifyNetworkError(message));
    } finally {
      setBackfilling(false);
    }
  }, [toast, loadBackfillReport]);

  const handleTrain = useCallback(async () => {
    if (!selectedCostProfileId) {
      toast.error('Selecione um perfil de custos antes de treinar.');
      return;
    }
    setTraining(true);
    try {
      const res = await fetch('/api/v1/ml/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ costProfileId: selectedCostProfileId }),
      });
      const json = (await res.json()) as ApiEnvelope<{ gate: { approved: boolean }; modelVersionId: string | null }>;
      if (!json.success) {
        toast.error(`${json.error.code}: ${json.error.message}`);
        return;
      }
      if (json.data.gate.approved && json.data.modelVersionId) {
        toast.success('Treino concluído — modelo aprovado no gate.');
      } else {
        toast.warning('Treino concluído — gate reprovou o modelo (nenhuma versão nova ativada).');
      }
      await loadActiveVersion();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTraining(false);
    }
  }, [toast, loadActiveVersion, selectedCostProfileId]);

  const handlePredict = useCallback(async () => {
    const upper = ticker.trim().toUpperCase();
    if (!TICKER_REGEX.test(upper)) {
      toast.error('Ticker inválido — formato esperado: 4 letras + 1-2 dígitos (ex.: PETR4).');
      return;
    }
    setPredicting(true);
    setPrediction(null);
    setPredictionMeta(null);
    try {
      const res = await fetch('/api/v1/ml/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: upper }),
      });
      const json = (await res.json()) as ApiEnvelope<{
        signalId: string;
        prediction: PredictResult;
        modelVersionId: string;
        datasetHash: string;
        artifactHash: string;
      }>;
      if (!json.success) {
        toast.error(`${json.error.code}: ${json.error.message}`);
        return;
      }
      setPrediction(json.data.prediction);
      // Achado alto 4: nunca reaproveita `activeVersion` aqui — o vínculo
      // canônico vem exclusivamente da resposta desta chamada.
      setPredictionMeta({
        modelVersionId: json.data.modelVersionId,
        datasetHash: json.data.datasetHash,
        artifactHash: json.data.artifactHash,
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPredicting(false);
    }
  }, [ticker, toast]);

  const trainDisabled = training || !selectedCostProfileId || (!loadingCostProfiles && costProfiles.length === 0);

  const costProfileSelector = (
    <div className="space-y-2">
      <label className="block text-xs text-gray-400 mb-1">Perfil de custos</label>
      {loadingCostProfiles ? (
        <p className="text-xs text-gray-500">Carregando perfis de custo...</p>
      ) : costProfilesError ? (
        // Achado médio 10: falha em página intermediária falha FECHADO —
        // nunca mostra uma seleção parcial como se fosse a lista completa.
        <p className="text-xs text-red-400">
          {errorHeadline(costProfilesError)} — falha ao carregar perfis de custo ({costProfilesError.code}): {costProfilesError.message}
        </p>
      ) : costProfiles.length === 0 ? (
        <p className="text-xs text-red-400">
          Nenhum perfil de custos ativo disponível — peça a um administrador para cadastrar um{' '}
          <code>BacktestCostProfile</code> antes de treinar.
        </p>
      ) : (
        <select
          value={selectedCostProfileId}
          onChange={(e) => setSelectedCostProfileId(e.target.value)}
          className="w-full max-w-sm bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm"
        >
          <option value="">Selecione um perfil…</option>
          {costProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · v{p.version}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  return (
    <div className="cyber-card p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-orbitron text-xl font-bold neon-text-cyan">Híbrido governado (D1 · 10 pregões)</h3>
        {!loadingVersions && activeVersion && (
          <span className="text-xs font-mono px-3 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/40">
            Versão ativa: {activeVersion.modelVersion}
          </span>
        )}
      </div>

      {/* Bloqueador crítico 1 (auditoria final do Guardião, 2026-07-22):
          cobertura/falhas de dados — read model server-side, hidratado a
          cada carregamento/reload (nunca `useState` isolado, nunca
          `localStorage`). Bloqueador crítico 2: falhas já vêm sanitizadas do
          servidor e paginadas ali mesmo (`offset`/`limit`), nunca a
          coleção inteira nem a mensagem bruta do Python. */}
      <div className="bg-gray-900/40 border border-gray-800 rounded p-4 space-y-2">
        <p className="text-sm font-semibold text-gray-300">Cobertura de dados</p>
        {loadingBackfillReport && <p className="text-xs text-gray-500">Carregando relatório de backfill...</p>}
        {!loadingBackfillReport && backfillError && (
          <p className="text-xs text-red-400">
            {errorHeadline(backfillError)} — falha ao consultar backfill ({backfillError.code}): {backfillError.message}
          </p>
        )}
        {!loadingBackfillReport && !backfillReport && !backfillError && (
          <p className="text-xs text-gray-500">Nenhum backfill D1 executado ainda.</p>
        )}
        {!loadingBackfillReport && backfillReport && (
          <div className="text-xs text-gray-400 space-y-2">
            <p className="text-gray-600">
              último backfill: {backfillReport.createdAt} · status {backfillReport.status}
            </p>
            <p className="font-mono">
              elegíveis (tentados): {backfillReport.eligibleCount} · atualizados:{' '}
              <span className="text-green-400">{backfillReport.updatedCount}</span> · com falha:{' '}
              <span className={backfillReport.failedCount > 0 ? 'text-red-400' : 'text-green-400'}>{backfillReport.failedCount}</span>
            </p>
            {backfillReport.failedCount > 0 && (
              <div className="space-y-1">
                <p className="text-gray-500">Falhas por ticker (resumido, sanitizado):</p>
                <div className="space-y-1">
                  {backfillReport.failuresPage.map((f) => (
                    <p key={f.ticker} className="font-mono text-gray-500">
                      {f.ticker}: {f.reasonSummary}
                    </p>
                  ))}
                </div>
                {(failuresOffset > 0 || backfillReport.failuresNextCursor !== null) && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setFailuresOffset((p) => Math.max(0, p - FAILURES_PAGE_SIZE))}
                      disabled={failuresOffset === 0}
                      className="text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ‹ anterior
                    </button>
                    <span className="text-gray-600">
                      falhas {failuresOffset + 1}–{failuresOffset + backfillReport.failuresPage.length} de {backfillReport.failedCount}
                    </span>
                    <button
                      onClick={() => {
                        if (backfillReport.failuresNextCursor !== null) setFailuresOffset(backfillReport.failuresNextCursor);
                      }}
                      disabled={backfillReport.failuresNextCursor === null}
                      className="text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      próxima ›
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {activeVersion?.evidence ? (
          <p className="text-xs text-gray-500 font-mono border-t border-gray-800 pt-2">
            Intervalo D1/snapshot da versão ativa: {activeVersion.evidence.windowStart} → {activeVersion.evidence.windowEnd} · dataset{' '}
            {activeVersion.evidence.datasetHash} · fundamentos CVM point-in-time utilizados no treino (corte/asOf:{' '}
            {activeVersion.asOf})
          </p>
        ) : (
          <p className="text-xs text-gray-600 border-t border-gray-800 pt-2">
            Sem versão ativa — intervalo D1/snapshot e corte de fundamentos CVM aparecem aqui após um treino aprovado.
          </p>
        )}
      </div>

      {loadingVersions && (
        <p className="text-sm text-gray-400">Carregando estado do modelo...</p>
      )}

      {!loadingVersions && loadError && (
        <div className="bg-red-900/20 border border-red-500/40 rounded p-4 space-y-3">
          {/* Achado alto 9: título distingue DADOS_INSUFICIENTES de SERVIÇO_INDISPONÍVEL por código, nunca uma mensagem fundida. */}
          <p className="text-sm text-red-400 font-semibold">{errorHeadline(loadError)}</p>
          <p className="text-xs text-red-300">
            {loadError.code}: {loadError.message}
          </p>
          <button
            onClick={() => void loadActiveVersion()}
            className="bg-gray-700 hover:bg-gray-600 rounded px-4 py-2 text-sm font-semibold"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {!loadingVersions && !loadError && !activeVersion && (
        <div className="bg-yellow-900/20 border border-yellow-500/40 rounded p-4 space-y-3">
          <p className="text-sm text-yellow-400 font-semibold">
            SEM_MODELO_APROVADO — nenhum modelo aprovado no gate estatístico. As previsões não estão disponíveis até que um treino seja aprovado.
          </p>

          <div className="border-t border-yellow-500/20 pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-300">Última pesquisa / histórico ({MODEL_LABEL})</p>
            {loadingResearch && <p className="text-xs text-gray-500">Carregando pesquisas...</p>}
            {!loadingResearch && researchError && (
              <p className="text-xs text-red-400">
                {errorHeadline(researchError)} — falha ao consultar pesquisas ({researchError.code}): {researchError.message}
              </p>
            )}
            {!loadingResearch && !researchError && researchRuns.length === 0 && (
              <p className="text-xs text-gray-500">Nenhuma pesquisa registrada ainda para {MODEL_LABEL}.</p>
            )}
            {!loadingResearch && !researchError && researchRuns.length > 0 && (
              <div className="space-y-2">
                {researchRuns.map((r) => (
                  <div key={r.runId} className="bg-gray-900/50 rounded p-3 text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-300">{r.name}</p>
                      <span
                        className={
                          r.outcome === 'APROVADO'
                            ? 'text-green-400 text-[10px] font-mono px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/30'
                            : 'text-red-400 text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30'
                        }
                      >
                        {r.outcome}
                      </span>
                    </div>
                    <p className="text-gray-500 font-mono">
                      {r.windowStart} → {r.windowEnd} · criado em {r.createdAt}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {costProfileSelector}
          <div className="flex gap-3">
            <button
              onClick={handleBackfill}
              disabled={backfilling}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded px-4 py-2 text-sm font-semibold"
            >
              {backfilling ? 'Executando backfill...' : 'Backfill D1'}
            </button>
            <button
              onClick={handleTrain}
              disabled={trainDisabled}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded px-4 py-2 text-sm font-semibold"
            >
              {training ? 'Treinando (pode levar minutos)...' : 'Treinar (walk-forward)'}
            </button>
          </div>
        </div>
      )}

      {!loadingVersions && !loadError && activeVersion && (
        <div className="bg-green-900/10 border border-green-500/30 rounded p-4 space-y-1">
          <p className="text-sm text-green-400 font-semibold">MODELO_ATIVO</p>
          <p className="text-xs text-gray-300 font-mono">
            {activeVersion.modelVersion} · corte (asOf): {activeVersion.asOf}
          </p>
          <p className="text-xs text-gray-400">Horizonte fixo: 10 pregões · D1</p>
          <p className="text-xs text-gray-400">
            Status do gate: {activeVersion.gateApproved ? 'aprovado' : 'ver evidência abaixo'}
          </p>
        </div>
      )}

      {!loadingVersions && !loadError && activeVersion && activeVersion.evidence && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gray-900/60 rounded p-3">
              <p className="text-xs text-gray-400">Acurácia agregada</p>
              <p className="text-lg font-bold">{(activeVersion.evidence.accuracy * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-gray-900/60 rounded p-3">
              <p className="text-xs text-gray-400">N amostras</p>
              <p className="text-lg font-bold">{activeVersion.evidence.nSamples}</p>
            </div>
            <div className="bg-gray-900/60 rounded p-3">
              <p className="text-xs text-gray-400">Dataset hash</p>
              <p className="text-xs font-mono break-all">{activeVersion.evidence.datasetHash}</p>
            </div>
            <div className="bg-gray-900/60 rounded p-3">
              <p className="text-xs text-gray-400">Artifact hash</p>
              <p className="text-xs font-mono break-all">{activeVersion.evidence.artifactHash}</p>
            </div>
            <div className="bg-gray-900/60 rounded p-3">
              <p className="text-xs text-gray-400">TimesFM</p>
              <p className="text-xs font-mono break-all">{activeVersion.evidence.timesfmVersion ?? '—'}</p>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Janela: {activeVersion.evidence.windowStart} → {activeVersion.evidence.windowEnd}
          </p>

          <div>
            <p className="text-sm font-semibold text-gray-300 mb-2">Gate estatístico — comparações vs. baselines</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 text-left">
                    <th className="py-1 pr-4">Baseline</th>
                    <th className="py-1 pr-4">Δ acurácia</th>
                    <th className="py-1 pr-4">CI inferior</th>
                    <th className="py-1 pr-4">Aprovado</th>
                  </tr>
                </thead>
                <tbody>
                  {activeVersion.evidence.gateComparisons.map((c) => (
                    <tr key={c.baseline} className="border-t border-gray-800">
                      <td className="py-1 pr-4 font-mono">{c.baseline}</td>
                      <td className="py-1 pr-4">{(c.accuracyDiff * 100).toFixed(2)}%</td>
                      <td className="py-1 pr-4">{(c.ciLower * 100).toFixed(2)}%</td>
                      <td className="py-1 pr-4">
                        <span className={c.passed ? 'text-green-400' : 'text-red-400'}>{c.passed ? 'sim' : 'não'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-gray-900/40 rounded p-2">
              <p className="text-gray-400">alwaysUp</p>
              <p className="font-mono">{(activeVersion.evidence.baselines.alwaysUp * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-gray-900/40 rounded p-2">
              <p className="text-gray-400">timesfmOnly</p>
              <p className="font-mono">{(activeVersion.evidence.baselines.timesfmOnly * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-gray-900/40 rounded p-2">
              <p className="text-gray-400">fundamentalOnly</p>
              <p className="font-mono">{(activeVersion.evidence.baselines.fundamentalOnly * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-gray-900/40 rounded p-2">
              <p className="text-gray-400">priceOnlyLgbm</p>
              <p className="font-mono">{(activeVersion.evidence.baselines.priceOnlyLgbm * 100).toFixed(1)}%</p>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-3 space-y-3">
            <p className="text-sm font-semibold text-gray-300">Resumo do BacktestRun econômico (Item A)</p>
            {loadingBacktests && <p className="text-xs text-gray-500">Carregando backtests...</p>}
            {!loadingBacktests && backtestsError && (
              <p className="text-xs text-red-400">
                {errorHeadline(backtestsError)} — falha ao consultar backtests ({backtestsError.code}): {backtestsError.message}
              </p>
            )}
            {!loadingBacktests && !backtestsError && backtestRuns.length === 0 && (
              <p className="text-xs text-gray-500">Nenhum BacktestRun associado a esta versão ainda.</p>
            )}
            {!loadingBacktests && !backtestsError && backtestRuns.length > 0 && (
              <div className="space-y-2">
                {backtestRuns.map((run) => {
                  const costProfile = run.costProfileRef ? costProfileCache[run.costProfileRef.id] : undefined;
                  return (
                    <div key={run.backtestId} className="bg-gray-900/50 rounded p-3 text-xs space-y-1">
                      <p className="font-mono text-gray-400">
                        {run.backtestId} · {run.windowStart} → {run.windowEnd}
                        {run.costProfileRef ? ` · perfil ${run.costProfileRef.id} (v${run.costProfileRef.version})` : ''}
                      </p>
                      {isBacktestMetrics(run.metrics) ? (
                        <p className="font-mono">
                          retorno {(run.metrics.totalNetReturn * 100).toFixed(2)}% · drawdown{' '}
                          {(run.metrics.maxDrawdown * 100).toFixed(2)}% · sharpe {run.metrics.sharpe.toFixed(2)} ·{' '}
                          {run.metrics.trades} op(s)
                          {run.signalCoverage
                            ? ` · cobertura ${run.signalCoverage.acceptedSignals}/${run.signalCoverage.totalSignalsInWindow}`
                            : ''}
                        </p>
                      ) : (
                        <p className="text-gray-500">métricas indisponíveis para este run</p>
                      )}
                      {/* Bloqueador 5: componentes de custo de fato usados — nunca só a referência opaca id/versão.
                          Achado médio 11: erro explícito por id — nunca fica "carregando..." para sempre. */}
                      {run.costProfileRef ? (
                        costProfile ? (
                          <p className="font-mono text-gray-500">
                            corretagem R${costProfile.fixedBrokerage.toFixed(2)} · emolumentos{' '}
                            {(costProfile.emolumentsPct * 100).toFixed(3)}% · spread {costProfile.spreadBps}bps ·
                            slippage {costProfile.slippageBps}bps · lote {costProfile.lotSize} · fonte:{' '}
                            {costProfile.sourceSummary}
                          </p>
                        ) : costProfileCacheError[run.costProfileRef.id] ? (
                          <p className="text-red-400">
                            DADOS_INSUFICIENTES — falha ao carregar perfil de custo histórico: {costProfileCacheError[run.costProfileRef.id]}
                          </p>
                        ) : (
                          <p className="text-gray-600">carregando componentes de custo...</p>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-gray-800 pt-3 space-y-3">
            <p className="text-sm font-semibold text-gray-300">Pesquisas associadas a esta versão</p>
            {loadingResearch && <p className="text-xs text-gray-500">Carregando pesquisas...</p>}
            {!loadingResearch && researchError && (
              <p className="text-xs text-red-400">
                {errorHeadline(researchError)} — falha ao consultar pesquisas ({researchError.code}): {researchError.message}
              </p>
            )}
            {!loadingResearch && !researchError && researchRuns.length === 0 && (
              <p className="text-xs text-gray-500">Nenhuma pesquisa associada a esta versão.</p>
            )}
            {!loadingResearch && !researchError && researchRuns.length > 0 && (
              <div className="space-y-2">
                {researchRuns.map((r) => (
                  <div key={r.runId} className="bg-gray-900/50 rounded p-3 text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-300">{r.name}</p>
                      <span
                        className={
                          r.outcome === 'APROVADO'
                            ? 'text-green-400 text-[10px] font-mono px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/30'
                            : 'text-red-400 text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30'
                        }
                      >
                        {r.outcome}
                      </span>
                    </div>
                    <p className="text-gray-500 font-mono">
                      {r.windowStart} → {r.windowEnd}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {costProfileSelector}
          <div className="flex gap-3">
            <button
              onClick={handleBackfill}
              disabled={backfilling}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded px-4 py-2 text-sm font-semibold"
            >
              {backfilling ? 'Executando backfill...' : 'Backfill D1'}
            </button>
            <button
              onClick={handleTrain}
              disabled={trainDisabled}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded px-4 py-2 text-sm font-semibold"
            >
              {training ? 'Treinando (pode levar minutos)...' : 'Retreinar (walk-forward)'}
            </button>
          </div>
        </div>
      )}

      {!loadingVersions && !loadError && activeVersion && (
        <div className="border-t border-gray-800 pt-4 space-y-3">
          <p className="text-sm font-semibold text-gray-300">Previsão por ticker</p>
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Ticker (ex.: PETR4)</label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                className="w-40 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm font-mono"
                placeholder="PETR4"
              />
            </div>
            <button
              onClick={handlePredict}
              disabled={predicting || ticker.trim().length === 0}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded px-4 py-2 text-sm font-semibold"
            >
              {predicting ? 'Prevendo...' : 'Prever'}
            </button>
          </div>

          {prediction && (
            <div className="bg-gray-900/60 rounded p-4 space-y-3 mt-2">
              <div className="flex items-center gap-4">
                <span className={`text-2xl font-black px-5 py-2 rounded-lg ${DIRECTION_STYLES[prediction.direction]}`}>
                  {prediction.direction}
                </span>
                <div>
                  <p className="text-xs text-gray-400">{prediction.symbol} · {prediction.date}</p>
                  <p className="text-lg font-bold">score {prediction.score.toFixed(4)}</p>
                </div>
              </div>
              {/* Bloqueador 7 + achado alto 4: vínculo canônico devolvido pela PRÓPRIA chamada de previsão —
                  nunca `activeVersion`, que pode já estar obsoleto sob concorrência. */}
              {predictionMeta && (
                <p className="text-xs text-gray-400 font-mono break-all">
                  Versão do modelo: {predictionMeta.modelVersionId} · dataset: {predictionMeta.datasetHash} · artefato:{' '}
                  {predictionMeta.artifactHash} · Horizonte: 10 pregões · D1
                </p>
              )}
              {prediction.topFeatures.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Top features</p>
                  <div className="flex flex-wrap gap-2">
                    {prediction.topFeatures.map((f) => (
                      <span key={f.name} className="text-xs font-mono bg-gray-800 rounded px-2 py-1">
                        {f.name}: {f.importance.toFixed(4)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(() => {
                // Bloqueador 3: `sourceMeta` já vem plano/allowlisted do
                // servidor — só filtra chaves nulas (dado ausente/redigido).
                const safeEntries = (Object.keys(SOURCE_META_LABELS) as (keyof typeof SOURCE_META_LABELS)[])
                  .filter((key) => prediction.sourceMeta[key] !== null)
                  .map((key) => [SOURCE_META_LABELS[key], prediction.sourceMeta[key] as string] as const);
                if (safeEntries.length === 0) return null;
                return (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Proveniência (digest/versão)</p>
                    <div className="flex flex-wrap gap-2">
                      {safeEntries.map(([key, value]) => (
                        <span key={key} className="text-xs font-mono bg-gray-800 rounded px-2 py-1 break-all">
                          {key}: {value}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-gray-500 border-t border-gray-800 pt-3">
        Pesquisa quantitativa — não é recomendação de investimento. Previsões nunca geram ordem.
      </p>
    </div>
  );
}
