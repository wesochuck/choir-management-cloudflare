import { describe, expect, it } from "vitest";

import { buildMusicPublisherSearchUrl } from "./musicPublisherSearch";

describe("music publisher search links", () => {
  it("resolves and encodes the catalog ID in an HTTPS template", () => {
    expect(
      buildMusicPublisherSearchUrl(
        "https://publisher.example/search?catalog={catalogId}",
        "ABC 12/3",
      ),
    ).toBe("https://publisher.example/search?catalog=ABC%2012%2F3");
  });

  it("rejects an incomplete or non-HTTPS template", () => {
    expect(buildMusicPublisherSearchUrl("https://publisher.example/search", "ABC 12")).toBeNull();
    expect(
      buildMusicPublisherSearchUrl("http://publisher.example/search?catalog={catalogId}", "ABC 12"),
    ).toBeNull();
  });

  it("does not create a link without a catalog ID or template", () => {
    expect(
      buildMusicPublisherSearchUrl("https://publisher.example/search?catalog={catalogId}", ""),
    ).toBeNull();
    expect(buildMusicPublisherSearchUrl("", "ABC 12")).toBeNull();
  });
});
