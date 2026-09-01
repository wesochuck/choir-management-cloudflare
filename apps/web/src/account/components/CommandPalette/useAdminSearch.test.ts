import { describe, expect, it } from "vitest";

import { parseQuery } from "./useAdminSearch";

describe("parseQuery", () => {
  it("parses empty and plain queries", () => {
    expect(parseQuery("")).toEqual({ cleanTerm: "", prefix: null, scopedCategory: null });
    expect(parseQuery("rehearsal")).toEqual({
      cleanTerm: "rehearsal",
      prefix: null,
      scopedCategory: null,
    });
  });

  it("parses prefix shortcuts correctly", () => {
    expect(parseQuery("roster: smith")).toEqual({
      cleanTerm: "smith",
      prefix: "roster",
      scopedCategory: "roster",
    });
    expect(parseQuery("events: winter concert")).toEqual({
      cleanTerm: "winter concert",
      prefix: "events",
      scopedCategory: "events",
    });
    expect(parseQuery("music: handel")).toEqual({
      cleanTerm: "handel",
      prefix: "music",
      scopedCategory: "music",
    });
    expect(parseQuery("settings: dues")).toEqual({
      cleanTerm: "dues",
      prefix: "settings",
      scopedCategory: "settings",
    });
    expect(parseQuery("actions: create")).toEqual({
      cleanTerm: "create",
      prefix: "actions",
      scopedCategory: "actions",
    });
  });
});
