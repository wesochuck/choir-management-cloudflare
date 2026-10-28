import { describe, expect, it } from "vitest";

import {
  type AttendanceUndoEntry,
  attendanceActionLabel,
  MAX_UNDO_HISTORY,
  undoActionLabel,
  undoMessageText,
  undoReducer,
  type UndoState,
} from "./undoHistory";

function createEntry(overrides: Partial<AttendanceUndoEntry> = {}): AttendanceUndoEntry {
  return {
    actionSequence: 1,
    displayName: "Alex Singer",
    eventId: "11111111-1111-4111-8111-111111111111",
    expectedUpdatedAt: "2026-10-28T18:00:00.000Z",
    id: "entry-1",
    previousAttendance: "Pending",
    profileId: "profile-alex",
    resultingAttendance: "Present",
    ...overrides,
  };
}

describe("undoHistory", () => {
  describe("formatting", () => {
    it("formats action labels concisely", () => {
      expect(attendanceActionLabel("Present")).toBe("present");
      expect(attendanceActionLabel("Absent")).toBe("absent");
      expect(attendanceActionLabel("Pending")).toBe("unmarked");
    });

    it("formats message text and accessible action labels", () => {
      const entry = createEntry({ displayName: "Alex", resultingAttendance: "Present" });
      expect(undoMessageText(entry)).toBe("Alex marked present");
      expect(undoActionLabel(entry)).toBe("Undo: Alex marked present");
      expect(undoActionLabel(entry, true)).toBe("Retry undo: Alex marked present");
    });
  });

  describe("undoReducer", () => {
    it("sorts entries by actionSequence even when completed out of order", () => {
      const entry1 = createEntry({ actionSequence: 1, id: "1", profileId: "alex" });
      const entry2 = createEntry({ actionSequence: 2, id: "2", profileId: "bob" });

      // Entry 2 completes before Entry 1
      let state: UndoState = { entries: [] };
      state = undoReducer(state, { entry: entry2, type: "add" });
      expect(state.entries).toHaveLength(1);
      expect(state.entries[state.entries.length - 1]?.profileId).toBe("bob");

      // Entry 1 settles later
      state = undoReducer(state, { entry: entry1, type: "add" });
      expect(state.entries).toHaveLength(2);
      expect(state.entries[0]?.profileId).toBe("alex");
      expect(state.entries[1]?.profileId).toBe("bob");
      // Top is bob (actionSequence 2)
      expect(state.entries[state.entries.length - 1]?.profileId).toBe("bob");
    });

    it("caps history at MAX_UNDO_HISTORY (50) entries", () => {
      let state: UndoState = { entries: [] };
      for (let i = 1; i <= MAX_UNDO_HISTORY + 5; i++) {
        state = undoReducer(state, {
          entry: createEntry({
            actionSequence: i,
            id: `entry-${String(i)}`,
            profileId: `profile-${String(i)}`,
          }),
          type: "add",
        });
      }
      expect(state.entries).toHaveLength(MAX_UNDO_HISTORY);
      expect(state.entries[0]?.actionSequence).toBe(6);
      expect(state.entries[state.entries.length - 1]?.actionSequence).toBe(55);
    });

    it("removes the top entry and updates expectedUpdatedAt for older entries of the same performer", () => {
      const alexStep1 = createEntry({
        actionSequence: 1,
        expectedUpdatedAt: "2026-10-28T18:00:00Z",
        id: "alex-1",
        previousAttendance: "Pending",
        profileId: "alex",
        resultingAttendance: "Present",
      });
      const alexStep2 = createEntry({
        actionSequence: 2,
        expectedUpdatedAt: "2026-10-28T18:05:00Z",
        id: "alex-2",
        previousAttendance: "Present",
        profileId: "alex",
        resultingAttendance: "Absent",
      });

      let state: UndoState = { entries: [alexStep1, alexStep2] };

      // Undo step 2 (Absent -> Present) succeeds with new DB updatedAt
      state = undoReducer(state, {
        id: "alex-2",
        nextUpdatedAt: "2026-10-28T18:10:00Z",
        type: "remove",
      });

      expect(state.entries).toHaveLength(1);
      expect(state.entries[0]?.id).toBe("alex-1");
      expect(state.entries[0]?.expectedUpdatedAt).toBe("2026-10-28T18:10:00Z");
    });

    it("invalidates affected profiles on bulk/compound operations without affecting others", () => {
      const alex = createEntry({ actionSequence: 1, id: "alex-1", profileId: "alex" });
      const bob = createEntry({ actionSequence: 2, id: "bob-1", profileId: "bob" });
      const charlie = createEntry({ actionSequence: 3, id: "charlie-1", profileId: "charlie" });

      let state: UndoState = { entries: [alex, bob, charlie] };

      // Bulk action affects alex and charlie
      state = undoReducer(state, {
        profileIds: new Set(["alex", "charlie"]),
        type: "invalidateProfiles",
      });

      expect(state.entries).toHaveLength(1);
      expect(state.entries[0]?.profileId).toBe("bob");
    });

    it("clears all history", () => {
      const entry = createEntry();
      const state = undoReducer({ entries: [entry] }, { type: "clear" });
      expect(state.entries).toEqual([]);
    });
  });
});
