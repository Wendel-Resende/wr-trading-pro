import type { BacktestCostProfile } from '../../../../../domain/v1/models/backtest-cost-profile';
import { redactUnsafeText } from '../../_shared/sanitize-text';

/**
 * Revisão final (2026-07-21): `source` é texto livre persistido pelo
 * cadastro admin de `BacktestCostProfile` — pode conter path local, token,
 * URL interna ou qualquer outra coisa que o admin tenha colado ali. NUNCA é
 * devolvido bruto por esta rota. Em vez disso, `sourceSummary` é uma
 * representação segura e limitada:
 *   1. Se o valor bruto contiver qualquer indício de path (`/`, `\`, drive
 *      letter `X:\`, URL `http(s)://`) OU um trecho contíguo longo
 *      (>=24 chars) de caracteres típicos de token/hash/base64
 *      (letras/dígitos/`+`/`/`/`=` sem espaço nem hífen), a resposta é uma
 *      mensagem neutra fixa — nunca o valor original, nem parcial.
 *   2. Caso contrário, filtra para um allowlist rígido de caracteres
 *      (letras/dígitos/espaço/`.,-_():`), colapsa espaços e trunca em
 *      `SOURCE_SUMMARY_MAX_LENGTH` caracteres.
 * Isso ainda satisfaz a exigência de transparência de custo (bloqueador 5
 * da revisão anterior — "mostrar ... fonte") sem nunca vazar path/token.
 */
export interface CostProfilePublicDTO {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly fixedBrokerage: number;
  readonly emolumentsPct: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
  readonly lotSize: number;
  readonly sourceSummary: string;
}

const SOURCE_SUMMARY_MAX_LENGTH = 60;
const REDACTED_SOURCE_SUMMARY = 'proveniência não exibível (formato restrito)';

export function toSourceSummary(rawSource: string): string {
  return redactUnsafeText(rawSource, SOURCE_SUMMARY_MAX_LENGTH, REDACTED_SOURCE_SUMMARY);
}

export function toCostProfilePublicDTO(p: BacktestCostProfile): CostProfilePublicDTO {
  return {
    id: p.id,
    version: p.version,
    label: p.label,
    fixedBrokerage: p.fixedBrokerage,
    emolumentsPct: p.emolumentsPct,
    spreadBps: p.spreadBps,
    slippageBps: p.slippageBps,
    lotSize: p.lotSize,
    sourceSummary: toSourceSummary(p.source),
  };
}
