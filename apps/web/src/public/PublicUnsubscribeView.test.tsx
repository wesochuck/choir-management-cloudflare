import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicUnsubscribeView } from "./PublicUnsubscribeView";

const INVALID_COPY =
  "This unsubscribe link is invalid or expired. Contact an Organization manager if you need help updating your email preference.";

describe("PublicUnsubscribeView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
  ])("renders invalid notice for %s token without touching the URL", (_label, token) => {
    const location = { search: "" };
    const replaceStateSpy = vi.fn((_data: unknown, _unused: string, url?: string | URL | null) => {
      if (typeof url === "string") {
        const parsed = new URL(url, "https://example.com");
        location.search = parsed.search;
      }
    });
    vi.stubGlobal("window", {
      history: { replaceState: replaceStateSpy },
      location,
    });

    const html = renderToString(<PublicUnsubscribeView token={token} />);
    expect(html).toContain("Unsubscribe from Organization email");
    expect(html).toContain(INVALID_COPY);
    // The token query parameter must stay intact for reloads, background-tab
    // restores, and bookmarks.
    expect(location.search).toBe("");
  });

  it("preserves token query parameters on mount with token", () => {
    const location = { search: "?token=sample-unsub-token-123" };
    const replaceStateSpy = vi.fn((_data: unknown, _unused: string, url?: string | URL | null) => {
      if (typeof url === "string") {
        const parsed = new URL(url, "https://example.com");
        location.search = parsed.search;
      }
    });
    vi.stubGlobal("window", {
      history: { replaceState: replaceStateSpy },
      location,
    });

    const html = renderToString(<PublicUnsubscribeView token="sample-unsub-token-123" />);
    expect(html).toContain("Updating your email preference…");
    expect(location.search).toBe("?token=sample-unsub-token-123");
  });
});
