import { describe, expect, it } from "vitest";
import { formatTicketDisplayNumber } from "./shared";

describe("formatTicketDisplayNumber", () => {
  it("extracts the final grouping from a standard hyphen-separated UUID", () => {
    expect(formatTicketDisplayNumber("2dbbce42-49ca-4246-9eb5-6cc51f5578dc")).toBe("6cc51f5578dc");
  });

  it("extracts the final grouping from prefix-coded IDs", () => {
    expect(formatTicketDisplayNumber("LC-004218")).toBe("004218");
  });

  it("returns single-token IDs unchanged", () => {
    expect(formatTicketDisplayNumber("123456")).toBe("123456");
  });

  it("handles whitespace and trailing hyphens cleanly", () => {
    expect(formatTicketDisplayNumber("  foo-bar-baz  ")).toBe("baz");
    expect(formatTicketDisplayNumber("foo-bar-")).toBe("bar");
  });

  it("handles empty or blank string without crashing", () => {
    expect(formatTicketDisplayNumber("")).toBe("");
    expect(formatTicketDisplayNumber("   ")).toBe("");
  });
});
