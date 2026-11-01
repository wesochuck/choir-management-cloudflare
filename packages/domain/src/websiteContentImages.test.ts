import { describe, expect, it } from "vitest";
import {
  formatWebsiteContentImage,
  parseWebsiteContentImage,
  websiteContentImageIds,
  websiteImageSelection,
} from "./websiteContentImages";
const fileId = "77777777-7777-4777-8777-777777777777";
const image = { fileId, alt: 'Choir [rehearsal] \\ "singing"', caption: 'Our "first" concert' };
describe("website content images", () => {
  it("round trips escaped descriptions and captions without accepting other sources", () => {
    expect(parseWebsiteContentImage(formatWebsiteContentImage(image))).toEqual(image);
    for (const source of [
      "https://example.org/photo.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "choir-image:other-org-key",
      "/api/organization/files/secret",
    ]) {
      expect(parseWebsiteContentImage(`![Choir](${source})`)).toBeNull();
    }
    expect(parseWebsiteContentImage(`![](choir-image:${fileId})`)).toBeNull();
    expect(parseWebsiteContentImage(`![${"x".repeat(501)}](choir-image:${fileId})`)).toBeNull();
    expect(
      parseWebsiteContentImage(formatWebsiteContentImage({ ...image, caption: "x".repeat(1001) })),
    ).toBeNull();
  });
  it("collects distinct standalone image blocks and honors removed legacy History", () => {
    const block = formatWebsiteContentImage(image);
    expect(
      websiteContentImageIds({
        aboutUsText: `Intro\r\n\r\n${block}`,
        historyText: block,
        pages: [{ body: block }],
      }),
    ).toEqual([fileId]);
    expect(websiteContentImageIds({ aboutUsText: "", historyText: block, pages: [] })).toEqual([]);
    expect(websiteContentImageIds({ aboutUsText: "", historyText: block })).toEqual([fileId]);
    expect(websiteContentImageIds({ aboutUsText: `Intro\n${block}`, historyText: "" })).toEqual([]);
  });
  it("selects existing image lines for editing while preserving ordinary selections", () => {
    const block = formatWebsiteContentImage(image);
    const value = `Before\n\n${block}\n\nAfter`;
    expect(websiteImageSelection(value, 12, 12)).toEqual({
      start: 8,
      end: 8 + block.length,
      image,
    });
    expect(websiteImageSelection(value, 0, 4)).toEqual({ start: 0, end: 4, image: null });
  });
});
