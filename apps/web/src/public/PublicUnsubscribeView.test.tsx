import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicUnsubscribeView } from "./PublicUnsubscribeView";

describe("PublicUnsubscribeView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders notice when no token is present", () => {
    vi.stubGlobal("window", {
      history: { replaceState: vi.fn() },
      location: { search: "" },
    });

    const html = renderToString(<PublicUnsubscribeView token={null} />);
    expect(html).toContain("Unsubscribe from Organization email");
    expect(html).toContain(
      "This unsubscribe link is invalid or expired. Contact an Organization manager if you need help updating your email preference.",
    );
  });

  it("does not clear query parameters or call replaceState on mount with token", () => {
    const replaceStateSpy = vi.fn();
    vi.stubGlobal("window", {
      history: { replaceState: replaceStateSpy },
      location: { search: "?token=sample-unsub-token-123" },
    });

    const html = renderToString(<PublicUnsubscribeView token="sample-unsub-token-123" />);
    expect(html).toContain("Updating your email preference…");
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });
});
