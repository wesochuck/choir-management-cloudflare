import { futureIsoDate } from "@choir/testkit";
// FULL-STACK suite (reaches the real local Worker/D1/DO stack).
//
// A representative administrator create flow: the event is created through
// the real /admin/events UI, persisted in the test Organization's Durable
// Object, and read back both through the UI after a reload and through the
// live GET /api/organization/events contract. No `page.route(...)` mocks are
// registered; the only test seam is the local-only bootstrap/login helper.
// Mocked event-state coverage lives in auth.attendance.spec.ts.
import { expect, test } from "@playwright/test";
import {
  organizationEventRequestSchema,
  organizationEventsResponseSchema,
  organizationEventSchema,
  publishedOrganizationProjectionSchema,
} from "@choir/contracts";
import { z } from "zod";
import {
  bootstrapFullstack,
  FULLSTACK_APP_ORIGIN,
  signInWithFullstackOtp,
  uniqueFullstackName,
} from "./fixtures/fullstack";
import { selectEventEditorSection } from "./support/eventEditor";

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
  await dialog.getByRole("textbox", { name: /Title/ }).fill(title);
  // Venue is mandatory; use the shared TBD venue when the location is unknown.
  // Start and venue are located in Schedule & venue.
  await selectEventEditorSection(dialog, "schedule");
  await dialog.getByLabel(/Start date/i).fill(futureLocalDateTime());
  await dialog.getByRole("button", { name: /Create or select TBD/ }).click();
  await expect(dialog.getByText(/Venue to be confirmed/)).toBeVisible();

  const createRequest = page.waitForRequest(
    (entry) => entry.method() === "POST" && entry.url().includes("/api/organization/events"),
  );
  await dialog.getByRole("button", { name: "Create event" }).click();
  await createRequest;

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Event created." })).toBeVisible();
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

  // Reload finishes before the Events page's asynchronous reads. Synchronize
  // with all four real responses so Worker latency is not charged against the
  // short rendering assertion, and surface failed reads as API failures.
  const reloadReads = Promise.all(
    ["events", "venues", "calendar-settings", "roster-configuration"].map(async (resource) => {
      const response = await page.waitForResponse(
        (entry) =>
          entry.request().method() === "GET" &&
          new URL(entry.url()).pathname === `/api/organization/${resource}`,
      );
      expect(response.status(), `Reload ${resource} read must succeed`).toBe(200);
      const body: unknown = await response.json();
      if (resource === "events") {
        expect(organizationEventsResponseSchema.parse(body).events).toEqual(
          expect.arrayContaining([expect.objectContaining({ title })]),
        );
      }
    }),
  );
  await Promise.all([page.reload(), reloadReads]);
  await expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible();
});

test("enabling tickets selects public visibility and persists it in the real store", async ({
  page,
  request,
}, testInfo) => {
  const email = `fullstack.events-public-${testInfo.project.name}@example.test`;
  await bootstrapFullstack(request, email);
  await signInWithFullstackOtp(page, request, email);
  const initialPublication = await page.request.post(
    `${FULLSTACK_APP_ORIGIN}/api/organization/website/publish`,
    {
      headers: { origin: FULLSTACK_APP_ORIGIN },
    },
  );
  expect(initialPublication.status()).toBe(200);
  const title = uniqueFullstackName("Ticketed Performance");
  await page.goto(`${FULLSTACK_APP_ORIGIN}/admin/events`);
  await page.getByRole("button", { name: "Single event" }).click();
  const dialog = page.getByRole("dialog", { name: "Create event" });
  await dialog.getByRole("textbox", { name: /Title/ }).fill(title);
  await dialog.getByLabel("Type *", { exact: true }).selectOption("Performance");
  await selectEventEditorSection(dialog, "schedule");
  await dialog.getByLabel(/Start date/i).fill(futureLocalDateTime());
  await dialog.getByRole("button", { name: /Create or select TBD/ }).click();
  await selectEventEditorSection(dialog, "rsvp");
  await dialog
    .getByLabel("Member RSVP deadline *", { exact: true })
    .fill(futureIsoDate({ days: 20 }).slice(0, 10));
  await selectEventEditorSection(dialog, "tickets");
  await dialog.getByLabel("Enable ticket sales", { exact: true }).check();
  await selectEventEditorSection(dialog, "public");
  await expect(dialog.getByLabel("Publish on public website", { exact: true })).toBeChecked();
  await expect(dialog.getByLabel("Publish on public website", { exact: true })).toBeDisabled();
  await expect(dialog.getByText(/Saving updates the published website schedule/)).toBeVisible();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/api/organization/events"),
  );
  await dialog.getByRole("button", { name: "Create event", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const created = organizationEventSchema.parse(await response.json());
  expect(created).toMatchObject({ title, isTicketingEnabled: true, publishOnWebsite: true });
  const projection = await page.request.get(`${FULLSTACK_APP_ORIGIN}/api/public/projection`);
  expect(projection.status()).toBe(200);
  expect(
    publishedOrganizationProjectionSchema.parse(await projection.json()).payload.performances,
  ).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, title })]));
  await expect(dialog).toBeHidden();
  const listed = await page.request.get(`${FULLSTACK_APP_ORIGIN}/api/organization/events`);
  expect(
    organizationEventsResponseSchema
      .parse(await listed.json())
      .events.find((event) => event.id === created.id)?.publishOnWebsite,
  ).toBe(true);
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
