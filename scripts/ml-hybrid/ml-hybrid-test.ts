import { evaluateGate, type TrainingBlock } from '../../src/application/ml-hybrid/gate';

function block(i: number, nHits: { model: number; base: number }, n = 10): TrainingBlock {
  return { block: `T${i % 7}:2024-${(i % 12) + 1}`, n, hitsModel: nHits.model,
    hitsAlwaysUp: nHits.base, hitsTimesfm: nHits.base,
    hitsFundamental: nHits.base, hitsPriceOnly: nHits.base };
}
function assert(cond: unknown, msg: string): void {
  if (!cond) { console.error(`FALHOU: ${msg}`); process.exit(1); }
  console.log(`ok: ${msg}`);
}

// modelo claramente melhor (8/10 vs 5/10 em 80 blocos) → aprovado
const strong = Array.from({ length: 80 }, (_, i) => block(i, { model: 8, base: 5 }));
const g1 = evaluateGate(strong);
assert(g1.approved, 'gate aprova modelo consistentemente superior');
assert(g1.comparisons.length === 4 && g1.comparisons.every((c) => c.passed), '4 comparações, todas passam');

// diferença nula → reprovado
const flat = Array.from({ length: 80 }, (_, i) => block(i, { model: 6, base: 6 }));
assert(!evaluateGate(flat).approved, 'gate reprova diferença nula');

// determinismo: mesma seed → mesmo resultado
const a = evaluateGate(strong, { seed: 42 });
const b = evaluateGate(strong, { seed: 42 });
assert(JSON.stringify(a) === JSON.stringify(b), 'bootstrap determinístico com seed fixa');

console.log('ml-hybrid gate: TODOS OS TESTES PASSARAM');
