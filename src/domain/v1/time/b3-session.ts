import { compareInstants, parseInstant } from '../time';

/**
 * Adaptador único de sessão B3 D1 (Item A / D-session, espelho de
 * python/ml/b3_session.py — mesma constante, mesmo comentário de origem).
 *
 * Nenhuma hora fixa é afirmada como "sempre posterior a qualquer sessão
 * B3" sem fonte (correção da revisão 4 da spec do Item A). Se um
 * calendário real (versionado, com proveniência) tiver uma entrada para
 * o dia civil pedido, usa exatamente esse instante. Sem entrada, cai no
 * único limite que não depende de nenhum fato de mercado: o fim do
 * próprio dia civil em UTC.
 *
 * Todo lugar que rotula `BacktestBar.time`/`knowledgeTime` ou
 * `BacktestSignalInput.barTime`/`knowledgeTime` para uma barra/sinal D1 B3
 * DEVE chamar esta função — nunca uma constante paralela. O motor casa
 * sinal com barra por igualdade exata de string (`barIndexByTime`), então
 * normalizações divergentes fariam sinais deixarem de casar com suas
 * barras silenciosamente.
 */
export interface B3DailySessionCalendar {
  /** Instante de fechamento REGISTRADO para aquele dia civil, ou `null`
   *  se não há entrada de calendário conhecida (estado inicial desta
   *  v1.1: calendário vazio, ver `emptyB3SessionCalendar`). */
  closeInstantFor(tradingDayUtcMidnight: string): string | null;
}

/** Calendário vazio — estado inicial honesto desta v1.1 (desvio consciente 6). */
export function emptyB3SessionCalendar(): B3DailySessionCalendar {
  return { closeInstantFor: () => null };
}

/**
 * G-003 item 2: cada entrada é validada na construção do calendário — nunca
 * em uso posterior. Rejeita instante não-UTC (deve terminar em `Z`), fora do
 * dia civil da chave, ou anterior ao início (meia-noite UTC) da própria
 * barra que descreve.
 */
export function staticB3SessionCalendar(entries: Readonly<Record<string, string>>): B3DailySessionCalendar {
  const validated: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    validated[key] = validateCalendarEntry(key, value);
  }
  return { closeInstantFor: (day) => validated[day] ?? null };
}

function validateCalendarEntry(key: string, value: string): string {
  if (!/^Z$/.test(value.slice(-1))) {
    throw new Error(`entrada de calendário para '${key}' deve ser timezone-aware em UTC (sufixo 'Z'); recebido: ${value}`);
  }
  const entry = parseInstant(value);
  if (entry === null) throw new Error(`entrada de calendário para '${key}' inválida: ${value}`);
  const dayStart = parseInstant(`${key}T00:00:00.000Z`);
  if (dayStart === null) throw new Error(`chave de calendário inválida: ${key}`);
  const dayEnd = { milliseconds: dayStart.milliseconds + 86_400_000, micros: dayStart.micros };
  if (compareInstants(entry, dayStart) < 0) {
    throw new Error(`entrada de calendário para '${key}' é anterior ao início da barra (${key}T00:00:00.000Z); recebido: ${value}`);
  }
  if (compareInstants(entry, dayEnd) >= 0) {
    throw new Error(`entrada de calendário para '${key}' cai fora do dia civil da chave; recebido: ${value}`);
  }
  return value;
}

function civilDayKey(tradingDayUtcMidnight: string): string {
  if (!/^Z$/.test(tradingDayUtcMidnight.slice(-1))) {
    throw new Error(`tradingDayUtcMidnight deve ser timezone-aware em UTC (sufixo 'Z'); recebido: ${tradingDayUtcMidnight}`);
  }
  const instant = parseInstant(tradingDayUtcMidnight);
  if (instant === null) throw new Error(`tradingDayUtcMidnight inválido: ${tradingDayUtcMidnight}`);
  const key = new Date(instant.milliseconds).toISOString().slice(0, 10);
  const dayStart = parseInstant(`${key}T00:00:00.000Z`);
  if (dayStart?.milliseconds !== instant.milliseconds || instant.micros !== 0) {
    throw new Error(`tradingDayUtcMidnight deve ser exatamente meia-noite UTC (início do dia civil, sem fração sub-milissegundo); recebido: ${tradingDayUtcMidnight}`);
  }
  return key;
}

/** 23:59:59.999 UTC do mesmo dia civil — o único "posterior garantido" que
 *  não depende de nenhum fato de calendário de mercado. */
export function endOfUtcCivilDay(tradingDayUtcMidnight: string): string {
  const key = civilDayKey(tradingDayUtcMidnight);
  return `${key}T23:59:59.999Z`;
}

/**
 * Instante conservador em que o OHLC de um pregão D1 B3 pode ser
 * considerado conhecido.
 *
 * - Calendário com entrada real para o dia -> usa exatamente esse instante.
 * - Sem entrada -> fallback fail-safe: fim do dia civil (D-session,
 *   revisão 4). NUNCA retorna um instante anterior ao início do dia civil
 *   da barra — isso seria antecipar `knowledgeTime`.
 */
export function b3DailyCloseKnowledgeInstant(
  tradingDayUtcMidnight: string,
  calendar: B3DailySessionCalendar = emptyB3SessionCalendar(),
): string {
  const known = calendar.closeInstantFor(civilDayKey(tradingDayUtcMidnight));
  return known ?? endOfUtcCivilDay(tradingDayUtcMidnight);
}
