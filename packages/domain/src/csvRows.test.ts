import { describe, expect, it } from "vitest";

import { CsvRowsError, escapeCsvField, parseCsvRows } from "./csvRows";

describe("shared CSV row tokenizer", () => {
  it("parses quoted commas and escaped quotes", () => {
    expect(parseCsvRows('a,"b, c","d ""e"" f"\n')).toEqual([["a", "b, c", 'd "e" f']]);
  });

  it("handles CRLF line endings and multiline quoted fields", () => {
    expect(parseCsvRows("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsvRows('a,"line one\nline two"\n')).toEqual([["a", "line one\nline two"]]);
  });

  it("skips trailing empty rows", () => {
    expect(parseCsvRows("a,b\nc,d\n\n   \n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("rejects unterminated quotes with a typed error", () => {
    try {
      parseCsvRows('a,"unterminated\n');
      expect.unreachable("expected unterminated-quote rejection");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(CsvRowsError);
      expect(error instanceof CsvRowsError ? error.code : null).toBe("unterminated_quote");
      expect(error instanceof Error ? error.message : "").toMatch(/unterminated quoted field/);
    }
  });

  it("quotes export fields and neutralizes formula prefixes", () => {
    expect(escapeCsvField("plain")).toBe('"plain"');
    expect(escapeCsvField("=cmd|evil")).toBe(`"'=cmd|evil"`);
    expect(escapeCsvField("+123")).toBe(`"'+123"`);
    expect(escapeCsvField("@mention")).toBe(`"'@mention"`);
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField(null)).toBe('""');
    expect(escapeCsvField(24)).toBe('"24"');
  });
});
