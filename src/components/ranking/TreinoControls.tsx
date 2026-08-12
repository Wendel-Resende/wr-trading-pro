'use client';

import React from 'react';
import {
  ACTIVE_RUN_STATUSES,
  PHASE_LABELS,
  num,
  pct,
  shortVersion,
  type CostProfile,
  type TrainingRun,
} from './types';

/**
 * Disparo e acompanhamento do treino. Componente de apresentação: todo o
 * estado e as chamadas de rede vivem no pai (RankingFundamentalistaView);
 * aqui só entram dados e callbacks.
 *
 * O treino é assíncrono (Item C): a rota responde 202 e o job Python roda em
 * processo separado, então a UI acompanha por polling e pode cancelar de
 * verdade — nunca segura a conexão por minutos.
 */

interface Props {
  readonly costProfiles: readonly CostProfile[];
  readonly selectedCostProfileId: string;
  readonly onSelectCostProfile: (id: string) => void;
  readonly onTrain: () => void;
  readonly onCancel: () => void;
  readonly training: boolean;
  readonly trainingRun: TrainingRun | null;
}

export default function TreinoControls({
  costProfiles,
  selectedCostProfileId,
  onSelectCostProfile,
  onTrain,
  onCancel,
  training,
  trainingRun,
}: Props): React.ReactElement {
  const runActive = trainingRun !== null && ACTIVE_RUN_STATUSES.has(trainingRun.status);

  return (
    <div className="bg-gray-900/40 border border-gray-800 rounded p-4 space-y-3">
      <p className="text-sm font-semibold text-gray-300">Treinar novo modelo</p>

      {costProfiles.length === 0 ? (
        <p className="text-xs text-red-400">
          Nenhum perfil de custos ativo — cadastre um <code>BacktestCostProfile</code> antes de treinar. O
          gate avalia o excesso LÍQUIDO de custos, então sem perfil não há como decidir.
        </p>
      ) : (
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="perfil-custos">
              Perfil de custos
            </label>
            <select
              id="perfil-custos"
              value={selectedCostProfileId}
              onChange={(e) => onSelectCostProfile(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm min-w-[16rem]"
            >
              <option value="">Selecione um perfil…</option>
              {costProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · v{p.version}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={onTrain}
            disabled={training || !selectedCostProfileId || runActive}
            className="bg-blue-700 hover:bg-blue-600 disabled:opacity-40 rounded px-4 py-2 text-sm font-semibold"
          >
            {training ? 'Iniciando…' : runActive ? 'Treino em andamento' : 'Treinar (walk-forward trimestral)'}
          </button>
        </div>
      )}

      <p className="text-[11px] text-gray-600">
        O treino roda o walk-forward completo e aplica os cinco gates no servidor. Um modelo reprovado é
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
                    : runActive
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/40'
                      : 'bg-red-500/10 text-red-400 border-red-500/40'
              }`}
            >
              {trainingRun.status}
            </span>
            {runActive && (
              <span className="text-gray-500">
                {PHASE_LABELS[trainingRun.phase]} — {trainingRun.progress}%
              </span>
            )}
          </div>

          {runActive && (
            <div className="w-full bg-gray-800 rounded h-1.5 overflow-hidden">
              <div className="bg-blue-500 h-1.5 transition-all" style={{ width: `${trainingRun.progress}%` }} />
            </div>
          )}

          {trainingRun.status === 'REJECTED' && (
            <p className="text-yellow-400">
              Gate reprovado — nenhuma versão foi ativada. O modelo fica registrado no histórico para
              auditoria.
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

          {runActive && (
            <button
              onClick={onCancel}
              disabled={trainingRun.status === 'CANCEL_REQUESTED'}
              className="bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded px-3 py-1 text-xs font-semibold"
            >
              {trainingRun.status === 'CANCEL_REQUESTED' ? 'Cancelando…' : 'Cancelar treino'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
