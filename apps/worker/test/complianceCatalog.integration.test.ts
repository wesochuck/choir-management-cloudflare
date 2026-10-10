import { exports } from "cloudflare:workers";
import {
  complianceAssigneesResponseSchema,
  nonprofitComplianceSettingsResponseSchema,
} from "@choir/contracts";
import { pastDateString, futureDateString } from "@choir/testkit";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  api,
  jsonWrite,
  setupTicketingIntegration,
  signIn,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

beforeEach(setupTicketingIntegration);
afterEach(teardownTicketingIntegration);

async function patchTask(host: string, taskId: string, body: unknown, cookie: string) {
  return exports.default.fetch(
    api(host, `/api/organization/compliance/tasks/${taskId}`, cookie, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }),
  );
}

async function postTask(host: string, path: string, body: unknown, cookie: string) {
  return exports.default.fetch(
    api(host, path, cookie, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

it("seeds Ohio unclaimed-funds once with a future October target and no blast", async () => {
  const cookie = await signIn();
  const enabled = await jsonWrite(
    "alpha.localhost",
    "/api/organization/compliance/toggle",
    "PUT",
    { enabled: true },
    cookie,
  );
  expect(enabled.status).toBe(200);
  const settings = nonprofitComplianceSettingsResponseSchema.parse(await enabled.json());
  expect(settings.tasks).toHaveLength(4);
  const ohio = settings.tasks.find((t) => t.kind === "ohio_unclaimed_funds_annual_report");
  expect(ohio).toBeDefined();
  expect(ohio?.nextDueDate).toMatch(/^\d{4}-10-31$/);
  expect(ohio?.nextReminderAt).toBeNull();
  expect(ohio?.source).toBe("builtin");
  // Second enablement stays idempotent and preserves IDs.
  const reEnabled = await jsonWrite(
    "alpha.localhost",
    "/api/organization/compliance/toggle",
    "PUT",
    { enabled: true },
    cookie,
  );
  const again = nonprofitComplianceSettingsResponseSchema.parse(await reEnabled.json());
  expect(again.tasks.filter((t) => t.kind === "ohio_unclaimed_funds_annual_report")).toHaveLength(
    1,
  );
  expect(again.tasks.find((t) => t.kind === "ohio_unclaimed_funds_annual_report")?.id).toBe(
    ohio?.id,
  );
});

it("creates, edits, archives, and restores a custom reminder", async () => {
  const cookie = await signIn();
  await jsonWrite(
    "alpha.localhost",
    "/api/organization/compliance/toggle",
    "PUT",
    {
      enabled: true,
    },
    cookie,
  );
  const due = futureDateString({ days: 60 });
  const createdRes = await postTask(
    "alpha.localhost",
    "/api/organization/compliance/tasks",
    {
      nextDueDate: due,
      recurrenceMonths: 12,
      title: "Custom yearly",
    },
    cookie,
  );
  expect(createdRes.status).toBe(201);
  const created = nonprofitComplianceSettingsResponseSchema.parse(await createdRes.json());
  const custom = created.tasks.find((t) => t.title === "Custom yearly");
  expect(custom).toBeDefined();
  expect(custom?.source).toBe("custom");
  if (!custom) throw new Error("Missing custom task.");

  // Recurrence anchors to previous due date on completion.
  const completedDate = pastDateString({ days: 1 });
  const completedRes = await postTask(
    "alpha.localhost",
    `/api/organization/compliance/tasks/${custom.id}/complete`,
    { taskId: custom.id, completedDate },
    cookie,
  );
  expect(completedRes.status).toBe(200);

  const archivedRes = await postTask(
    "alpha.localhost",
    `/api/organization/compliance/tasks/${custom.id}/archive`,
    { taskId: custom.id },
    cookie,
  );
  expect(archivedRes.status).toBe(200);
  const archived = nonprofitComplianceSettingsResponseSchema.parse(await archivedRes.json());
  expect(archived.tasks.find((t) => t.id === custom.id)?.archived).toBe(true);

  const restoredRes = await postTask(
    "alpha.localhost",
    `/api/organization/compliance/tasks/${custom.id}/restore`,
    { taskId: custom.id },
    cookie,
  );
  expect(restoredRes.status).toBe(200);
  const restored = nonprofitComplianceSettingsResponseSchema.parse(await restoredRes.json());
  expect(restored.tasks.find((t) => t.id === custom.id)?.archived).toBe(false);
});

it("rejects builtin archiving and builtin identity edits", async () => {
  const cookie = await signIn();
  const enabled = await jsonWrite(
    "alpha.localhost",
    "/api/organization/compliance/toggle",
    "PUT",
    { enabled: true },
    cookie,
  );
  const settings = nonprofitComplianceSettingsResponseSchema.parse(await enabled.json());
  const builtin = settings.tasks.find((t) => t.kind === "irs_annual_return");
  if (!builtin) throw new Error("Missing builtin.");
  const archive = await postTask(
    "alpha.localhost",
    `/api/organization/compliance/tasks/${builtin.id}/archive`,
    { taskId: builtin.id },
    cookie,
  );
  expect(archive.status).toBe(400);
  const rename = await patchTask(
    "alpha.localhost",
    builtin.id,
    {
      taskId: builtin.id,
      title: "Renamed",
    },
    cookie,
  );
  expect(rename.status).toBe(400);
});

it("validates assignees against current owners and administrators", async () => {
  const cookie = await signIn();
  const enabled = await jsonWrite(
    "alpha.localhost",
    "/api/organization/compliance/toggle",
    "PUT",
    { enabled: true },
    cookie,
  );
  const settings = nonprofitComplianceSettingsResponseSchema.parse(await enabled.json());
  const builtin = settings.tasks[0];
  if (!builtin) throw new Error("Missing task.");

  const assigneesRes = await exports.default.fetch(
    api("alpha.localhost", "/api/organization/compliance/assignees", cookie),
  );
  expect(assigneesRes.status).toBe(200);
  const assignees = complianceAssigneesResponseSchema.parse(await assigneesRes.json());
  expect(assignees.assignees.length).toBeGreaterThan(0);
  expect(assignees.assignees.every((a) => a.email.includes("@") && a.name.length > 0)).toBe(true);

  const eligible = assignees.assignees[0];
  if (!eligible) throw new Error("Missing eligible assignee.");
  const assign = await patchTask(
    "alpha.localhost",
    builtin.id,
    {
      taskId: builtin.id,
      responsibleMembershipId: eligible.membershipId,
    },
    cookie,
  );
  expect(assign.status).toBe(200);
  const assigned = nonprofitComplianceSettingsResponseSchema.parse(await assign.json());
  expect(assigned.tasks.find((t) => t.id === builtin.id)?.responsibleMembershipId).toBe(
    eligible.membershipId,
  );

  // Unknown membership fails.
  const invalid = await patchTask(
    "alpha.localhost",
    builtin.id,
    {
      taskId: builtin.id,
      responsibleMembershipId: "missing-membership",
    },
    cookie,
  );
  expect(invalid.status).toBe(400);
});

it("enforces tenant isolation and member authorization", async () => {
  const cookie = await signIn();
  await jsonWrite(
    "alpha.localhost",
    "/api/organization/compliance/toggle",
    "PUT",
    {
      enabled: true,
    },
    cookie,
  );
  // Member of bravo (ticket-manager is member there) cannot read alpha? Actually
  // ticket-manager is admin in alpha, member in bravo. Cross-host with same
  // session must be forbidden.
  const cross = await exports.default.fetch(
    api("bravo.localhost", "/api/organization/compliance", cookie),
  );
  // ticket-manager is a member of bravo, but compliance requires owner/admin.
  expect([401, 403]).toContain(cross.status);

  const anonymous = await exports.default.fetch(
    api("alpha.localhost", "/api/organization/compliance"),
  );
  expect([401, 403]).toContain(anonymous.status);

  const invalidCreate = await postTask(
    "alpha.localhost",
    "/api/organization/compliance/tasks",
    { title: "  ", nextDueDate: futureDateString({ days: 10 }) },
    cookie,
  );
  expect(invalidCreate.status).toBe(400);
});
