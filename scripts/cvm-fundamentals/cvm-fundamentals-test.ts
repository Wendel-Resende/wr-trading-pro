import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cashConversion, knowledgeDateFor, LEGAL_LAG_RULE, dupontFactors, median, percentile } from '../../src/lib/server/cvm-fundamentals-derive';
import { buildFundamentalSheet } from '../../src/lib/server/cvm-fundamentals-sheet';
import { listCompanies } from '../../src/lib/server/cvm-legacy-db';
import { listSectors, sectorRanking, indicatorCatalog } from '../../src/lib/server/cvm-sector-ranking';

function assertLog(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  console.log(`ok: ${msg}`);
}

function main(): void {
  // --- conversão de caixa (derivada no WR) ---
  assertLog(cashConversion(120, 100).value === 1.2, 'fco/lucro = 1.2 quando ambos positivos');
  const neg = cashConversion(80, -50);
  assertLog(neg.value === null && neg.note === 'LUCRO_NAO_POSITIVO', 'lucro<=0 → null + LUCRO_NAO_POSITIVO');
  assertLog(cashConversion(80, 0).note === 'LUCRO_NAO_POSITIVO', 'lucro=0 → LUCRO_NAO_POSITIVO');
  assertLog(cashConversion(null, 100).note === 'DADO_AUSENTE', 'fco ausente → DADO_AUSENTE');
  assertLog(cashConversion(80, null).note === 'DADO_AUSENTE', 'lucro ausente → DADO_AUSENTE');

  // --- carimbo de conhecimento (prazo legal ITR+45 / DFP+90) ---
  const k1 = knowledgeDateFor('2025-03-31', 2025, 1);
  assertLog(k1.iso === '2025-05-15' && k1.estimadoPorPrazoLegal, 'T1: data_ref + 45d = 2025-05-15, estimado');
  const k4 = knowledgeDateFor('2025-12-31', 2025, 4);
  assertLog(k4.iso === '2026-03-31', 'T4: data_ref + 90d = 2026-03-31');
  const k3 = knowledgeDateFor(null, 2024, 3);
  assertLog(k3.iso === '2024-11-14', 'T3 sem data_ref: fim civil 2024-09-30 + 45d = 2024-11-14');
  assertLog(typeof LEGAL_LAG_RULE === 'string' && LEGAL_LAG_RULE.length > 0, 'regra de prazo documentada');

  // --- decomposição DuPont (ROE = margem líq × giro do ativo × alavancagem) ---
  // ABEV3 real: 0.1822 × 0.6131 × (1/0.6264) ≈ 0.1783 (bate com o ROE do pipeline)
  const d1 = dupontFactors(0.1821724239464315, 0.6131173841939429, 0.6264364635152538, 0.17829913574241726);
  assertLog(Math.abs((d1.alavancagem ?? 0) - 1.5963) < 1e-3, 'alavancagem = 1/pl_ativos ≈ 1.5963');
  assertLog(d1.roeReconstruido !== null && Math.abs(d1.roeReconstruido - 0.1783) < 1e-3, 'produto DuPont reconstrói ROE ≈ 0.1783');
  assertLog(d1.consistente === true, 'reconstrução consistente com o ROE do pipeline');
  // divergência flagada
  const d2 = dupontFactors(0.2, 0.5, 0.5, 0.9);
  assertLog(d2.consistente === false, 'produto (0.2) distante do ROE do pipeline (0.9) → inconsistente');
  // pl_ativos ausente/zero → alavancagem null, sem fabricar
  assertLog(dupontFactors(0.2, 0.5, 0, 0.1).alavancagem === null, 'pl_ativos=0 → alavancagem null');
  assertLog(dupontFactors(0.2, null, 0.5, 0.1).roeReconstruido === null, 'giro ausente → roeReconstruido null');
  assertLog(dupontFactors(null, 0.5, 0.5, null).consistente === null, 'sem ROE do pipeline → consistente null (não checa)');

  // --- estatística de setor (mediana / percentil), ignora null ---
  assertLog(median([]) === null, 'mediana de vazio → null');
  assertLog(median([5]) === 5, 'mediana de um elemento');
  assertLog(median([1, 2, 3, 4]) === 2.5, 'mediana par = média dos centrais');
  assertLog(median([3, 1, 2]) === 2, 'mediana ímpar (desordenado)');
  assertLog(median([2, null, 4, null]) === 3, 'mediana ignora null');
  assertLog(percentile([1, 2, 3, 4], 25) === 1.75, 'p25 por interpolação linear');
  assertLog(percentile([1, 2, 3, 4], 75) === 3.25, 'p75 por interpolação linear');
  assertLog(percentile([10], 90) === 10, 'percentil de um elemento');
  assertLog(percentile([], 50) === null, 'percentil de vazio → null');

  // --- smoke read-only do assembler (só se o banco existir no ambiente) ---
  if (existsSync('data/cvm/cvm_fundamentos.db')) {
    const first = listCompanies()[0];
    assertLog(first !== undefined, 'banco CVM tem ao menos uma empresa');
    const sheet = buildFundamentalSheet(process.env.CVM_TEST_CDCVM ?? first.cdCvm);
    assertLog(sheet !== null, 'ficha montada p/ cd_cvm de teste');
    if (sheet) {
      assertLog(Array.isArray(sheet.series.conversaoCaixa) && sheet.series.conversaoCaixa.length > 0, 'série conversaoCaixa presente e não vazia');
      assertLog(sheet.series.roic.every((p) => p.source === 'pipeline-cvm'), 'roic marcado pipeline-cvm');
      assertLog(sheet.series.conversaoCaixa.every((p) => p.source === 'derivado-wr'), 'conversaoCaixa marcada derivado-wr');
      assertLog(sheet.series.roe.every((p) => typeof p.knowledgeDate === 'string' && p.estimadoPorPrazoLegal), 'todo ponto tem carimbo estimado por prazo legal');
      assertLog(sheet.provenance.tables.includes('fundamental_indicators') && sheet.provenance.tables.includes('dfc_trimestral'), 'proveniência lista as tabelas-fonte');
      // conversão de caixa nunca fabrica: null quando lucro<=0 ou dado ausente
      assertLog(sheet.series.conversaoCaixa.every((p) => p.value === null || Number.isFinite(p.value)), 'conversaoCaixa é número finito ou null explícito');
      const withNote = sheet.series.conversaoCaixa.filter((p) => p.note);
      assertLog(withNote.every((p) => p.value === null), 'todo ponto de conversaoCaixa com nota tem value null (nunca fabricado)');
      // DuPont: bloco presente; onde há os 3 fatores + ROE do pipeline, a reconstrução deve ser majoritariamente consistente
      assertLog(Array.isArray(sheet.dupont) && sheet.dupont.length > 0, 'bloco dupont presente e não vazio');
      const checaveis = sheet.dupont.filter((d) => d.consistente !== null);
      if (checaveis.length > 0) {
        const okRate = checaveis.filter((d) => d.consistente).length / checaveis.length;
        assertLog(okRate >= 0.8, `identidade DuPont reconstrói ROE do pipeline na maioria dos períodos (${(okRate * 100).toFixed(0)}%)`);
      } else {
        console.log('ok: nenhum período DuPont checável neste ticker (sem os 3 fatores + ROE)');
      }
    }

    // --- smoke da comparação setorial ---
    assertLog(indicatorCatalog.length >= 5 && indicatorCatalog.some((i) => i.key === 'roe'), 'catálogo de indicadores comparáveis inclui ROE');
    const sectors = listSectors();
    assertLog(sectors.length > 0 && sectors[0].n >= sectors[sectors.length - 1].n, 'setores listados, ordenados por n desc');
    const bigSector = sectors[0].setor;
    const rk = sectorRanking(bigSector, 'roe');
    assertLog(rk.setor === bigSector && rk.indicator.key === 'roe', 'ranking do maior setor por ROE');
    assertLog(rk.period !== null && typeof rk.knowledgeDate === 'string', 'período PIT escolhido + carimbo');
    assertLog(rk.rows.length > 0, 'ranking retorna empresas do setor');
    const ranked = rk.rows.filter((r) => r.value !== null);
    assertLog(ranked.every((r, i) => r.rank === i + 1), 'rank 1..n atribuído aos valores não-nulos, nulos por último');
    assertLog(ranked.length < 2 || (ranked[0].value ?? 0) >= (ranked[1].value ?? 0), 'ROE (betterWhen higher) ordenado desc');
    assertLog(rk.stats.n === ranked.length && (rk.stats.median === null || Number.isFinite(rk.stats.median)), 'stats: n bate e mediana é número ou null');
    // dívida líq/EBITDA: menor é melhor → ordenado asc
    const rkDl = sectorRanking(bigSector, 'dividaLiquidaEbitda');
    const rankedDl = rkDl.rows.filter((r) => r.value !== null);
    assertLog(rankedDl.length < 2 || (rankedDl[0].value ?? 0) <= (rankedDl[1].value ?? 0), 'Dívida Líq./EBITDA (betterWhen lower) ordenado asc');
  } else {
    console.log('ok: smoke da ficha pulado (banco CVM ausente no ambiente)');
  }

  console.log('cvm-fundamentals: TODOS OS TESTES PASSARAM');
}
main();
