import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PollForm, PublicPollView, type PollDetails } from "./PublicPollView";

const mockPollSingleChoice: PollDetails = {
  canSubmit: true,
  description: "Poll description",
  expiresAt: "2026-10-01T00:00:00Z",
  multipleChoice: false,
  options: [
    { id: "opt-1", label: "Option A", sortOrder: 0 },
    { id: "opt-2", label: "Option B", sortOrder: 1 },
  ],
  pollId: "poll-1",
  profileId: "prof-1",
  profileName: "Jane Doe",
  responseOptionIds: [],
  title: "What is your preference?",
};

const mockPollEmptyOptions: PollDetails = {
  ...mockPollSingleChoice,
  options: [],
};

const mockPollMultipleChoiceWithVote: PollDetails = {
  canSubmit: true,
  description: "Select multiple options",
  expiresAt: "2026-10-01T00:00:00Z",
  multipleChoice: true,
  options: [
    { id: "opt-1", label: "Option 1", sortOrder: 0 },
    { id: "opt-2", label: "Option 2", sortOrder: 1 },
  ],
  pollId: "poll-2",
  profileId: "prof-1",
  profileName: "Jane Doe",
  responseOptionIds: ["opt-1"],
  title: "Select all that apply",
};

describe("PublicPollView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders actionable notice when no token is present", () => {
    const location = { search: "" };
    vi.stubGlobal("window", {
      history: { replaceState: vi.fn() },
      location,
    });

    const html = renderToString(<PublicPollView />);
    expect(html).toContain("Poll Link Required");
    expect(html).toContain("Please use the link from your email to access this poll.");
    expect(location.search).toBe("");
  });

  it("preserves token query parameter on mount", () => {
    const location = { search: "?token=sample-poll-token-123" };
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

    const html = renderToString(<PublicPollView />);
    expect(html).toContain("Loading Poll...");
    expect(location.search).toBe("?token=sample-poll-token-123");
  });
});

describe("PollForm", () => {
  it("renders empty state notice when no options exist", () => {
    const html = renderToString(
      <PollForm busy={false} details={mockPollEmptyOptions} onSubmit={vi.fn()} />,
    );

    expect(html).toContain("No options are available for this poll.");
    expect(html).toContain('role="status"');
    expect(html).toContain("Return to the Organization site");
  });

  it("renders radio options inside radiogroup with roving tabindex when no selection", () => {
    const html = renderToString(
      <PollForm busy={false} details={mockPollSingleChoice} onSubmit={vi.fn()} />,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Poll options"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('id="poll-submit-hint"');
    expect(html).toContain("Select at least one option to submit your vote.");
    expect(html).toContain('aria-describedby="poll-submit-hint"');
    expect(html).toContain("disabled=");

    // First radio has tabindex 0, second radio has tabindex -1
    const radioRegex = /<button[^>]*role="radio"[^>]*tabindex="([^"]*)"/g;
    const tabIndices: string[] = [];
    let match;
    while ((match = radioRegex.exec(html)) !== null) {
      if (match[1] !== undefined) tabIndices.push(match[1]);
    }
    expect(tabIndices).toEqual(["0", "-1"]);
  });

  it("sets roving tabindex to 0 for selected single-choice option", () => {
    const pollWithSelectedOption: PollDetails = {
      ...mockPollSingleChoice,
      responseOptionIds: ["opt-2"],
    };
    const html = renderToString(
      <PollForm busy={false} details={pollWithSelectedOption} onSubmit={vi.fn()} />,
    );

    const radioRegex = /<button[^>]*role="radio"[^>]*tabindex="([^"]*)"/g;
    const tabIndices: string[] = [];
    let match;
    while ((match = radioRegex.exec(html)) !== null) {
      if (match[1] !== undefined) tabIndices.push(match[1]);
    }
    expect(tabIndices).toEqual(["-1", "0"]);
  });

  it("renders checkbox options with tabindex 0 and pre-selected vote with enabled submit button", () => {
    const html = renderToString(
      <PollForm busy={false} details={mockPollMultipleChoiceWithVote} onSubmit={vi.fn()} />,
    );

    expect(html).not.toContain('role="radiogroup"');
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("Update Vote");
    expect(html).not.toContain("disabled=");
  });
});
