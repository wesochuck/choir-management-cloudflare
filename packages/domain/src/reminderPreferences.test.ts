import { describe, expect, it } from "vitest";

import { eventReminderPreferenceKind } from "./reminderPreferences";

describe("eventReminderPreferenceKind", () => {
  it("maps known types to their own preference", () => {
    expect(eventReminderPreferenceKind("Rehearsal")).toBe("rehearsal");
    expect(eventReminderPreferenceKind("Performance")).toBe("performance");
  });

  it("routes unknown and future types to the other-event preference", () => {
    expect(eventReminderPreferenceKind("Other Event")).toBe("otherEvent");
    expect(eventReminderPreferenceKind("")).toBe("otherEvent");
    expect(eventReminderPreferenceKind("Sectional")).toBe("otherEvent");
  });
});
