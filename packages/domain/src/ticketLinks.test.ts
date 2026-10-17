import { describe, expect, it } from "vitest";
import { ticketSalesPath, ticketSlugBase } from "./ticketLinks";

describe("ticket URL names", () => {
  it.each([
    ["Christmas by Candlelight!", "christmas-by-candlelight"],
    ["  Café & Chœurs  ", "cafe-ch-urs"],
    ["🎵", "concert-tickets"],
    ["Order", "concert-order"],
    ["Bundles", "concert-bundles"],
    ["dead-beef", "concert-dead-beef"],
  ])("normalizes %s", (title, expected) => {
    expect(ticketSlugBase(title)).toBe(expected);
  });

  it("bounds long titles and avoids trailing dashes", () => {
    const slug = ticketSlugBase("Spring Concert ".repeat(50));
    expect(slug.length).toBeLessThanOrEqual(100);
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("generates readable links and falls back for old projections", () => {
    expect(ticketSalesPath({ id: "id", ticketSlug: "spring-concert" })).toBe(
      "/tickets/spring-concert",
    );
    expect(ticketSalesPath({ id: "id", ticketSlug: "season-pass" }, "bundle")).toBe(
      "/tickets/bundles/season-pass",
    );
    for (const item of [
      { id: "id" },
      { id: "id", ticketSlug: null },
      { id: "id", ticketSlug: undefined },
    ]) {
      expect(ticketSalesPath(item)).toBe("/tickets/id");
    }
  });
});
