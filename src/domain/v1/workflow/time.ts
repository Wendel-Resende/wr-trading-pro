const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;

export type Instant = Readonly<{ milliseconds: number; micros: number }>;

export const parseInstant = (value: string): Instant | null => {
  const match = TIMESTAMP.exec(value);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59) return null;
  let offset = 0;
  if (match[8] !== 'Z') {
    const offsetHour = Number(match[10]); const offsetMinute = Number(match[11]);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
    offset = (match[9] === '+' ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  }
  const fraction = ((match[7] ?? '') + '000000').slice(0, 6);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number(fraction.slice(0, 3)));
  return { milliseconds: date.valueOf() - offset * 60_000, micros: Number(fraction.slice(3, 6)) };
};

export const compareInstants = (left: Instant, right: Instant): number =>
  left.milliseconds === right.milliseconds ? left.micros - right.micros : left.milliseconds - right.milliseconds;

export const isStrictlyAfter = (later: string, earlier: string): boolean => {
  const left = parseInstant(later); const right = parseInstant(earlier);
  return left !== null && right !== null && compareInstants(left, right) > 0;
};
