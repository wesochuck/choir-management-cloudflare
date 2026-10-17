import { describe, expect, it } from "vitest";
import { importFooterEmbeds } from "./footerEmbedImport";

describe("footer embed import", () => {
  it("extracts each Organization's linked image, preserving dynamic URLs and discarding executable attributes", () => {
    const imported = importFooterEmbeds(
      '<a href="https://app.candid.org/profile/123?pkId=org&amp;v=1" onclick="bad()"><img src="https://widgets.guidestar.org/prod/v1/pdp/transparency-seal/123/svg" alt="Silver seal" onerror="bad()" style="position:fixed" /></a>',
    );
    expect(imported).toEqual([
      {
        kind: "image",
        title: "Silver seal",
        src: "https://widgets.guidestar.org/prod/v1/pdp/transparency-seal/123/svg",
        href: "https://app.candid.org/profile/123?pkId=org&v=1",
        height: 240,
      },
    ]);
  });
  it("imports iframe URLs without srcdoc, permissions or sandbox overrides", () => {
    expect(
      importFooterEmbeds(
        '<iframe src="https://example.org/widget" title="Partner" height="320" srcdoc="bad" sandbox="allow-same-origin"></iframe>',
      ),
    ).toEqual([
      {
        kind: "iframe",
        title: "Partner",
        src: "https://example.org/widget",
        href: "",
        height: 320,
      },
    ]);
  });
  it.each([
    '<script src="https://example.org/code.js"></script>',
    '<img src="javascript:bad()">',
    '<iframe srcdoc="bad"></iframe>',
    "<p>hello</p>",
    "x".repeat(20_001),
  ])("rejects unsupported code", (code) => {
    expect(() => importFooterEmbeds(code)).toThrow();
  });
});
