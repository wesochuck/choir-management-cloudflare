import { afterEach, expect, it, vi } from "vitest";

import { generatePublicPlayerToken } from "./player";

afterEach(() => {
  vi.unstubAllGlobals();
});

const shortUrl = "/practice/winter-concert#mR4vh8TQ2Lk7Vn5sDP3Jqw";

it.each([
  { shareUrl: shortUrl, expected: shortUrl },
  { shareUrl: undefined, expected: undefined },
  { shareUrl: null, expected: undefined },
  { shareUrl: "https://unknown.example" + shortUrl, expected: undefined },
  { shareUrl: "/practice/winter-concert#short", expected: undefined },
])(
  "parses a share URL alongside the older signed URL ($shareUrl)",
  async ({ shareUrl, expected }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          token: "signed-token",
          shareUrl,
        }),
      ),
    );
    const link = await generatePublicPlayerToken("00000000-0000-4000-8000-000000000001");
    expect(link.shareUrl).toBe(expected);
    expect(link.url).toBe("/player?mode=set-list&token=signed-token");
  },
);
