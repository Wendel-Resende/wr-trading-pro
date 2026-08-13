'use client';

import React, { useCallback, useEffect, useState } from 'react';
import SaudeTable from './SaudeTable';
import ExclusoesPanel from './ExclusoesPanel';
import BancosPanel from './BancosPanel';
import { getJson, emDeclinio, type HealthResponse } from './types';

/**
 * ÚNICO componente desta pasta que conhece rede. Os filhos recebem dados por
 * props e são testáveis isoladamente — mesma fronteira de `components/ranking/`.
 */

type Filtro = 'TODOS' | 'DECLINIO';

export default function SaudeFinanceiraView(): React.ReactElement {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('TODOS');

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      setData(await getJson<HealthResponse>('/api/cvm/financial-health'));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o ranking.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const rows = data?.rows ?? [];
  const visiveis = filtro === 'DECLINIO' ? rows.filter(emDeclinio) : rows;
  const emQueda = rows.filter(emDeclinio).length;

  return (
    <div className="space-y-4">
      <div className="cyber-card p-4">
        <p className="text-xs text-gray-400">
          <strong className="text-gray-300">Consistência financeira histórica.</strong>{' '}
          Não é previsão de retorno nem recomendação de compra. O escore é a fração média de
          cinco pilares aprovados por trimestre — alavancagem, liquidez, cobertura de juros,
          lucro e geração de caixa —, contada apenas sobre balanços cujo prazo legal de
          publicação já venceu.
        </p>
        {data && (
          <p className="mt-2 text-[11px] text-gray-600 font-mono">
            {data.universo.ranqueadas} ranqueadas de {data.universo.total} · limiares: dívida/PL ≤{' '}
            {data.criterios.limiares.maxDividaBrutaPl} · liquidez ≥{' '}
            {data.criterios.limiares.minLiquidezCorrente} · juros ≥ {data.criterios.limiares.minIcj} ·
            mínimo de {data.criterios.minTrimestres} trimestres · janela recente de{' '}
            {data.criterios.janelaRecente}
          </p>
        )}
      </div>

      {erro && (
        <div className="cyber-card p-4 border border-red-500/40">
          <p className="text-xs text-red-400">{erro}</p>
          <button
            onClick={() => void carregar()}
            className="cyber-button cyber-button-secondary mt-2 text-xs"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {!erro && (
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFiltro('TODOS')}
              className={`cyber-button text-xs ${filtro === 'TODOS' ? '' : 'cyber-button-secondary'}`}
            >
              Todas ({rows.length})
            </button>
            <button
              onClick={() => setFiltro('DECLINIO')}
              className={`cyber-button text-xs ${filtro === 'DECLINIO' ? '' : 'cyber-button-secondary'}`}
              title="Escore recente ao menos 15 p.p. abaixo do histórico"
            >
              Em declínio ({emQueda})
            </button>
          </div>

          <div className="cyber-card p-4">
            <SaudeTable
              rows={visiveis}
              loading={loading}
              emptyMessage={
                filtro === 'DECLINIO'
                  ? 'Nenhuma empresa com queda relevante entre o histórico e os últimos trimestres.'
                  : 'Nenhuma empresa qualificada — verifique se o banco de fundamentos CVM está presente.'
              }
            />
          </div>

          <BancosPanel />

          {data && <ExclusoesPanel excluidas={data.universo.excluidas} />}
        </>
      )}
    </div>
  );
}
