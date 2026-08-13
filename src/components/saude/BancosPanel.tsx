'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { getJson } from './types';
import {
  BANK_PILLAR_ORDER,
  BANK_PILLAR_LABELS,
  formatDataBase,
  pctValor,
  pctTaxa,
  bancoEmDeclinio,
  type BankHealthResponse,
} from './bancos-types';

/**
 * Bloco de BANCOS, irmão e separado da tabela da indústria.
 *
 * Existe porque os 10 bancos B3 estavam fora daquela lista por uma razão real
 * — a régua da indústria descreve doença num banco — e não por falta de dado.
 * Aqui a régua é a do próprio regulador, e os dados vêm do BCB/IFData.
 *
 * Duas decisões visíveis na tela:
 *  - Os VALORES ATUAIS aparecem ao lado do escore porque o escore quase não
 *    varia: contra mínimos regulatórios, banco listado aprova quase sempre.
 *    Dez linhas de "100%" não informam; a distância até o mínimo informa.
 *  - A inadimplência fica numa coluna à parte, rotulada com o próprio
 *    perímetro. É outro conglomerado, com outro código e outra data-base —
 *    encostá-la no escore produziria um número que o BCB nunca publicou.
 */
export default function BancosPanel(): React.ReactElement {
  const [data, setData] = useState<BankHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      setData(await getJson<BankHealthResponse>('/api/bcb/financial-health'));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar os bancos.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div className="cyber-card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-orbitron text-sm text-gray-300">
          Bancos — régua prudencial do BCB {data ? `(${data.bancos.length})` : ''}
        </h3>
        {data && (
          <span className="font-mono text-[10px] text-gray-600">
            prudencial {formatDataBase(data.asOf.prudencial)} · financeiro{' '}
            {formatDataBase(data.asOf.financeiro)}
          </span>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Os bancos ficam fora da tabela acima porque os critérios da indústria não descrevem um
        banco. Aqui os limiares não foram calibrados por nós: são os mínimos que o próprio BCB
        exige — Basileia ≥ {data?.criterios.limiares.minBasileiaPct ?? 10.5}%, Capital Nível I ≥{' '}
        {data?.criterios.limiares.minCapitalNivelIPct ?? 8.5}%, alavancagem ≥{' '}
        {data?.criterios.limiares.minAlavancagemPct ?? 3}%, imobilização ≤{' '}
        {data?.criterios.limiares.maxImobilizacaoPct ?? 50}% e lucro acima de zero.
      </p>

      <p className="text-[11px] text-amber-400/80">
        Como banco listado cumpre esses mínimos quase sempre, o escore quase não separa um do
        outro — quem separa são os valores publicados, na metade direita da tabela. O escore diz
        se houve descumprimento; a Basileia atual diz de quanto é a folga.
      </p>

      {erro && (
        <div className="border border-red-500/40 rounded p-3">
          <p className="text-xs text-red-400">{erro}</p>
          <button
            onClick={() => void carregar()}
            className="cyber-button cyber-button-secondary mt-2 text-xs"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {loading && !erro && <p className="text-xs text-gray-500">Carregando bancos…</p>}

      {!loading && !erro && data && data.bancos.length === 0 && (
        <p className="text-xs text-gray-500">
          Nenhum banco disponível — verifique se o snapshot BCB foi sincronizado
          (scripts/bcb-sync/sync-bcb-snapshot.cjs).
        </p>
      )}

      {!loading && !erro && data && data.bancos.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-2 px-2">#</th>
                <th className="text-left py-2 px-2">Ticker</th>
                <th className="text-right py-2 px-2">Escore</th>
                <th className="text-right py-2 px-2">Recente</th>
                {BANK_PILLAR_ORDER.map((k) => (
                  <th key={k} className="text-right py-2 px-2">
                    {BANK_PILLAR_LABELS[k]}
                  </th>
                ))}
                <th className="text-right py-2 px-2 border-l border-gray-800">Basileia</th>
                <th className="text-right py-2 px-2">Nível I</th>
                <th className="text-right py-2 px-2">Alav.</th>
                <th className="text-right py-2 px-2">Imob.</th>
                <th className="text-right py-2 px-2 border-l border-gray-800">Inadimpl.</th>
              </tr>
            </thead>
            <tbody>
              {data.bancos.map((r, i) => (
                <tr key={r.ticker} className="border-b border-gray-900 hover:bg-gray-900/40">
                  <td className="py-2 px-2 text-gray-600 tabular-nums">{i + 1}</td>
                  <td className="py-2 px-2">
                    <span className="font-mono text-gray-200">{r.ticker}</span>
                    <span className="block text-[10px] text-gray-600 truncate max-w-[14rem]">
                      {r.nomeBcb ?? '—'}
                      {r.segmento ? ` · ${r.segmento}` : ''}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-gray-200 tabular-nums">
                    {r.score.toFixed(2)}
                    <span className="block text-[10px] text-gray-600">{r.trimestres} tri</span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    <span className={bancoEmDeclinio(r) ? 'text-amber-400' : 'text-gray-400'}>
                      {r.recente.score === null ? '—' : r.recente.score.toFixed(2)}
                      {bancoEmDeclinio(r) ? ' ⚠' : ''}
                    </span>
                  </td>
                  {BANK_PILLAR_ORDER.map((k) => (
                    <td
                      key={k}
                      className="py-2 px-2 text-right font-mono text-gray-500 tabular-nums"
                      title={`${r.pilares[k].aprovados} de ${r.pilares[k].medidos} trimestres medidos`}
                    >
                      {pctTaxa(r.pilares[k].taxa)}
                    </td>
                  ))}
                  <td className="py-2 px-2 text-right font-mono text-cyber-cyan tabular-nums border-l border-gray-800">
                    {pctValor(r.atual.basileiaPct)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-gray-300 tabular-nums">
                    {pctValor(r.atual.capitalNivelIPct)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-gray-300 tabular-nums">
                    {pctValor(r.atual.alavancagemPct)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-gray-300 tabular-nums">
                    {pctValor(r.atual.imobilizacaoPct)}
                  </td>
                  <td
                    className="py-2 px-2 text-right font-mono text-gray-300 tabular-nums border-l border-gray-800"
                    title={
                      r.inadimplencia
                        ? `Perímetro financeiro, conglomerado ${r.inadimplencia.codInst}, data-base ${formatDataBase(r.inadimplencia.dataBase)} — distinto do prudencial ${r.codInst}`
                        : 'Sem carteira classificada publicada no perímetro financeiro'
                    }
                  >
                    {r.inadimplencia === null ? '—' : pctValor(r.inadimplencia.pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <p className="text-[10px] text-gray-600 leading-relaxed">
          Os cinco percentuais à esquerda são a fração de trimestres em que cada mínimo foi
          cumprido; os quatro à direita são os valores da última data-base publicada. A
          inadimplência (carteira em níveis D a H sobre o total) vem do perímetro FINANCEIRO,
          que é outro conglomerado, com outro código e outra data-base — por isso fica separada
          e nunca entra no escore. Um traço significa dado ausente, nunca zero. Escore
          histórico e recente ficam separados de propósito: a média não sabe quando o banco
          falhou. Fonte: {data.provenance.source}. Descritivo, sem previsão nem recomendação.
        </p>
      )}

      {data && data.excluidos.length > 0 && (
        <div className="border-t border-gray-800 pt-2">
          <p className="text-[11px] text-gray-500">
            Fora do bloco ({data.excluidos.length}):{' '}
            {data.excluidos.map((e) => `${e.ticker} — ${e.razao}`).join(' · ')}
          </p>
        </div>
      )}
    </div>
  );
}
