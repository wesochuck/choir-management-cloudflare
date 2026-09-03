import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicAuditionView } from "./PublicAuditionView";

describe("PublicAuditionView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not clear query parameters or call replaceState on mount with token", () => {
    const replaceStateSpy = vi.fn();
    vi.stubGlobal("window", {
      history: { replaceState: replaceStateSpy },
      location: { pathname: "/auditions", search: "?token=sample-audition-token-123" },
    });

    const html = renderToString(<PublicAuditionView />);
    expect(html).toContain("Loading");
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("does not call replaceState on mount when browsing without token", () => {
    const replaceStateSpy = vi.fn();
    vi.stubGlobal("window", {
      history: { replaceState: replaceStateSpy },
      location: { pathname: "/auditions", search: "" },
    });

    const html = renderToString(<PublicAuditionView />);
    expect(html).toContain("Loading");
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });
});
