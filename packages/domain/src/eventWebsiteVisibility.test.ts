import { expect, it } from "vitest";
import { eventWebsiteVisibility } from "./eventWebsiteVisibility";

it.each([
  ["Performance", true, false, true],
  ["Performance", true, true, true],
  ["Performance", false, false, false],
  ["Performance", false, true, true],
  ["Rehearsal", false, false, false],
  ["Other", false, false, false],
] as const)(
  "derives public visibility for %s ticketing=%s requested=%s",
  (type, isTicketingEnabled, publishOnWebsite, expected) => {
    expect(eventWebsiteVisibility({ type, isTicketingEnabled, publishOnWebsite })).toBe(expected);
  },
);
