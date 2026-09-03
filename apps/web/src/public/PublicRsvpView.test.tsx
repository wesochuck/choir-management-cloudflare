import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicRsvpView } from "./PublicRsvpView";

describe("PublicRsvpView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders actionable notice when no token is present", () => {
    vi.stubGlobal("window", {
      history: { replaceState: vi.fn() },
      location: { search: "" },
    });

    const html = renderToString(<PublicRsvpView />);
    expect(html).toContain("RSVP Link Required");
    expect(html).toContain("Please use the link from your invitation email to access this page.");
  });

  it("does not clear query parameters or call replaceState on mount", () => {
    const replaceStateSpy = vi.fn();
    vi.stubGlobal("window", {
      history: { replaceState: replaceStateSpy },
      location: { search: "?token=sample-rsvp-token-123" },
    });

    const html = renderToString(<PublicRsvpView />);
    expect(html).toContain("Loading RSVP...");
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });
});
