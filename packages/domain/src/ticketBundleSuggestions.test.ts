import { expect, it } from "vitest";
import { futureIsoDate, pastIsoDate } from "@choir/testkit";
import { availableTicketBundlesForEvent } from "./ticketing";

it("returns every matching bundle whose sale has not ended, retaining its details", () => {
  const now = Date.now();
  const available = {
    id: "available",
    eventIds: ["other", "concert"],
    saleEndAt: futureIsoDate({ days: 1 }),
    priceCents: 3000,
  };
  const second = { ...available, id: "second" };
  const bundles = [
    available,
    { ...available, id: "unrelated", eventIds: ["other"] },
    { ...available, id: "expired", saleEndAt: pastIsoDate({ days: 1 }) },
    { ...available, id: "ends-now", saleEndAt: new Date(now).toISOString() },
    { ...available, id: "invalid", saleEndAt: "invalid" },
    second,
  ];
  expect(availableTicketBundlesForEvent(bundles, "concert", now)).toEqual([available, second]);
  expect(bundles).toHaveLength(6);
});
it("returns no suggestions for an empty list or an event outside every bundle", () => {
  expect(availableTicketBundlesForEvent([], "concert", Date.now())).toEqual([]);
  expect(
    availableTicketBundlesForEvent(
      [{ eventIds: ["other"], saleEndAt: futureIsoDate({ days: 1 }) }],
      "concert",
      Date.now(),
    ),
  ).toEqual([]);
});
