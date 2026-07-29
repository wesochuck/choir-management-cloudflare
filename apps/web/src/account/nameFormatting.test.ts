import { describe, expect, it } from "vitest";

import { getFirstName, getLastName, getUniqueDisplayNames } from "./nameFormatting";

describe("seating name formatting", () => {
  it("keeps compound surnames and suffixes together", () => {
    expect(getLastName("  Ron   Van Dyke ")).toBe("Van Dyke");
    expect(getFirstName("Ron Van Dyke")).toBe("Ron");
    expect(getLastName("Martin Luther King Jr.")).toBe("Luther King Jr.");
  });

  it("uses only a surname when it is unique", () => {
    const names = getUniqueDisplayNames([{ id: "one", displayName: "Ron Van Dyke" }]);
    expect(names.get("one")).toBe("Van Dyke");
  });

  it("expands first-name prefixes until duplicate surnames are unique", () => {
    const names = getUniqueDisplayNames([
      { id: "ron", displayName: "Ron Van Dyke" },
      { id: "rob", displayName: "Rob Van Dyke" },
      { id: "sue", displayName: "Sue Smith" },
    ]);
    expect(names.get("ron")).toBe("Van Dyke, Ron");
    expect(names.get("rob")).toBe("Van Dyke, Rob");
    expect(names.get("sue")).toBe("Smith");

    const initials = getUniqueDisplayNames([
      { id: "ron", displayName: "Ron Van Dyke" },
      { id: "sue", displayName: "Sue Van Dyke" },
    ]);
    expect(initials.get("ron")).toBe("Van Dyke, R");
    expect(initials.get("sue")).toBe("Van Dyke, S");
  });
});
