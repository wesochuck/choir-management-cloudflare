export interface DateOffsetOptions {
  readonly base?: Date | string | number;
  readonly days?: number;
  readonly hours?: number;
  readonly minutes?: number;
  readonly seconds?: number;
}

export function relativeDate(offset: DateOffsetOptions = {}): Date {
  const baseTime = offset.base !== undefined ? new Date(offset.base).getTime() : Date.now();
  const deltaMs =
    (offset.days ?? 0) * 86_400_000 +
    (offset.hours ?? 0) * 3_600_000 +
    (offset.minutes ?? 0) * 60_000 +
    (offset.seconds ?? 0) * 1_000;
  return new Date(baseTime + deltaMs);
}

export function relativeIsoDate(offset: DateOffsetOptions = {}): string {
  return relativeDate(offset).toISOString();
}

export function futureDate(offset: DateOffsetOptions = {}): Date {
  const days = offset.days ?? 30;
  return relativeDate({ ...offset, days: Math.abs(days) });
}

export function futureIsoDate(offset: DateOffsetOptions = {}): string {
  return futureDate(offset).toISOString();
}

export function futureDateString(offset: DateOffsetOptions = {}): string {
  return futureDate(offset).toISOString().slice(0, 10);
}

export function pastDate(offset: DateOffsetOptions = {}): Date {
  const days = offset.days ?? 30;
  return relativeDate({ ...offset, days: -Math.abs(days) });
}

export function pastIsoDate(offset: DateOffsetOptions = {}): string {
  return pastDate(offset).toISOString();
}

export function pastDateString(offset: DateOffsetOptions = {}): string {
  return pastDate(offset).toISOString().slice(0, 10);
}
