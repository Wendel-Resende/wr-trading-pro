'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';

const MODEL_LABEL = 'ml-hybrid-swing-v1';
const TICKER_REGEX = /^[A-Z]{4}\d{1,2}$/;

interface ModelVersionReadModel {
  readonly modelVersion: string;
  readonly kind: string;
  readonly label: string;
  readonly asOf: string;
  readonly hyperparametersJson: string;
  readonly trainingEvidenceJson: string | null;
  readonly invalidatedAt: string | null;
  readonly invalidationReason: string | null;
  readonly createdAt: string;
}

interface GateComparison {
  readonly baseline: string;
  readonly accuracyDiff: number;
  readonly ciLower: number;
  readonly passed: boolean;
}

interface TrainingEvidence {
  aggregate: { nSamples: number; accuracy: number };
  baselines: {
    alwaysUp: { accuracy: number };
    timesfmOnly: { accuracy: number };
    fundamentalOnly: { accuracy: number };
    priceOnlyLgbm: { accuracy: number };
  };
  gate: { approved: boolean; comparisons: GateComparison[] };
  artifact: { hash: string; path: string };
  backtestProxy?: Record<string, unknown>;
  datasetHash: string;
  windowStart: string;
  windowEnd: string;
}

interface PredictResult {
  symbol: string;
  date: string;
  direction: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  topFeatures: readonly { name: string; importance: number }[];
  sourceMeta: Record<string, unknown>;
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

const DIRECTION_STYLES: Record<PredictResult['direction'], string> = {
  BUY: 'bg-green-500/20 text-green-400 border border-green-500/40',
  SELL: 'bg-red-500/20 text-red-400 border border-red-500/40',
  HOLD: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
};

export default function HybridGovernedView() {
  const toast = useToast();

  const [loadingVersions, setLoadingVersions] = useState(true);
  const [activeVersion, setActiveVersion] = useState<ModelVersionReadModel | null>(null);
  const [evidence, setEvidence] = useState<TrainingEvidence | null>(null);

  const [backfilling, setBackfilling] = useState(false);
  const [training, setTraining] = useState(false);

  const [ticker, setTicker] = useState('');
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState<PredictResult | null>(null);

  const loadActiveVersion = useCallback(async () => {
    setLoadingVersions(true);
    try {
      const res = await fetch('/api/v1/model-versions?kind=ML');
      const json = (await res.json()) as ApiEnvelope<ModelVersionReadModel[]>;
      if (!json.success) {
        toast.error(`${json.error.code}: ${json.error.message}`);
        setActiveVersion(null);
        setEvidence(null);
        return;
      }
      const candidates = json.data
        .filter((v) => v.label === MODEL_LABEL && v.invalidatedAt === null)
        .slice()
        .sort((a, b) => (a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : 0));
      const latest = candidates[0] ?? null;
      setActiveVersion(latest);
      if (latest?.trainingEvidenceJson) {
        try {
          setEvidence(JSON.parse(latest.trainingEvidenceJson) as TrainingEvidence);
        } catch {
          setEvidence(null);
        }
      } else {
        setEvidence(null);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingVersions(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadActiveVersion();
  }, [loadActiveVersion]);

  const handleBackfill = useCallback(async () => {
    setBackfilling(true);
    try {
      const res = await fetch('/api/v1/ml/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as ApiEnvelope<{ ok: string[]; failed: Record<string, string> }>;
      if (!json.success) {
        toast.error(`${json.error.code}: ${json.error.message}`);
        return;
      }
      toast.success(`Backfill D1: ${json.data.ok.length} símbolo(s) OK, ${Object.keys(json.data.failed).length} falha(s)`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBackfilling(false);
    }
  }, [toast]);

  const handleTrain = useCallback(async () => {
    setTraining(true);
    try {
      const res = await fetch('/api/v1/ml/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
  }, [toast, loadActiveVersion]);

  const handlePredict = useCallback(async () => {
    const upper = ticker.trim().toUpperCase();
    if (!TICKER_REGEX.test(upper)) {
      toast.error('Ticker inválido — formato esperado: 4 letras + 1-2 dígitos (ex.: PETR4).');
      return;
    }
    setPredicting(true);
    setPrediction(null);
    try {
      const res = await fetch('/api/v1/ml/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: upper }),
      });
      const json = (await res.json()) as ApiEnvelope<{ signalId: string; prediction: PredictResult }>;
      if (!json.success) {
        toast.error(`${json.error.code}: ${json.error.message}`);
        return;
      }
      setPrediction(json.data.prediction);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPredicting(false);
    }
  }, [ticker, toast]);

  return (
    <div className="cyber-card p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-orbitron text-xl font-bold neon-text-cyan">Híbrido governado</h3>
        {!loadingVersions && activeVersion && (
          <span className="text-xs font-mono px-3 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/40">
            Versão ativa: {activeVersion.modelVersion}
          </span>
        )}
      </div>

      {loadingVersions && (
        <p className="text-sm text-gray-400">Carregando estado do modelo...</p>
      )}

      {!loadingVersions && !activeVersion && (
        <div className="bg-yellow-900/20 border border-yellow-500/40 rounded p-4 space-y-3">
          <p className="text-sm text-yellow-400 font-semibold">
            Nenhum modelo aprovado no gate estatístico. As previsões abaixo não estão disponíveis até que um treino seja aprovado.
          </p>
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
              disabled={training}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded px-4 py-2 text-sm font-semibold"
            >
              {training ? 'Treinando (pode levar minutos)...' : 'Treinar (walk-forward)'}
            </button>
          </div>
        </div>
      )}

      {!loadingVersions && activeVersion && evidence && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gray-900/60 rounded p-3">
              <p className="text-xs text-gray-400">Acurácia agregada</p>
              <p className="text-lg font-bold">{(evidence.aggregate.accuracy * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-gray-900/60 rounded p-3">
              <p className="text-xs text-gray-400">N amostras</p>
              <p className="text-lg font-bold">{evidence.aggregate.nSamples}</p>
            </div>
            <div className="bg-gray-900/60 rounded p-3">
              <p className="text-xs text-gray-400">Dataset hash</p>
              <p className="text-xs font-mono break-all">{evidence.datasetHash}</p>
            </div>
            <div className="bg-gray-900/60 rounded p-3">
              <p className="text-xs text-gray-400">Artifact hash</p>
              <p className="text-xs font-mono break-all">{evidence.artifact.hash}</p>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Janela: {evidence.windowStart} → {evidence.windowEnd} · Artifact: {evidence.artifact.path}
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
                  {evidence.gate.comparisons.map((c) => (
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
              <p className="font-mono">{(evidence.baselines.alwaysUp.accuracy * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-gray-900/40 rounded p-2">
              <p className="text-gray-400">timesfmOnly</p>
              <p className="font-mono">{(evidence.baselines.timesfmOnly.accuracy * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-gray-900/40 rounded p-2">
              <p className="text-gray-400">fundamentalOnly</p>
              <p className="font-mono">{(evidence.baselines.fundamentalOnly.accuracy * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-gray-900/40 rounded p-2">
              <p className="text-gray-400">priceOnlyLgbm</p>
              <p className="font-mono">{(evidence.baselines.priceOnlyLgbm.accuracy * 100).toFixed(1)}%</p>
            </div>
          </div>

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
              disabled={training}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded px-4 py-2 text-sm font-semibold"
            >
              {training ? 'Treinando (pode levar minutos)...' : 'Retreinar (walk-forward)'}
            </button>
          </div>
        </div>
      )}

      {!loadingVersions && activeVersion && (
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
              <p className="text-xs text-gray-500 font-mono break-all">
                sourceMeta: {JSON.stringify(prediction.sourceMeta)}
              </p>
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
