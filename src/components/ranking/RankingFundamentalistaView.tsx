'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import RankingTable from './RankingTable';
import EvidenciaModelo from './EvidenciaModelo';
import TreinoControls from './TreinoControls';
import {
  ACTIVE_RUN_STATUSES,
  describeError,
  getJson,
  isApiError,
  num,
  pct,
  postJson,
  shortVersion,
  type ApiError,
  type CostProfile,
  type DirectionalModel,
  type RankingEntry,
  type TrainingRun,
} from './types';

/**
 * Ranking Fundamentalista — orquestrador da aba.
 *
 * ÚNICO componente desta pasta que fala com a rede; os filhos recebem tudo por
 * props. Consome apenas os DTOs públicos de `/api/v1/ml/directional/*` (nunca
 * `artifactPath`, nunca hiperparâmetro bruto).
 *
 * A tela é deliberadamente honesta: sem modelo aprovado no gate ela não mostra
 * ranking nenhum — mostra QUAIS gates reprovaram e com que números.
 *
 * Reposicionado em 2026-08-11 (era "Previsões ML"): o motor ORDENA empresas na
 * seção transversal do trimestre e não prevê direção de preço. Ver
 * docs/superpowers/specs/2026-08-11-ranking-fundamentalista-design.md.
 */

type Filtro = 'TODOS' | 'EXTREMOS';

/** Quintis extremos: topo e fundo do ranking. */
const isExtremo = (e: RankingEntry): boolean => e.quantile === 1 || e.quantile === 5;

export default function RankingFundamentalistaView(): React.ReactElement {
  const toast = useToast();

  const [activeModels, setActiveModels] = useState<readonly DirectionalModel[]>([]);
  const [allModels, setAllModels] = useState<readonly DirectionalModel[]>([]);
  const [modelsError, setModelsError] = useState<ApiError | null>(null);
  const [loadingModels, setLoadingModels] = useState(true);

  const [selectedVersion, setSelectedVersion] = useState('');
  const [entries, setEntries] = useState<readonly RankingEntry[]>([]);
  const [rankingMeta, setRankingMeta] = useState<Record<string, unknown>>({});
  const [loadingRanking, setLoadingRanking] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [costProfiles, setCostProfiles] = useState<readonly CostProfile[]>([]);
  const [selectedCostProfileId, setSelectedCostProfileId] = useState('');
  const [training, setTraining] = useState(false);
  const [trainingRun, setTrainingRun] = useState<TrainingRun | null>(null);

  const [filtro, setFiltro] = useState<Filtro>('EXTREMOS');

  /**
   * Total de empresas do universo CVM. Serve para dizer quantas ficaram FORA do
   * ranking por não terem série de preços — informação que o GET de ranking não
   * devolve (`excludedFromUniverse` só vem na geração) e que o modelo não
   * persiste. Derivar daqui evita inventar coluna no banco.
   */
  const [totalUniversoCvm, setTotalUniversoCvm] = useState<number | null>(null);

  const selectedModel = useMemo(
    () => allModels.find((m) => m.modelVersion === selectedVersion) ?? null,
    [allModels, selectedVersion],
  );

  // --- carregamento ------------------------------------------------------
  /**
   * `preferActive`: força a seleção a saltar para o modelo ACTIVE. Usado quando
   * um treino termina — sem isso a tela continuaria apontando para a versão
   * anterior, que o próprio treino acabou de mover para SUPERSEDED, e "Gerar
   * ranking agora" falharia com INVALID_STATE. Fora desse caso a escolha do
   * usuário é respeitada: inspecionar um modelo antigo é legítimo.
   */
  const loadModels = useCallback(async (preferActive = false) => {
    setLoadingModels(true);
    try {
      const [active, all] = await Promise.all([
        getJson<DirectionalModel[]>('/api/v1/ml/directional/models?status=ACTIVE&limit=20'),
        getJson<DirectionalModel[]>('/api/v1/ml/directional/models?limit=50'),
      ]);
      setActiveModels(active.data);
      setAllModels(all.data);
      setModelsError(null);
      const activeVersion = active.data[0]?.modelVersion ?? '';
      setSelectedVersion((current) => (preferActive && activeVersion ? activeVersion : current || activeVersion));
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

  // `/api/cvm/companies` tem envelope próprio ({ companies, count }), não o
  // jsonSuccess das rotas /api/v1 — por isso não usa getJson.
  const loadUniversoCvm = useCallback(async () => {
    try {
      const res = await fetch('/api/cvm/companies');
      if (!res.ok) return;
      const body = await res.json();
      const total = typeof body?.count === 'number'
        ? body.count
        : Array.isArray(body?.companies) ? body.companies.length : null;
      setTotalUniversoCvm(total);
    } catch {
      // Silencioso: a contagem é informativa. Sem ela a nota some, não mente.
      setTotalUniversoCvm(null);
    }
  }, []);

  const loadRanking = useCallback(async (modelVersion: string) => {
    if (!modelVersion) {
      setEntries([]);
      setRankingMeta({});
      return;
    }
    setLoadingRanking(true);
    try {
      const { data, meta } = await getJson<RankingEntry[]>(
        `/api/v1/ml/directional/predictions?modelVersion=${encodeURIComponent(modelVersion)}`,
      );
      setEntries(data);
      setRankingMeta(meta);
    } catch (error) {
      setEntries([]);
      setRankingMeta({});
      toast.error(`Falha ao carregar o ranking — ${describeError(error)}`);
    } finally {
      setLoadingRanking(false);
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
    void loadUniversoCvm();
  }, [loadModels, loadCostProfiles, loadLatestTrainingRun, loadUniversoCvm]);

  useEffect(() => { void loadRanking(selectedVersion); }, [selectedVersion, loadRanking]);

  // Polling do treino em andamento — para sozinho ao terminar e recarrega as
  // versões, para que um modelo recém-aprovado apareça no seletor.
  useEffect(() => {
    if (!trainingRun || !ACTIVE_RUN_STATUSES.has(trainingRun.status)) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const { data } = await getJson<TrainingRun>(`/api/v1/ml/training-runs/${trainingRun.trainingRunId}`);
          setTrainingRun(data);
          if (!ACTIVE_RUN_STATUSES.has(data.status)) await loadModels(true);
        } catch {
          // Falha pontual de polling não derruba a tela — a próxima tentativa segue.
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
      const { data, meta } = await postJson<RankingEntry[]>('/api/v1/ml/directional/predictions', {
        modelVersion: selectedVersion,
      });
      setEntries(data);
      setRankingMeta(meta);
      const excluidas = Array.isArray(meta.excludedFromUniverse) ? meta.excludedFromUniverse.length : 0;
      toast.success(
        `${data.length} empresas ranqueadas${excluidas > 0 ? ` · ${excluidas} fora do universo validado` : ''}.`,
      );
    } catch (error) {
      toast.error(`Falha ao gerar o ranking — ${describeError(error)}`);
    } finally {
      setGenerating(false);
    }
  }, [selectedVersion, toast]);

  // --- derivados ---------------------------------------------------------
  const extremos = entries.filter(isExtremo);
  const visiveis = filtro === 'EXTREMOS' ? extremos : entries;
  const failedModels = allModels.filter((m) => m.status === 'FAILED');

  const excluidasMeta = Array.isArray(rankingMeta.excludedFromUniverse)
    ? (rankingMeta.excludedFromUniverse as string[])
    : null;
  // Sem a lista nominal (GET não a devolve), a contagem ainda é derivável.
  const excluidasContagem = excluidasMeta?.length
    ?? (totalUniversoCvm !== null && entries.length > 0 ? Math.max(0, totalUniversoCvm - entries.length) : 0);

  const emptyMessage = activeModels.length === 0
    ? 'Sem modelo aprovado no gate, nenhum ranking é exibido.'
    : entries.length === 0
      ? 'Nenhum ranking gerado ainda para esta versão — use “Gerar ranking agora”.'
      : 'Nenhuma empresa nos quintis extremos nesta geração.';

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
            comprovado. A posição no ranking é o resultado — não há previsão de preço nem probabilidade
            estimada.
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
              Nenhum modelo passou no gate de aceitação — por isso não há ranking a exibir.
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

        {selectedModel && <EvidenciaModelo model={selectedModel} />}
      </div>

      {/* ---------------- Ranking ---------------- */}
      <div className="bg-gray-900/40 border border-gray-800 rounded p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm font-semibold text-gray-300">Ranking do trimestre</p>
          <div className="flex items-center gap-2">
            <select
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as Filtro)}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
            >
              <option value="EXTREMOS">Somente quintis extremos (Q1 e Q5)</option>
              <option value="TODOS">Todas as empresas</option>
            </select>
            <button
              onClick={() => void handleGenerate()}
              /* Só modelo ACTIVE gera ranking (regra do servidor). Desabilitar
                 aqui evita oferecer uma ação que sempre falharia com
                 INVALID_STATE ao inspecionar uma versão antiga. */
              disabled={
                !selectedVersion || generating || activeModels.length === 0 || selectedModel?.status !== 'ACTIVE'
              }
              title={
                selectedModel && selectedModel.status !== 'ACTIVE'
                  ? `Somente modelos ACTIVE geram ranking — este está ${selectedModel.status}.`
                  : undefined
              }
              className="bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 rounded px-3 py-1 text-xs font-semibold"
            >
              {generating ? 'Gerando…' : 'Gerar ranking agora'}
            </button>
          </div>
        </div>

        {excluidasContagem > 0 && (
          <p className="text-[11px] text-yellow-400/90 bg-yellow-500/5 border border-yellow-500/20 rounded p-2">
            <span className="font-semibold">{entries.length} empresas ranqueadas</span> — {excluidasContagem}{' '}
            do universo CVM ficaram FORA por não terem série de preços que permita medir o resultado.
            {excluidasMeta && excluidasMeta.length > 0 && (
              <> <span className="font-mono">{excluidasMeta.join(', ')}</span>.</>
            )}{' '}
            Elas têm fundamentos e seriam pontuáveis, mas o modelo nunca foi validado nelas — ranqueá-las
            junto daria a elas o mesmo peso das validadas e deslocaria empresas reais dos extremos.
          </p>
        )}

        {activeModels.length > 0 && entries.length > 0 && (
          <p className="text-xs text-gray-500">
            <span className="text-gray-300 font-semibold">{extremos.length}</span> empresas nos quintis
            extremos de <span className="text-gray-300 font-semibold">{entries.length}</span> ranqueadas
            {typeof rankingMeta.generatedAt === 'string' && (
              <> · gerado em {new Date(rankingMeta.generatedAt).toLocaleString('pt-BR')}</>
            )}
          </p>
        )}

        <RankingTable entries={visiveis} loading={loadingRanking} emptyMessage={emptyMessage} />
      </div>

      {/* ---------------- Treinar ---------------- */}
      <TreinoControls
        costProfiles={costProfiles}
        selectedCostProfileId={selectedCostProfileId}
        onSelectCostProfile={setSelectedCostProfileId}
        onTrain={() => void handleTrain()}
        onCancel={() => void handleCancelTraining()}
        training={training}
        trainingRun={trainingRun}
      />

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
                    <span className="text-red-400">{m.gateFailures.length} gate(s) reprovado(s)</span>
                  )}
                </summary>
                <div className="mt-2 pl-2 border-l border-gray-800">
                  <EvidenciaModelo model={m} compact />
                  <p className="text-[11px] text-gray-600 mt-2 font-mono">ResearchRun: {m.researchRunId}</p>
                </div>
              </details>
            ))}
          </div>
        )}
        {failedModels.length > 0 && (
          <p className="text-[11px] text-gray-600">
            {failedModels.length} tentativa(s) reprovada(s) permanecem registradas — nunca aparecem no
            seletor de versão nem entram no ranking.
          </p>
        )}
      </div>
    </div>
  );
}
