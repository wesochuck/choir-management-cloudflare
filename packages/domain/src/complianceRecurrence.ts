const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidDateOnlyString(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

function splitDateOnly(value: string): {
  readonly day: number;
  readonly month: number;
  readonly year: number;
} {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid YYYY-MM-DD date: ${value}.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Invalid YYYY-MM-DD date: ${value}.`);
  }
  return { day, month, year };
}

function formatDateOnly(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addMonthsToDateOnly(anchor: string, months: number): string {
  const { day, month, year } = splitDateOnly(anchor);
  const absoluteMonth = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = absoluteMonth - targetYear * 12 + 1;
  return formatDateOnly(
    targetYear,
    targetMonth,
    Math.min(day, daysInMonth(targetYear, targetMonth)),
  );
}

export function addDaysToDateOnly(date: string, days: number): string {
  const { day, month, year } = splitDateOnly(date);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000);
  return formatDateOnly(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function compareDateOnly(left: string, right: string): -1 | 0 | 1 {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function nextDueDateFromCompletion(priorDueDate: string, recurrenceMonths: number): string {
  return addMonthsToDateOnly(priorDueDate, recurrenceMonths);
}

export function addDaysToIsoDateTime(value: string, days: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid ISO date-time: ${value}.`);
  }
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString();
}
