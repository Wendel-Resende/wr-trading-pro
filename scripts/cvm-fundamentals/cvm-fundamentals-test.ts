import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cashConversion, knowledgeDateFor, LEGAL_LAG_RULE } from '../../src/lib/server/cvm-fundamentals-derive';
import { buildFundamentalSheet } from '../../src/lib/server/cvm-fundamentals-sheet';
import { listCompanies } from '../../src/lib/server/cvm-legacy-db';

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
    }
  } else {
    console.log('ok: smoke da ficha pulado (banco CVM ausente no ambiente)');
  }

  console.log('cvm-fundamentals: TODOS OS TESTES PASSARAM');
}
main();
