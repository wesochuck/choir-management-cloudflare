import { publicTicketBundleSchema } from "@choir/contracts";
import { futureIsoDate, pastIsoDate } from "@choir/testkit";
import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { TicketBundleSuggestions } from "./TicketBundleSuggestions";

const eventId = "11111111-1111-4111-8111-111111111111";
const bundle = publicTicketBundleSchema.parse({
  id: "22222222-2222-4222-8222-222222222222",
  ticketSlug: "lcc-season",
  title: "LCC 2026–2027 Season",
  priceCents: 3000,
  capacity: null,
  eventIds: [eventId],
  saleEndAt: futureIsoDate({ days: 30 }),
});

it("shows compact pass suggestions with names, prices, counts and readable destinations", () => {
  render(
    <TicketBundleSuggestions
      bundles={[
        bundle,
        {
          ...bundle,
          id: "33333333-3333-4333-8333-333333333333",
          ticketSlug: null,
          title: "Family pass",
          priceCents: 4500,
          eventIds: [eventId, "44444444-4444-4444-8444-444444444444"],
        },
      ]}
      eventId={eventId}
      nowMs={Date.now()}
    />,
  );
  const suggestion = screen.getByRole("complementary", {
    name: "Coming to more than one concert?",
  });
  expect(within(suggestion).getByText("$30.00 per pass · 1 performance")).toBeVisible();
  expect(within(suggestion).getByText("$45.00 per pass · 2 performances")).toBeVisible();
  expect(
    within(suggestion).getByRole("link", { name: "View season pass: LCC 2026–2027 Season" }),
  ).toHaveAttribute("href", "/tickets/bundles/lcc-season");
  expect(
    within(suggestion).getByRole("link", { name: "View season pass: Family pass" }),
  ).toHaveAttribute("href", "/tickets/bundles/33333333-3333-4333-8333-333333333333");
});
it.each([
  [],
  [{ ...bundle, saleEndAt: pastIsoDate({ days: 1 }) }],
  [{ ...bundle, eventIds: ["other"] }],
])("omits the strip when no matching pass is on sale", (...bundles) => {
  render(<TicketBundleSuggestions bundles={bundles} eventId={eventId} nowMs={Date.now()} />);
  expect(screen.queryByRole("complementary")).toBeNull();
});
