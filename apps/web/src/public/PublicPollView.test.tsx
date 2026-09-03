import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicPollView } from "./PublicPollView";

describe("PublicPollView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders actionable notice when no token is present", () => {
    vi.stubGlobal("window", {
      history: { replaceState: vi.fn() },
      location: { search: "" },
    });

    const html = renderToString(<PublicPollView />);
    expect(html).toContain("Poll Link Required");
    expect(html).toContain("Please use the link from your email to access this poll.");
  });

  it("does not clear query parameters or call replaceState on mount", () => {
    const replaceStateSpy = vi.fn();
    vi.stubGlobal("window", {
      history: { replaceState: replaceStateSpy },
      location: { search: "?token=sample-poll-token-123" },
    });

    const html = renderToString(<PublicPollView />);
    expect(html).toContain("Loading Poll...");
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });
});
