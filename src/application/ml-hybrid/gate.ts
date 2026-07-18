/**
 * Gate de promoção do ML Híbrido (spec 2026-07-18): o modelo só vira
 * ModelVersion se superar CADA baseline com IC 95% por bootstrap em blocos
 * ticker-mês. Determinístico (mulberry32, seed fixa) — testável e auditável.
 */
export interface TrainingBlock {
  readonly block: string; readonly n: number; readonly hitsModel: number;
  readonly hitsAlwaysUp: number; readonly hitsTimesfm: number;
  readonly hitsFundamental: number; readonly hitsPriceOnly: number;
}
export interface GateComparison {
  readonly baseline: 'alwaysUp' | 'timesfmOnly' | 'fundamentalOnly' | 'priceOnlyLgbm';
  readonly accuracyDiff: number; readonly ciLower: number; readonly passed: boolean;
}
export interface GateResult { readonly approved: boolean; readonly comparisons: readonly GateComparison[]; }

const BASELINE_HITS: Record<GateComparison['baseline'], keyof TrainingBlock> = {
  alwaysUp: 'hitsAlwaysUp', timesfmOnly: 'hitsTimesfm',
  fundamentalOnly: 'hitsFundamental', priceOnlyLgbm: 'hitsPriceOnly',
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function evaluateGate(
  blocks: readonly TrainingBlock[],
  opts?: { resamples?: number; seed?: number },
): GateResult {
  const resamples = opts?.resamples ?? 1000;
  const seed = opts?.seed ?? 42;
  if (blocks.length < 10) {
    const comparisons = (Object.keys(BASELINE_HITS) as GateComparison['baseline'][])
      .map((baseline) => ({ baseline, accuracyDiff: 0, ciLower: -1, passed: false }));
    return { approved: false, comparisons };
  }
  const comparisons = (Object.keys(BASELINE_HITS) as GateComparison['baseline'][]).map((baseline) => {
    const hitsKey = BASELINE_HITS[baseline];
    const rand = mulberry32(seed);
    const diffs: number[] = [];
    for (let r = 0; r < resamples; r++) {
      let n = 0; let model = 0; let base = 0;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[Math.floor(rand() * blocks.length)];
        n += b.n; model += b.hitsModel; base += b[hitsKey] as number;
      }
      diffs.push(n === 0 ? 0 : (model - base) / n);
    }
    diffs.sort((x, y) => x - y);
    const totalN = blocks.reduce((s, b) => s + b.n, 0);
    const accuracyDiff = blocks.reduce((s, b) => s + b.hitsModel - (b[hitsKey] as number), 0) / totalN;
    const ciLower = diffs[Math.floor(resamples * 0.025)];
    return { baseline, accuracyDiff, ciLower, passed: ciLower > 0 };
  });
  return { approved: comparisons.every((c) => c.passed), comparisons };
}
