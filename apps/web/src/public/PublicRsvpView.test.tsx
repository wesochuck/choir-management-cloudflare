import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicRsvpView, RsvpForm, type RsvpDetails } from "./PublicRsvpView";

const mockEvent = {
  callTime: "6:30 PM",
  details: "Sectional rehearsal",
  durationMinutes: 120,
  id: "evt-123",
  location: "Main Sanctuary",
  startsAt: "2026-09-10T19:00:00Z",
  title: "Weekly Rehearsal",
  type: "Rehearsal",
  venueAddress: "123 Choir Lane",
  venueName: "Choir Hall",
};

const mockRsvpPending: RsvpDetails = {
  canSubmit: true,
  event: mockEvent,
  profileId: "prof-1",
  profileName: "Jane Singer",
  rsvp: "Pending",
  rsvpNote: "",
};

const mockRsvpDecliningRehearsal: RsvpDetails = {
  canSubmit: true,
  event: mockEvent,
  profileId: "prof-1",
  profileName: "Jane Singer",
  rsvp: "No",
  rsvpNote: "",
};

describe("PublicRsvpView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders actionable notice when no token is present", () => {
    const location = { search: "" };
    vi.stubGlobal("window", {
      history: { replaceState: vi.fn() },
      location,
    });

    const html = renderToString(<PublicRsvpView />);
    expect(html).toContain("RSVP Link Required");
    expect(html).toContain("Please use the link from your invitation email to access this page.");
    expect(location.search).toBe("");
  });

  it("preserves token query parameter on mount", () => {
    const location = { search: "?token=sample-rsvp-token-123" };
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

    const html = renderToString(<PublicRsvpView />);
    expect(html).toContain("Loading RSVP...");
    expect(location.search).toBe("?token=sample-rsvp-token-123");
  });
});

describe("RsvpForm", () => {
  it("renders pending state with radio group and disabled submit requiring selection", () => {
    const html = renderToString(
      <RsvpForm busy={false} details={mockRsvpPending} onSubmit={vi.fn()} />,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('id="rsvp-selection-hint"');
    expect(html).toContain("Please select whether you will be attending before submitting.");
    expect(html).toContain('aria-describedby="rsvp-selection-hint"');
    expect(html).toContain("disabled=");
  });

  it("requires absence note when declining a rehearsal and links error via aria-describedby", () => {
    const html = renderToString(
      <RsvpForm busy={false} details={mockRsvpDecliningRehearsal} onSubmit={vi.fn()} />,
    );

    expect(html).toContain('id="decline-note-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain(
      "A note explaining your absence is required when declining a rehearsal.",
    );
    expect(html).toContain('aria-describedby="decline-note-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("disabled=");
  });

  it("renders enabled submit button and roving tabindex when attending is selected", () => {
    const mockAttending: RsvpDetails = {
      ...mockRsvpPending,
      rsvp: "Yes",
    };
    const html = renderToString(
      <RsvpForm busy={false} details={mockAttending} onSubmit={vi.fn()} />,
    );

    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Update RSVP");
    expect(html).not.toContain("disabled=");

    const radioRegex = /<button[^>]*role="radio"[^>]*tabindex="([^"]*)"/g;
    const tabIndices: string[] = [];
    let match;
    while ((match = radioRegex.exec(html)) !== null) {
      if (match[1] !== undefined) tabIndices.push(match[1]);
    }
    expect(tabIndices).toEqual(["0", "-1"]);
  });

  it("sets roving tabindex correctly when declining is selected", () => {
    const html = renderToString(
      <RsvpForm busy={false} details={mockRsvpDecliningRehearsal} onSubmit={vi.fn()} />,
    );

    const radioRegex = /<button[^>]*role="radio"[^>]*tabindex="([^"]*)"/g;
    const tabIndices: string[] = [];
    let match;
    while ((match = radioRegex.exec(html)) !== null) {
      if (match[1] !== undefined) tabIndices.push(match[1]);
    }
    expect(tabIndices).toEqual(["-1", "0"]);
  });
});
