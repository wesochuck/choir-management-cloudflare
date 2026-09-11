import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuditionForm,
  PublicAuditionStatusCard,
  PublicAuditionView,
  type PublicAuditionSettings,
} from "./PublicAuditionView";

const mockAuditionSettings: PublicAuditionSettings = {
  confirmationMessage: "Thank you for applying!",
  defaultPerformanceId: null,
  enabled: true,
  mode: "audition",
  performerLabel: "Singer",
  performance: null,
  rehearsalNotes: "Bring sheet music.",
  rehearsalSchedule: [],
  sections: [],
  slots: [
    {
      endsAt: "2026-09-15T19:30:00Z",
      id: "slot-1",
      startsAt: "2026-09-15T19:00:00Z",
    },
  ],
  startDate: null,
  timezone: "America/New_York",
  venue: null,
  voiceParts: [
    { fullName: "Soprano", label: "Soprano", sectionCode: "S" },
    { fullName: "Alto", label: "Alto", sectionCode: "A" },
    { fullName: "Tenor", label: "Tenor", sectionCode: "T" },
    { fullName: "Bass", label: "Bass", sectionCode: "B" },
  ],
};

describe("PublicAuditionView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves token query parameters on mount", () => {
    const location = { pathname: "/auditions", search: "?token=sample-audition-token-123" };
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

    const html = renderToString(<PublicAuditionView />);
    expect(html).toContain("Loading");
    expect(location.search).toBe("?token=sample-audition-token-123");
  });

  it("preserves URL state on mount when browsing without token", () => {
    const location = { pathname: "/auditions", search: "" };
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

    const html = renderToString(<PublicAuditionView />);
    expect(html).toContain("Loading");
    expect(location.search).toBe("");
  });
});

describe("AuditionForm", () => {
  it("renders form with required inputs and availability notes textarea", () => {
    const html = renderToString(
      <AuditionForm busy={false} onSubmit={vi.fn()} settings={mockAuditionSettings} />,
    );

    expect(html).toContain("<form");
    expect(html).toContain('class="form-stack audition-form"');
    expect(html).toContain('id="audition-name"');
    expect(html).toContain('id="audition-email"');
    expect(html).toContain('id="audition-phone"');
    expect(html).toContain('id="audition-availability-notes"');
    expect(html).toContain("Availability notes (optional)");
  });
});

describe("PublicAuditionStatusCard", () => {
  it("renders loading status message", () => {
    const html = renderToString(
      <PublicAuditionStatusCard onRetry={vi.fn()} pageStatus={{ type: "loading" }} />,
    );

    expect(html).toContain("Loading audition details…");
    expect(html).toContain('role="status"');
  });

  it("renders settings_error with alert and in-place retry button", () => {
    const html = renderToString(
      <PublicAuditionStatusCard
        onRetry={vi.fn()}
        pageStatus={{
          message: "Unable to load configuration from server.",
          type: "settings_error",
        }}
      />,
    );

    expect(html).toContain("Audition Settings Unavailable");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Unable to load configuration from server.");
    expect(html).toContain("Retry");
    expect(html).toContain("Return to the Organization site");
  });

  it("renders not_found with alert and retry button", () => {
    const html = renderToString(
      <PublicAuditionStatusCard onRetry={vi.fn()} pageStatus={{ type: "not_found" }} />,
    );

    expect(html).toContain("Link Not Found");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Retry");
  });
});
