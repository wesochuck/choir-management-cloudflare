import type { MemberDashboardResponse } from "@choir/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../auth/api";
import { DashboardView } from "./DashboardView";

describe("DashboardView", () => {
  const mockDashboard: MemberDashboardResponse = {
    activeSeason: null,
    activeSeasonState: "ready",
    bulletins: [],
    bulletinsState: "ready",
    events: [],
    modules: [],
    organizationName: "Test Chorus",
    performerLabel: "Singer",
    polls: [
      {
        expiresAt: "2026-11-01T00:00:00Z",
        id: "poll-uuid-1",
        linkToken: "token-secret-abc",
        title: "Spring Repertoire Survey",
      },
    ],
    pollsState: "ready",
    profile: {
      displayName: "Pat Singer",
      id: "profile-1",
      voicePart: "Tenor",
    },
    profileLinkRequired: false,
    requestId: "req-1",
    resources: [],
    resourcesState: "ready",
    timezone: "America/New_York",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("navigates to in-shell /member/polls/:id when active poll is clicked", async () => {
    vi.spyOn(authApi, "getMemberDashboard").mockResolvedValueOnce(mockDashboard);
    const navigate = vi.fn();

    render(<DashboardView accessStatus="ready" enabled={true} navigate={navigate} />);

    await waitFor(() => {
      expect(screen.getByText("Spring Repertoire Survey")).toBeInTheDocument();
    });

    const pollLink = screen.getByRole("link", { name: "Spring Repertoire Survey" });
    expect(pollLink).toHaveAttribute("href", "/member/polls/poll-uuid-1?token=token-secret-abc");

    fireEvent.click(pollLink);
    expect(navigate).toHaveBeenCalledWith("/member/polls/poll-uuid-1?token=token-secret-abc");
  });
});
