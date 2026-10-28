import type { OrganizationAttendanceStatus } from "@choir/contracts";

export interface AttendanceUndoEntry {
  readonly actionSequence: number;
  readonly displayName: string;
  readonly eventId: string;
  readonly expectedUpdatedAt: string | null;
  readonly id: string;
  readonly previousAttendance: OrganizationAttendanceStatus;
  readonly profileId: string;
  readonly resultingAttendance: OrganizationAttendanceStatus;
}

export const MAX_UNDO_HISTORY = 50;

export interface UndoState {
  readonly entries: readonly AttendanceUndoEntry[];
}

export type UndoAction =
  | { readonly type: "add"; readonly entry: AttendanceUndoEntry }
  | { readonly type: "remove"; readonly id: string; readonly nextUpdatedAt?: string | null }
  | { readonly type: "invalidateProfiles"; readonly profileIds: ReadonlySet<string> }
  | { readonly type: "clear" };

export function attendanceActionLabel(status: OrganizationAttendanceStatus): string {
  if (status === "Present") return "present";
  if (status === "Absent") return "absent";
  return "unmarked";
}

export function undoMessageText(entry: AttendanceUndoEntry): string {
  return `${entry.displayName} marked ${attendanceActionLabel(entry.resultingAttendance)}`;
}

export function undoActionLabel(entry: AttendanceUndoEntry, isRetry = false): string {
  const action = isRetry ? "Retry undo:" : "Undo:";
  return `${action} ${entry.displayName} marked ${attendanceActionLabel(entry.resultingAttendance)}`;
}

export function undoReducer(state: UndoState, action: UndoAction): UndoState {
  switch (action.type) {
    case "add": {
      // Keep sorted by actionSequence ascending so the latest user action is at the end (LIFO)
      const filtered = state.entries.filter((entry) => entry.id !== action.entry.id);
      const next = [...filtered, action.entry].sort((a, b) => a.actionSequence - b.actionSequence);
      return {
        entries: next.length > MAX_UNDO_HISTORY ? next.slice(next.length - MAX_UNDO_HISTORY) : next,
      };
    }
    case "remove": {
      const removed = state.entries.find((entry) => entry.id === action.id);
      const remaining = state.entries.filter((entry) => entry.id !== action.id);
      if (!removed || action.nextUpdatedAt === undefined) {
        return { entries: remaining };
      }
      // If the same performer has older entries in history, update their expectedUpdatedAt
      // to the newly restored row's updatedAt so subsequent undos match DB state.
      const updated = remaining.map((entry) => {
        if (entry.profileId === removed.profileId) {
          return { ...entry, expectedUpdatedAt: action.nextUpdatedAt ?? null };
        }
        return entry;
      });
      return { entries: updated };
    }
    case "invalidateProfiles": {
      return {
        entries: state.entries.filter((entry) => !action.profileIds.has(entry.profileId)),
      };
    }
    case "clear": {
      return { entries: [] };
    }
  }
}
