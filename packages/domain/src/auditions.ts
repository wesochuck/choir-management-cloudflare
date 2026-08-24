export interface AuditionSlotLike {
  readonly endsAt: string;
  readonly startsAt: string;
}

export interface AuditionSettingsLike {
  readonly enabled: boolean;
  readonly mode?: "audition" | "open_inquiry";
  readonly slots: readonly AuditionSlotLike[];
}

/**
 * Determines whether all configured audition slots have passed.
 * Audition dates are considered passed when:
 * 1. Intake mode is "audition" (or not specified / default)
 * 2. There is at least one slot configured and EVERY slot's end time (or start time) is at or before `now`.
 */
export function areAuditionDatesPassed(
  settings: AuditionSettingsLike,
  now: Date = new Date(),
): boolean {
  if (settings.mode === "open_inquiry") {
    return false;
  }
  if (settings.slots.length === 0) {
    return false;
  }
  const nowMs = now.getTime();

  return settings.slots.every((slot) => {
    const end = new Date(slot.endsAt);
    const endMs = Number.isNaN(end.getTime()) ? new Date(slot.startsAt).getTime() : end.getTime();
    return !Number.isNaN(endMs) && endMs <= nowMs;
  });
}
