import { exports } from "cloudflare:workers";
import { nonprofitComplianceSettingsResponseSchema } from "@choir/contracts";
import { pastDateString } from "@choir/testkit";
import { afterEach, beforeEach, expect, it } from "vitest";
import { complianceResponseWithNames } from "../src/routes/helpers/complianceResponse";
import {
  api,
  database,
  jsonWrite,
  setupTicketingIntegration,
  signIn,
  stores,
  teardownTicketingIntegration,
} from "./ticketing.integration.fixture";

beforeEach(setupTicketingIntegration);
afterEach(teardownTicketingIntegration);

it("returns the recorded completion actor and name through completion and subsequent reads", async () => {
  const cookie = await signIn();
  const enabled = await jsonWrite(
    "alpha.localhost",
    "/api/organization/compliance/toggle",
    "PUT",
    { enabled: true },
    cookie,
  );
  expect(enabled.status).toBe(200);
  const task = nonprofitComplianceSettingsResponseSchema.parse(await enabled.json()).tasks[0];
  if (!task) throw new Error("Missing seeded task.");
  expect(task.lastCompletedByUserId).toBeNull();
  expect(task.lastCompletedByName).toBeNull();
  const completedDate = pastDateString({ days: 1 });
  const completion = await jsonWrite(
    "alpha.localhost",
    `/api/organization/compliance/tasks/${task.id}/complete`,
    "POST",
    { taskId: task.id, completedDate },
    cookie,
  );
  expect(completion.status).toBe(200);
  expect(
    nonprofitComplianceSettingsResponseSchema
      .parse(await completion.json())
      .tasks.find(({ id }) => id === task.id),
  ).toMatchObject({
    lastCompletedDate: completedDate,
    lastCompletedByUserId: "ticket-manager",
    lastCompletedByName: "Ticket Manager",
  });
  const read = await exports.default.fetch(
    api("alpha.localhost", "/api/organization/compliance", cookie),
  );
  expect(read.status).toBe(200);
  expect(
    nonprofitComplianceSettingsResponseSchema
      .parse(await read.json())
      .tasks.find(({ id }) => id === task.id),
  ).toMatchObject({
    lastCompletedByUserId: "ticket-manager",
    lastCompletedByName: "Ticket Manager",
  });

  const other = await stores.getByName("organization-bravo").readNonprofitCompliance();
  expect(other.tasks).toHaveLength(0);
});

it("rejects unauthenticated reads and malformed completion requests", async () => {
  const anonymous = await exports.default.fetch(
    api("alpha.localhost", "/api/organization/compliance"),
  );
  expect([401, 403]).toContain(anonymous.status);
  const cookie = await signIn();
  const invalid = await jsonWrite(
    "alpha.localhost",
    "/api/organization/compliance/tasks/not-a-task/complete",
    "POST",
    { taskId: "not-a-task", completedDate: "invalid" },
    cookie,
  );
  expect(invalid.status).toBe(400);
  const forbidden = await exports.default.fetch(
    api("bravo.localhost", "/api/organization/compliance", cookie),
  );
  expect(forbidden.status).toBe(403);
});

it("does not resolve another Organization's user name and keeps missing names nullable", async () => {
  const settings = await stores.getByName("organization-alpha").setNonprofitEnabled({
    actorUserId: "ticket-manager",
    organizationId: "organization-alpha",
    requestId: crypto.randomUUID(),
    enabled: true,
  });
  const attributed = {
    ...settings,
    tasks: settings.tasks.map((task) => ({ ...task, lastCompletedByUserId: "ticket-manager" })),
  };
  const wrongOrganization = await complianceResponseWithNames(
    { CONTROL_DB: database },
    "organization-without-membership",
    attributed,
  );
  expect(
    wrongOrganization.tasks.every(({ lastCompletedByName }) => lastCompletedByName === null),
  ).toBe(true);
  await database.prepare("UPDATE user SET name = '' WHERE id = ?").bind("ticket-manager").run();
  const missingName = await complianceResponseWithNames(
    { CONTROL_DB: database },
    "organization-alpha",
    attributed,
  );
  expect(missingName.tasks.every(({ lastCompletedByName }) => lastCompletedByName === null)).toBe(
    true,
  );
});
