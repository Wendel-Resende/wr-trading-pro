import { z } from 'zod';
import type { ModelVersionReadModelV1 } from '../../../../../application/model-version/dto';
import { isTrainingEvidenceApproved } from '../../../../../application/ml-hybrid/service';
import { redactUnsafeText } from '../../_shared/sanitize-text';

/**
 * Achado alto 6 (auditoria final do Guardião, 2026-07-22): endurecer os
 * campos do DTO que carregam texto do motor Python — mesmo vindo de um
 * fluxo interno (nunca do usuário final), path/token não pode "deslocar"
 * para um campo permitido só porque o shape geral bateu com o Zod.
 * `HEX_DIGEST_RE` valida hash sha256 (64 hex); nomes de baseline usam
 * allowlist fechada (só os quatro conhecidos pelo gate — Task 8);
 * `timesfmVersion` passa por `redactUnsafeText` como qualquer outro texto
 * de proveniência externa.
 */
const HEX_DIGEST_RE = /^[a-f0-9]{64}$/i;
const KNOWN_BASELINE_NAMES = new Set(['alwaysUp', 'timesfmOnly', 'fundamentalOnly', 'priceOnlyLgbm']);

function toSafeDigest(raw: string): string | null {
  return HEX_DIGEST_RE.test(raw) ? raw.toLowerCase() : null;
}

/**
 * Bloqueador 1 (revisão final do Guardião, 2026-07-22): a aba pública de ML
 * não pode consumir `GET /api/v1/model-versions`, que devolve
 * `hyperparametersJson`/`trainingEvidenceJson` brutos — e `trainingEvidenceJson`
 * carrega `artifact.path`, um caminho local. Este DTO expõe somente um
 * resumo derivado e validado por Zod da evidência de treino: nunca o JSON
 * bruto, nunca `artifact.path`, nunca `backtestProxy` (campo livre não
 * necessário à UI).
 */
const GateComparisonSchema = z
  .object({
    baseline: z.string().max(100),
    accuracyDiff: z.number().finite(),
    ciLower: z.number().finite(),
    passed: z.boolean(),
  })
  .passthrough();

const TrainingEvidenceSchema = z
  .object({
    aggregate: z.object({ nSamples: z.number().finite(), accuracy: z.number().finite() }).passthrough(),
    baselines: z
      .object({
        alwaysUp: z.object({ accuracy: z.number().finite() }).passthrough(),
        timesfmOnly: z.object({ accuracy: z.number().finite() }).passthrough(),
        fundamentalOnly: z.object({ accuracy: z.number().finite() }).passthrough(),
        priceOnlyLgbm: z.object({ accuracy: z.number().finite() }).passthrough(),
      })
      .passthrough(),
    gate: z
      .object({
        approved: z.boolean(),
        comparisons: z.array(GateComparisonSchema).max(50),
      })
      .passthrough(),
    artifact: z.object({ hash: z.string().max(200) }).passthrough(),
    datasetHash: z.string().max(200),
    timesfmVersion: z.string().max(200).nullish(),
    windowStart: z.string().max(64),
    windowEnd: z.string().max(64),
  })
  .passthrough();

export interface GateComparisonPublicDTO {
  readonly baseline: string;
  readonly accuracyDiff: number;
  readonly ciLower: number;
  readonly passed: boolean;
}

export interface TrainingEvidenceSummaryPublicDTO {
  readonly nSamples: number;
  readonly accuracy: number;
  readonly baselines: {
    readonly alwaysUp: number;
    readonly timesfmOnly: number;
    readonly fundamentalOnly: number;
    readonly priceOnlyLgbm: number;
  };
  readonly gateApproved: boolean;
  readonly gateComparisons: readonly GateComparisonPublicDTO[];
  readonly datasetHash: string;
  readonly artifactHash: string;
  readonly timesfmVersion: string | null;
  readonly windowStart: string;
  readonly windowEnd: string;
}

export interface ModelVersionPublicDTO {
  readonly modelVersion: string;
  readonly kind: string;
  readonly label: string;
  readonly asOf: string;
  readonly invalidatedAt: string | null;
  readonly createdAt: string;
  readonly gateApproved: boolean;
  readonly evidence: TrainingEvidenceSummaryPublicDTO | null;
}

/** Parse estrito e seguro — qualquer shape inesperado vira `null` (nunca lança, nunca vaza o JSON bruto). */
function toEvidenceSummary(trainingEvidenceJson: string | null): TrainingEvidenceSummaryPublicDTO | null {
  if (!trainingEvidenceJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trainingEvidenceJson);
  } catch {
    return null;
  }
  const result = TrainingEvidenceSchema.safeParse(parsed);
  if (!result.success) return null;
  const evidence = result.data;

  // Achado alto 6: digests precisam bater com o formato sha256 hex (64
  // caracteres) — qualquer outra coisa (path, token deslocado para este
  // campo por engano/adulteração) reprova a evidência inteira em vez de
  // vazar o valor bruto.
  const datasetHash = toSafeDigest(evidence.datasetHash);
  const artifactHash = toSafeDigest(evidence.artifact.hash);
  if (datasetHash === null || artifactHash === null) return null;

  // Nomes de baseline fora do allowlist fechado (Task 8: só 4 conhecidos)
  // são descartados da comparação exibida, nunca repassados como texto livre.
  const gateComparisons = evidence.gate.comparisons
    .filter((c) => KNOWN_BASELINE_NAMES.has(c.baseline))
    .map((c) => ({
      baseline: c.baseline,
      accuracyDiff: c.accuracyDiff,
      ciLower: c.ciLower,
      passed: c.passed,
    }));

  return {
    nSamples: evidence.aggregate.nSamples,
    accuracy: evidence.aggregate.accuracy,
    baselines: {
      alwaysUp: evidence.baselines.alwaysUp.accuracy,
      timesfmOnly: evidence.baselines.timesfmOnly.accuracy,
      fundamentalOnly: evidence.baselines.fundamentalOnly.accuracy,
      priceOnlyLgbm: evidence.baselines.priceOnlyLgbm.accuracy,
    },
    gateApproved: evidence.gate.approved,
    gateComparisons,
    datasetHash,
    artifactHash,
    timesfmVersion: evidence.timesfmVersion ? redactUnsafeText(evidence.timesfmVersion, 40, 'não disponível') : null,
    windowStart: evidence.windowStart,
    windowEnd: evidence.windowEnd,
  };
}

export function toModelVersionPublicDTO(v: ModelVersionReadModelV1): ModelVersionPublicDTO {
  return {
    modelVersion: v.modelVersion,
    kind: v.kind,
    label: v.label,
    asOf: v.asOf,
    invalidatedAt: v.invalidatedAt,
    createdAt: v.createdAt,
    gateApproved: isTrainingEvidenceApproved(v.trainingEvidenceJson),
    evidence: toEvidenceSummary(v.trainingEvidenceJson),
  };
}
