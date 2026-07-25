import assert from 'node:assert/strict';
import { cashConversion, knowledgeDateFor, LEGAL_LAG_RULE } from '../../src/lib/server/cvm-fundamentals-derive';

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

  console.log('cvm-fundamentals: TODOS OS TESTES PASSARAM');
}
main();
