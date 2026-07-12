import { z } from "zod";

export const SCHEMA_VERSION_V1 = "1.0.0" as const;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;

const isLeapYear = (year: number) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

interface TimestampInstant {
  readonly epochMilliseconds: number;
  readonly subMillisecondMicros: number;
}

/** Validates v1 grammar/calendar and returns a lossless, ES2017-safe UTC key. */
const parseTimestampInstant = (value: string): TimestampInstant | null => {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone, sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const monthDays = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > monthDays[month - 1]) return null;
  let offsetMinutes = 0;
  if (zone !== "Z") {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
    offsetMinutes = (sign === "+" ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  }
  const paddedFraction = (fraction + "000000").slice(0, 6);
  const milliseconds = Number(paddedFraction.slice(0, 3));
  const subMillisecondMicros = Number(paddedFraction.slice(3, 6));
  // setUTCFullYear avoids Date.UTC's special 1900 mapping for years 0001..0099.
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, second, milliseconds);
  return {
    epochMilliseconds: utc.valueOf() - offsetMinutes * 60_000,
    subMillisecondMicros,
  };
};

const isStrictlyAfter = (later: string, earlier: string): boolean => {
  const laterInstant = parseTimestampInstant(later);
  const earlierInstant = parseTimestampInstant(earlier);
  if (!laterInstant || !earlierInstant) return false;
  return laterInstant.epochMilliseconds > earlierInstant.epochMilliseconds
    || (laterInstant.epochMilliseconds === earlierInstant.epochMilliseconds
      && laterInstant.subMillisecondMicros > earlierInstant.subMillisecondMicros);
};

const id = z.string().min(1).max(128).regex(ID_PATTERN);
const text = z.string().min(1).max(1000);
const timestamp = z.string().max(40).regex(TIMESTAMP_PATTERN).refine(
  (value) => parseTimestampInstant(value) !== null,
  "timestamp ISO inválido: use ano 0001-9999, calendário real, hora válida e offset até ±14:00",
);
const symbol = z.string().min(1).max(32).regex(SYMBOL_PATTERN);
const finitePositive = z.number().finite().positive().max(1_000_000_000);
const price = z.number().finite().positive().max(1_000_000_000);
const side = z.enum(["BUY", "SELL"]);
const decision = z.enum(["BUY", "SELL", "HOLD", "NO_DECISION"]);
const orderType = z.enum(["MARKET", "LIMIT"]);
const nullablePrice = price.nullable();

const envelope = {
  schemaVersion: z.literal(SCHEMA_VERSION_V1),
  id,
  createdAt: timestamp,
  executionEligible: z.literal(false),
};

const TradingSignalV1BaseSchema = z.object({
  ...envelope,
  kind: z.literal("trading.signal"),
  instrument: symbol,
  timeframe: z.enum(["M1", "M5", "M15", "M30", "H1", "H4", "D1"]),
  decision,
  confidence: z.number().finite().min(0).max(1),
  rationale: text,
  tags: z.array(z.string().min(1).max(32)).max(16),
  validUntil: timestamp.nullable(),
}).strict();

export const TradingSignalV1Schema = TradingSignalV1BaseSchema.superRefine((value, context) => {
  if (value.validUntil !== null && !isStrictlyAfter(value.validUntil, value.createdAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["validUntil"], message: "validUntil deve ser estritamente posterior a createdAt em UTC" });
  }
});

const TradeProposalV1BaseSchema = z.object({
  ...envelope,
  kind: z.literal("trade.proposal"),
  signalId: id,
  instrument: symbol,
  side,
  orderType,
  quantity: finitePositive,
  limitPrice: nullablePrice,
  stopLoss: nullablePrice,
  takeProfit: nullablePrice,
  rationale: text,
  expiresAt: timestamp,
}).strict();

export const TradeProposalV1Schema = TradeProposalV1BaseSchema.superRefine((value, context) => {
  const needsLimit = value.orderType === "LIMIT";
  if (needsLimit !== (value.limitPrice !== null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["limitPrice"], message: needsLimit ? "LIMIT exige limitPrice" : "MARKET proíbe limitPrice" });
  if (!isStrictlyAfter(value.expiresAt, value.createdAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "expiresAt deve ser estritamente posterior a createdAt em UTC" });
});

const OrderDraftV1BaseSchema = z.object({
  ...envelope,
  kind: z.literal("order.draft"),
  proposalId: id,
  accountId: id,
  instrument: symbol,
  side,
  orderType,
  quantity: finitePositive,
  limitPrice: nullablePrice,
  stopLoss: nullablePrice,
  takeProfit: nullablePrice,
  state: z.literal("draft"),
  humanApproval: z.null(),
  idempotencyKey: z.null(),
}).strict();

export const OrderDraftV1Schema = OrderDraftV1BaseSchema.superRefine((value, context) => {
  const needsLimit = value.orderType === "LIMIT";
  if (needsLimit !== (value.limitPrice !== null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["limitPrice"], message: needsLimit ? "LIMIT exige limitPrice" : "MARKET proíbe limitPrice" });
});

export const WireContractV1Schema = z.discriminatedUnion("kind", [TradingSignalV1BaseSchema, TradeProposalV1BaseSchema, OrderDraftV1BaseSchema]).superRefine((value, context) => {
  if (value.kind === "trading.signal") {
    if (value.validUntil !== null && !isStrictlyAfter(value.validUntil, value.createdAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["validUntil"], message: "validUntil deve ser estritamente posterior a createdAt em UTC" });
    return;
  }
  const needsLimit = value.orderType === "LIMIT";
  if (needsLimit !== (value.limitPrice !== null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["limitPrice"], message: needsLimit ? "LIMIT exige limitPrice" : "MARKET proíbe limitPrice" });
  if (value.kind === "trade.proposal" && !isStrictlyAfter(value.expiresAt, value.createdAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "expiresAt deve ser estritamente posterior a createdAt em UTC" });
});

export type TradingSignalV1 = z.infer<typeof TradingSignalV1Schema>;
export type TradeProposalV1 = z.infer<typeof TradeProposalV1Schema>;
export type OrderDraftV1 = z.infer<typeof OrderDraftV1Schema>;
export type WireContractV1 = z.infer<typeof WireContractV1Schema>;
export const parseWireContractV1 = (input: unknown): WireContractV1 => WireContractV1Schema.parse(input);
