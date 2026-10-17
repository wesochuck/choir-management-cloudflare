import { describe, expect, it } from "vitest";
import { futureIsoDate } from "@choir/testkit";
import { publicPerformanceSchema, organizationEventFieldsSchema } from "./organization";
import { organizationEventSchema } from "./events";
import { publicTicketBundleSchema, ticketBundleSchema } from "./ticketing";

const id = "11111111-1111-4111-8111-111111111111";
const bundle = {
  id,
  title: "Season Pass",
  eventIds: [id],
  capacity: null,
  priceCents: 1000,
  saleEndAt: futureIsoDate(),
};
const performance = {
  id,
  title: "Concert",
  advancePriceCents: 1000,
  dayOfPriceCents: 1000,
  doorsOpenTime: "",
  graphicFileId: null,
  isTicketingEnabled: true,
  location: "",
  publicDetails: "",
  startsAt: futureIsoDate(),
  ticketCapacity: null,
  venueName: "",
};
const adminBundle = {
  ...bundle,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const adminEvent = {
  ...organizationEventFieldsSchema.parse({
    id,
    title: "Concert",
    type: "Performance",
    startsAt: futureIsoDate(),
  }),
  id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("ticket URL output contracts", () => {
  it.each([
    {},
    { ticketSlug: null },
    { ticketSlug: undefined },
    { ticketSlug: "spring-concert-2" },
  ])("supports older payloads and optional name states: %j", (field) => {
    expect(organizationEventSchema.parse({ ...adminEvent, ...field }).ticketSlug).toBe(
      field.ticketSlug,
    );
    expect(publicPerformanceSchema.parse({ ...performance, ...field }).ticketSlug).toBe(
      field.ticketSlug,
    );
    expect(publicTicketBundleSchema.parse({ ...bundle, ...field }).ticketSlug).toBe(
      field.ticketSlug,
    );
    expect(ticketBundleSchema.parse({ ...adminBundle, ...field }).ticketSlug).toBe(
      field.ticketSlug,
    );
  });
  it.each(["", "../other", "two words", "UPPERCASE", "trailing-", "a".repeat(121)])(
    "rejects invalid name %s",
    (ticketSlug) => {
      expect(organizationEventSchema.safeParse({ ...adminEvent, ticketSlug }).success).toBe(false);
      expect(publicPerformanceSchema.safeParse({ ...performance, ticketSlug }).success).toBe(false);
      expect(publicTicketBundleSchema.safeParse({ ...bundle, ticketSlug }).success).toBe(false);
      expect(ticketBundleSchema.safeParse({ ...adminBundle, ticketSlug }).success).toBe(false);
    },
  );
});
