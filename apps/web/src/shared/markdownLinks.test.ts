import { describe, expect, it } from "vitest";
import {
  formatMarkdownLink,
  markdownLinkSelection,
  normalizeEditorLinkUrl,
  safePublicLinkUrl,
} from "./markdownLinks";

describe("public link destinations", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///tmp/a",
    "//other.example.org",
    "/\\evil.org",
    "java\nscript:alert(1)",
    "https://example.org/\u0000",
  ])("rejects unsafe destination %s", (url) => {
    expect(safePublicLinkUrl(url)).toBeNull();
    expect(normalizeEditorLinkUrl(url)).toBeNull();
  });
  it.each([
    "https://example.org",
    "http://example.org",
    "mailto:hello@example.org",
    "/donate",
    "#about-us",
  ])("accepts destination %s", (url) => {
    expect(safePublicLinkUrl(url)).toBe(url);
  });
  it("normalizes a hostname and preserves escaped labels and the tab option when editing", () => {
    expect(normalizeEditorLinkUrl("example.org/join")).toBe("https://example.org/join");
    const link = formatMarkdownLink("Join [our band]", "https://example.org/(band)", false);
    const source = `Before ${link} after`;
    expect(markdownLinkSelection(source, 12, 12)).toMatchObject({
      text: "Join [our band]",
      url: "https://example.org/%28band%29",
      newTab: false,
      start: 7,
      end: 7 + link.length,
      existing: true,
    });
  });
});
