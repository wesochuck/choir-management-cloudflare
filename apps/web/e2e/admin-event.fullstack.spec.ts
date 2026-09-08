// FULL-STACK suite (reaches the real local Worker/D1/DO stack).
//
// A representative administrator create flow: the event is created through
// the real /admin/events UI, persisted in the test Organization's Durable
// Object, and read back both through the UI after a reload and through the
// live GET /api/organization/events contract. No `page.route(...)` mocks are
// registered; the only test seam is the local-only bootstrap/login helper.
// Mocked event-state coverage lives in auth.attendance.spec.ts.
import { expect, test } from "@playwright/test";
import { organizationEventRequestSchema, organizationEventsResponseSchema } from "@choir/contracts";
import { z } from "zod";
import {
  bootstrapFullstack,
  FULLSTACK_APP_ORIGIN,
  signInWithFullstackOtp,
  uniqueFullstackName,
} from "./fixtures/fullstack";

const problemSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
});

function futureLocalDateTime(): string {
  const at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

test("creates an event that survives a reload against the real store", async ({
  page,
  request,
}, testInfo) => {
  const eventsEmail = `fullstack.events-create-${testInfo.project.name}@example.test`;
  await bootstrapFullstack(request, eventsEmail);
  await signInWithFullstackOtp(page, request, eventsEmail);

  const title = uniqueFullstackName("Fullstack Rehearsal");
  await page.goto(`${FULLSTACK_APP_ORIGIN}/admin/events`);
  await page.getByRole("button", { name: "Single event" }).click();
  const dialog = page.getByRole("dialog", { name: "Create event" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Start").fill(futureLocalDateTime());

  const createRequest = page.waitForRequest(
    (entry) => entry.method() === "POST" && entry.url().includes("/api/organization/events"),
  );
  await dialog.getByRole("button", { name: "Create event" }).click();
  await createRequest;

  await expect(page.getByRole("status")).toContainText("Event created.");
  await expect(dialog).toBeHidden();
  // The title renders in both the desktop table and the mobile cards (the
  // hidden viewport variant stays in the DOM), so match only visible text.
  await expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible();

  // The live read contract must agree with what the UI just rendered. If the
  // Worker changes the event shape, this schema parse fails here instead of
  // letting a stale UI mock stay green.
  const listed = await page.request.get(`${FULLSTACK_APP_ORIGIN}/api/organization/events`);
  expect(listed.ok()).toBe(true);
  const eventsBody = organizationEventsResponseSchema.parse(await listed.json());
  expect(eventsBody.events.map((event) => event.title)).toContain(title);

  await page.reload();
  await expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible();
});

test("rejects an invalid event payload with a typed validation failure", async ({
  page,
  request,
}, testInfo) => {
  const eventsEmail = `fullstack.events-invalid-${testInfo.project.name}@example.test`;
  await bootstrapFullstack(request, eventsEmail);
  await signInWithFullstackOtp(page, request, eventsEmail);

  // Contract-drift proof: the create schema still guards the boundary. An
  // empty object must stay a 400 `validation_failed`, never a 201 with
  // defaults the frontend did not ask for.
  const response = await page.request.post(`${FULLSTACK_APP_ORIGIN}/api/organization/events`, {
    data: {},
    headers: { origin: FULLSTACK_APP_ORIGIN },
  });
  expect(response.status()).toBe(400);
  expect(problemSchema.parse(await response.json()).code).toBe("validation_failed");

  // The request schema the UI builds against must also reject the same
  // payload locally, proving both sides share the contract.
  expect(organizationEventRequestSchema.safeParse({}).success).toBe(false);
});
