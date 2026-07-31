export interface DurationAutoFillState {
  readonly manuallyEdited: boolean;
  readonly runningMax: number | null;
  readonly tuttiLocked: boolean;
}

export interface DurationAutoFillDecision {
  readonly newDuration: string;
  readonly newState: DurationAutoFillState;
}

export const initialDurationAutoFillState: DurationAutoFillState = {
  manuallyEdited: false,
  runningMax: null,
  tuttiLocked: false,
};

export function formatDetectedDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(wholeSeconds / 60))}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

export function computeDurationAutoFillDecision(
  state: DurationAutoFillState,
  currentDuration: string,
  trackKey: string,
  durationSeconds: number,
): DurationAutoFillDecision | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || state.manuallyEdited) {
    return null;
  }

  const hasAutoFilled = state.runningMax !== null || state.tuttiLocked;
  if (currentDuration.trim() && !hasAutoFilled) return null;

  if (trackKey === "tutti") {
    return {
      newDuration: formatDetectedDuration(durationSeconds),
      newState: {
        manuallyEdited: false,
        runningMax: durationSeconds,
        tuttiLocked: true,
      },
    };
  }

  if (state.tuttiLocked) return null;

  const currentMax = state.runningMax ?? 0;
  if (durationSeconds <= currentMax) return null;
  return {
    newDuration: formatDetectedDuration(durationSeconds),
    newState: {
      manuallyEdited: false,
      runningMax: durationSeconds,
      tuttiLocked: false,
    },
  };
}

export function computeExpectedTrackDuration(
  trackDurations: Readonly<Record<string, number | null>>,
): number | null {
  const tuttiDuration = trackDurations.tutti;
  if (tuttiDuration !== undefined && tuttiDuration !== null) return tuttiDuration;
  const validDurations = Object.values(trackDurations).filter(
    (duration): duration is number => duration !== null,
  );
  return validDurations.length > 0 ? Math.max(...validDurations) : null;
}
