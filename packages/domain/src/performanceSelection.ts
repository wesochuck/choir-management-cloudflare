import { datePartInTimeZone, isValidTimeZone } from "./calendarTime";

export interface PerformanceSelectionCandidate {
  readonly id: string;
  readonly startsAt: string;
  readonly type: string;
}

interface TimedEvent<T extends PerformanceSelectionCandidate> {
  readonly event: T;
  readonly timestamp: number;
}

function timedEvent<T extends PerformanceSelectionCandidate>(
  event: T,
  timezone: string,
): (TimedEvent<T> & { readonly localDate: string }) | null {
  const timestamp = Date.parse(event.startsAt);
  if (!Number.isFinite(timestamp)) return null;

  try {
    return {
      event,
      localDate: datePartInTimeZone(new Date(timestamp), timezone),
      timestamp,
    };
  } catch {
    return null;
  }
}

function isPreferred<T extends PerformanceSelectionCandidate>(
  candidate: TimedEvent<T>,
  selected: TimedEvent<T> | null,
  latest: boolean,
): boolean {
  if (selected === null) return true;
  if (candidate.timestamp !== selected.timestamp) {
    return latest
      ? candidate.timestamp > selected.timestamp
      : candidate.timestamp < selected.timestamp;
  }
  return candidate.event.id < selected.event.id;
}

/**
 * Selects the closest Performance by Organization-local calendar day.
 * Performances on today's local date remain eligible even if their start time
 * has already passed. If none remain, the most recent past Performance wins.
 */
export function selectDefaultPerformance<T extends PerformanceSelectionCandidate>(
  events: readonly T[],
  now: Date,
  timezone: string,
): T | null {
  const nowTimestamp = now.getTime();
  if (!Number.isFinite(nowTimestamp) || !isValidTimeZone(timezone)) return null;

  let today: string;
  try {
    today = datePartInTimeZone(now, timezone);
  } catch {
    return null;
  }

  let earliestUpcoming: TimedEvent<T> | null = null;
  let latestPast: TimedEvent<T> | null = null;

  for (const event of events) {
    if (event.type !== "Performance") continue;
    const candidate = timedEvent(event, timezone);
    if (!candidate) continue;

    if (candidate.localDate >= today) {
      if (isPreferred(candidate, earliestUpcoming, false)) earliestUpcoming = candidate;
    } else if (isPreferred(candidate, latestPast, true)) {
      latestPast = candidate;
    }
  }

  return earliestUpcoming?.event ?? latestPast?.event ?? null;
}
