import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  advanceComplianceReminder,
  completeComplianceTaskInStore,
  findDueComplianceReminders,
  readNonprofitComplianceFromStore,
  setNonprofitEnabledInStore,
  updateComplianceTaskInStore,
} from "./complianceStore";
import {
  createContactTestAdapter,
  DEFAULT_CONTACT_TEST_ACTOR_ID,
  DEFAULT_CONTACT_TEST_ORG_ID,
} from "./contactTestkit";
import { organizationSchemaMigrations } from "./schema/migrations";

function setupTestDatabase(
  timezone = "America/New_York",
): ReturnType<typeof createContactTestAdapter> {
  const db = new DatabaseSync(":memory:");
  const adapter = createContactTestAdapter(db);
  for (const migration of organizationSchemaMigrations) {
    for (const statement of migration.statements) {
      adapter.storage.sql.exec(statement);
    }
  }
  adapter.storage.sql.exec(
    `INSERT INTO organization_metadata
      (organization_id, name, slug, timezone, created_at, updated_at)
     VALUES (?, 'Test Choir', 'test-choir', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    DEFAULT_CONTACT_TEST_ORG_ID,
    timezone,
  );
  return adapter;
}

const testActor = {
  actorUserId: DEFAULT_CONTACT_TEST_ACTOR_ID,
  organizationId: DEFAULT_CONTACT_TEST_ORG_ID,
  requestId: "req-test-123",
};

describe("Nonprofit Compliance Store", () => {
  it("defaults to disabled with no tasks seeded until enabled", () => {
    const { storage } = setupTestDatabase();
    const compliance = readNonprofitComplianceFromStore(storage);
    expect(compliance.enabled).toBe(false);
    expect(compliance.tasks).toHaveLength(0);
  });

  it("enabling seeds the three default obligations with correct recurrence and titles", () => {
    const { storage } = setupTestDatabase();
    const enabled = setNonprofitEnabledInStore(storage, testActor, true);
    expect(enabled.enabled).toBe(true);
    expect(enabled.tasks).toHaveLength(3);

    const irs = enabled.tasks.find((t) => t.kind === "irs_annual_return");
    expect(irs).toBeDefined();
    expect(irs?.title).toContain("IRS annual return");
    expect(irs?.recurrenceMonths).toBe(12);
    expect(irs?.applicable).toBe(true);
    expect(irs?.nextDueDate).toBeNull();
    expect(irs?.lastCompletedDate).toBeNull();

    const ohioAg = enabled.tasks.find((t) => t.kind === "ohio_ag_annual_report");
    expect(ohioAg).toBeDefined();
    expect(ohioAg?.recurrenceMonths).toBe(12);

    const ohioSos = enabled.tasks.find((t) => t.kind === "ohio_continued_existence");
    expect(ohioSos).toBeDefined();
    expect(ohioSos?.recurrenceMonths).toBe(60);
  });

  it("disabling pauses without deleting tasks or configuration", () => {
    const { storage } = setupTestDatabase();
    setNonprofitEnabledInStore(storage, testActor, true);
    const initial = readNonprofitComplianceFromStore(storage);
    const irsTaskId = initial.tasks.find((t) => t.kind === "irs_annual_return")?.id ?? "";

    updateComplianceTaskInStore(storage, testActor, irsTaskId, {
      nextDueDate: "2026-05-15",
    });

    const disabled = setNonprofitEnabledInStore(storage, testActor, false);
    expect(disabled.enabled).toBe(false);
    expect(disabled.tasks).toHaveLength(3);
    const taskAfterDisable = disabled.tasks.find((t) => t.id === irsTaskId);
    expect(taskAfterDisable?.nextDueDate).toBe("2026-05-15");

    const reEnabled = setNonprofitEnabledInStore(storage, testActor, true);
    expect(reEnabled.enabled).toBe(true);
    expect(reEnabled.tasks).toHaveLength(3);
    const taskAfterReEnable = reEnabled.tasks.find((t) => t.id === irsTaskId);
    expect(taskAfterReEnable?.nextDueDate).toBe("2026-05-15");
  });

  it("updates task next due date, recurrence, and applicability", () => {
    const { storage } = setupTestDatabase();
    setNonprofitEnabledInStore(storage, testActor, true);
    const initial = readNonprofitComplianceFromStore(storage);
    const task = initial.tasks[0];
    expect(task).toBeDefined();
    if (!task) return;

    const updated = updateComplianceTaskInStore(storage, testActor, task.id, {
      applicable: false,
      nextDueDate: "2026-11-15",
      recurrenceMonths: 24,
    });
    expect(updated.ok).toBe(true);
    expect(updated.task?.applicable).toBe(false);
    expect(updated.task?.nextDueDate).toBe("2026-11-15");
    expect(updated.task?.recurrenceMonths).toBe(24);
  });

  it("completing a task late advances from prior cycle due date anchor without drift", () => {
    const { storage } = setupTestDatabase();
    setNonprofitEnabledInStore(storage, testActor, true);
    const initial = readNonprofitComplianceFromStore(storage);
    const irs = initial.tasks.find((t) => t.kind === "irs_annual_return");
    expect(irs).toBeDefined();
    if (!irs) return;

    updateComplianceTaskInStore(storage, testActor, irs.id, {
      nextDueDate: "2026-05-15",
    });

    // Completed 16 days late on 2026-05-31
    const completion = completeComplianceTaskInStore(
      storage,
      testActor,
      irs.id,
      "2026-05-31",
      new Date("2026-05-31T15:00:00Z"),
    );

    expect(completion.ok).toBe(true);
    expect(completion.task?.lastCompletedDate).toBe("2026-05-31");
    // Recurrence is 12 months from 2026-05-15 -> 2027-05-15 (NOT 2027-05-31)
    expect(completion.task?.nextDueDate).toBe("2027-05-15");
    expect(completion.task?.nextReminderAt).toBeNull();
    expect(completion.task?.lastCompletedByUserId).toBe(testActor.actorUserId);
    expect(
      readNonprofitComplianceFromStore(storage).tasks.find((task) => task.id === irs.id),
    ).toMatchObject({ lastCompletedByUserId: testActor.actorUserId });
  });

  it("reads the latest recorded completion actor with an indexed lookup", () => {
    const { storage } = setupTestDatabase();
    const task = setNonprofitEnabledInStore(storage, testActor, true).tasks[0];
    if (!task) throw new Error("Missing seeded task.");
    // Same recording timestamp: insertion order determines the latest completion,
    // rather than a backdated completion date or a random UUID.
    const now = new Date("2024-06-01T12:00:00Z");
    completeComplianceTaskInStore(storage, testActor, task.id, "2024-05-31", now);
    completeComplianceTaskInStore(
      storage,
      { ...testActor, actorUserId: "second-admin" },
      task.id,
      "2024-05-30",
      now,
    );
    expect(
      readNonprofitComplianceFromStore(storage).tasks.find(({ id }) => id === task.id),
    ).toMatchObject({ lastCompletedByUserId: "second-admin", lastCompletedDate: "2024-05-30" });
    const plan = storage.sql
      .exec<{ readonly detail: string }>(
        `EXPLAIN QUERY PLAN SELECT completed_by_user_id FROM organization_compliance_completions
       WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        task.id,
      )
      .toArray();
    expect(plan.map((row) => row.detail).join(" ")).toContain(
      "USING INDEX organization_compliance_completions_latest",
    );
    expect(plan.map((row) => row.detail).join(" ")).not.toContain("TEMP B-TREE");
  });

  it("starts reminders four weeks before the due date in the Organization timezone", () => {
    // Organization in America/New_York (UTC-4 in summer)
    const { storage } = setupTestDatabase("America/New_York");
    setNonprofitEnabledInStore(storage, testActor, true);
    const initial = readNonprofitComplianceFromStore(storage);
    const irs = initial.tasks.find((t) => t.kind === "irs_annual_return");
    expect(irs).toBeDefined();
    if (!irs) return;

    updateComplianceTaskInStore(storage, testActor, irs.id, {
      nextDueDate: "2026-05-15",
    });

    // The reminder window starts April 17, exactly 28 days before May 15.
    const beforeDueInNy = new Date("2026-04-17T03:59:59Z"); // April 16 in New York
    expect(findDueComplianceReminders(storage, beforeDueInNy)).toHaveLength(0);

    const onDueInNy = new Date("2026-04-17T04:00:00Z"); // Midnight April 17 EDT
    const due = findDueComplianceReminders(storage, onDueInNy);
    expect(due).toHaveLength(1);
    expect(due[0]?.task.kind).toBe("irs_annual_return");
    expect(due[0]?.cycleDueDate).toBe("2026-05-15");
    expect(due[0]?.occurrenceDate).toBe("2026-04-17");

    // Advancing reminder by 7 days
    advanceComplianceReminder(storage, irs.id, null, onDueInNy.toISOString());
    // Immediately after advancing, reminder is no longer due
    expect(findDueComplianceReminders(storage, onDueInNy)).toHaveLength(0);

    // 6 days later: still not due
    const sixDaysLater = new Date(onDueInNy.getTime() + 6 * 24 * 60 * 60 * 1000);
    expect(findDueComplianceReminders(storage, sixDaysLater)).toHaveLength(0);

    // 7 days later: due again
    const sevenDaysLater = new Date(onDueInNy.getTime() + 7 * 24 * 60 * 60 * 1000 + 1000);
    const secondOccurrence = findDueComplianceReminders(storage, sevenDaysLater);
    expect(secondOccurrence).toHaveLength(1);

    completeComplianceTaskInStore(storage, testActor, irs.id, "2026-04-24", sevenDaysLater);
    expect(findDueComplianceReminders(storage, sevenDaysLater)).toHaveLength(0);
  });

  it("stopped reminders when disabled or made not applicable", () => {
    const { storage } = setupTestDatabase();
    setNonprofitEnabledInStore(storage, testActor, true);
    const initial = readNonprofitComplianceFromStore(storage);
    const irs = initial.tasks.find((t) => t.kind === "irs_annual_return");
    expect(irs).toBeDefined();
    if (!irs) return;

    updateComplianceTaskInStore(storage, testActor, irs.id, {
      nextDueDate: "2026-05-15",
    });

    const now = new Date("2026-05-16T12:00:00Z");
    expect(findDueComplianceReminders(storage, now)).toHaveLength(1);

    // Mark not applicable
    updateComplianceTaskInStore(storage, testActor, irs.id, { applicable: false });
    expect(findDueComplianceReminders(storage, now)).toHaveLength(0);

    // Re-enable applicable, then disable nonprofit tracking
    updateComplianceTaskInStore(storage, testActor, irs.id, { applicable: true });
    expect(findDueComplianceReminders(storage, now)).toHaveLength(1);

    setNonprofitEnabledInStore(storage, testActor, false);
    expect(findDueComplianceReminders(storage, now)).toHaveLength(0);
  });
});
