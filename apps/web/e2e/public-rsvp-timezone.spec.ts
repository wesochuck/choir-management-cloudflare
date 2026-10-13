import { expect, test } from "@playwright/test";
import { publicRsvpDetailsResponseSchema } from "@choir/contracts";

test.use({ locale: "en-US", timezoneId: "Asia/Tokyo" });

const token = "fixture-rsvp-timezone-token";
const details = {
  canSubmit: true,
  event: {
    callTime: "6:00 PM",
    details: "Bring your music folder.",
    durationMinutes: 90,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    location: "Choir Hall",
    startsAt: "2026-10-11T22:30:00.000Z",
    timezone: "America/New_York",
    title: "Weekly Rehearsal",
    type: "Rehearsal",
    venueAddress: "123 Choir Lane",
    venueName: "Choir Hall",
  },
  profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  profileName: "Jane Singer",
  rsvp: "Pending",
  rsvpNote: "",
};

for (const [timezone, startsAt, date, time] of [
  ["America/New_York", "2026-10-11T22:30:00.000Z", "October 11, 2026", "6:30 PM EDT"],
  ["America/New_York", "2026-11-08T23:30:00.000Z", "November 8, 2026", "6:30 PM EST"],
  ["America/New_York", "2026-10-12T01:30:00.000Z", "October 11, 2026", "9:30 PM EDT"],
  ["America/Los_Angeles", "2026-10-11T22:30:00.000Z", "October 11, 2026", "3:30 PM PDT"],
  ["UTC", "2026-10-11T22:30:00.000Z", "October 11, 2026", "10:30 PM UTC"],
] as const) {
  test(`public RSVP uses ${timezone} for ${startsAt} from a Tokyo browser`, async ({ page }) => {
    await page.route("**/api/public/rsvp-details", async (route) => {
      expect(route.request().postDataJSON()).toEqual({ token });
      const body = publicRsvpDetailsResponseSchema.parse({
        ...details,
        event: { ...details.event, startsAt, timezone },
      });
      await route.fulfill({ json: body });
    });
    await page.goto(`/rsvp?token=${token}`);
    await expect(page.getByRole("heading", { name: "Weekly Rehearsal" })).toBeVisible();
    await expect(page.locator(".auth-card")).toContainText(`${date} at ${time}`);
    await expect(page.locator(".auth-card")).toContainText("123 Choir Lane");
    await expect(page.getByRole("radio", { name: "I'll be there" })).toBeVisible();
    await page.reload();
    await expect(page.locator(".auth-card")).toContainText(`${date} at ${time}`);
    expect(new URL(page.url()).searchParams.get("token")).toBe(token);
  });
}

for (const timezone of [undefined, null, "Invalid/Timezone"]) {
  test(`public RSVP rejects missing or invalid Organization timezone (${String(timezone)})`, async ({
    page,
  }) => {
    await page.route("**/api/public/rsvp-details", (route) =>
      route.fulfill({ json: { ...details, event: { ...details.event, timezone } } }),
    );
    await page.goto(`/rsvp?token=${token}`);
    await expect(page.getByRole("heading", { name: "Link Not Found" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Weekly Rehearsal" })).not.toBeVisible();
    expect(new URL(page.url()).searchParams.get("token")).toBe(token);
  });
}
