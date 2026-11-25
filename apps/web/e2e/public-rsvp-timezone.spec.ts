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

test("public RSVP formats 24-hour call time, links location to Google Maps, and separates buttons", async ({
  page,
}) => {
  await page.route("**/api/public/rsvp-details", async (route) => {
    const body = publicRsvpDetailsResponseSchema.parse({
      ...details,
      event: {
        ...details.event,
        callTime: "17:30",
        title: "Downtown Christmas Stroll",
        type: "Performance",
        venueAddress: "163 E Wheeling St Lancaster, Ohio 43130",
        venueName: "First United Methodist Church - Sanctuary Main Floor",
      },
      rsvp: "Yes",
    });
    await route.fulfill({ json: body });
  });

  await page.goto(`/rsvp?token=${token}`);
  await expect(page.getByRole("heading", { name: "Downtown Christmas Stroll" })).toBeVisible();
  await expect(page.locator(".auth-card")).toContainText("5:30 PM");
  await expect(page.locator(".auth-card")).not.toContainText("17:30");

  const mapsLink = page.getByRole("link", {
    name: /First United Methodist Church - Sanctuary Main Floor, 163 E Wheeling St Lancaster, Ohio 43130 on Google Maps/i,
  });
  await expect(mapsLink).toBeVisible();
  await expect(mapsLink).toHaveAttribute(
    "href",
    "https://www.google.com/maps/search/?api=1&query=First%20United%20Methodist%20Church%20-%20Sanctuary%20Main%20Floor%2C%20163%20E%20Wheeling%20St%20Lancaster%2C%20Ohio%2043130",
  );
  await expect(mapsLink).toHaveAttribute("target", "_blank");

  const attendingBox = await page.getByRole("radio", { name: "I'll be there" }).boundingBox();
  const decliningBox = await page.getByRole("radio", { name: "Can't make it" }).boundingBox();
  const submitBox = await page.getByRole("button", { name: "Update RSVP" }).boundingBox();

  expect(attendingBox).not.toBeNull();
  expect(decliningBox).not.toBeNull();
  expect(submitBox).not.toBeNull();

  if (attendingBox && decliningBox && submitBox) {
    const horizontalOrVerticalGap =
      Math.abs(attendingBox.y - decliningBox.y) < 4
        ? decliningBox.x - (attendingBox.x + attendingBox.width)
        : decliningBox.y - (attendingBox.y + attendingBox.height);
    expect(horizontalOrVerticalGap).toBeGreaterThanOrEqual(8);

    const lowestChoiceBottom = Math.max(
      attendingBox.y + attendingBox.height,
      decliningBox.y + decliningBox.height,
    );
    expect(submitBox.y - lowestChoiceBottom).toBeGreaterThanOrEqual(12);
  }
});
