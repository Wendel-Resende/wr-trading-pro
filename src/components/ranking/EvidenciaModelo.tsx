'use client';

import React from 'react';
import { num, pct, type DirectionalModel } from './types';

/**
 * Evidência do modelo: conferência dos gates, excesso por quintil, spread por
 * ano e IC. Componente puro — recebe o modelo por props, não faz rede.
 *
 * A evidência fica JUNTO do ranking de propósito. Separada, o usuário leria a
 * lista como verdade e só consultaria as ressalvas se lembrasse. É a mesma
 * decisão tomada nas tools MCP (`ml.directional_ranking` devolve ranking e
 * evidência no mesmo payload).
 */

interface Props {
  readonly model: DirectionalModel;
  readonly compact?: boolean;
}

export default function EvidenciaModelo({ model, compact = false }: Props): React.ReactElement {
  const m = model.metrics;
  const barras = m.netQuantileExcess ?? m.quantileExcess;

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
              exigido:{' '}
              {c.code === 'COVERAGE_BELOW_MIN'
                ? `≥ ${c.threshold}`
                : c.code === 'BRIER_ABOVE_MAX'
                  ? `< ${c.threshold}`
                  : `≥ ${pct(c.threshold, 0)}`}
            </p>
          </div>
        ))}
      </div>

      {barras && barras.length > 0 && (
        <div className="bg-gray-900/40 border border-gray-800 rounded p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-300">Retorno por quintil do escore</p>
          <p className="text-[11px] text-gray-600">
            Excesso médio sobre os pares, por trimestre, fora da amostra. É aqui que a vantagem do modelo
            aparece — ou não. Uma métrica de acerto binário não distinguiria o percentil 51 do 99.
          </p>
          <div className="flex gap-1 items-end h-24">
            {barras.map((q) => {
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
                Líquido de custos: {(m.roundTripCost * 100).toFixed(2)}% de ida-e-volta por posição (perfil de
                custo do treino){' '}
                {m.netTopBottomSpread !== null && m.netTopBottomSpread !== undefined && (
                  <>· spread líquido {(m.netTopBottomSpread * 100).toFixed(2)} p.p.</>
                )}
                {' — '}
              </>
            )}
            IC {num(m.ic)} (t {num(m.icTStat, 2)}, {m.icPeriods ?? '—'} períodos) — mede se a ordenação das
            empresas antecipa o excesso de retorno. Um ano negativo no spread não é detalhe: é o tamanho do
            risco de o fator falhar quando você precisar dele.
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

      <p className="text-[11px] text-gray-600">
        Ressalva permanente: as métricas herdam viés de sobrevivência — o universo são as empresas listadas
        hoje, aplicado ao histórico.
      </p>
    </div>
  );
}
