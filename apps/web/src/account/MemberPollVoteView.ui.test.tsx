import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { MemberPollVoteView } from "./MemberPollVoteView";

describe("MemberPollVoteView", () => {
  const mockDetails = {
    canSubmit: true,
    description: "Annual general meeting dinner preference",
    expiresAt: "2026-11-01T00:00:00Z",
    multipleChoice: false,
    options: [
      { id: "opt-1", label: "Vegetarian", sortOrder: 0 },
      { id: "opt-2", label: "Salmon", sortOrder: 1 },
    ],
    pollId: "poll-123",
    profileId: "prof-456",
    profileName: "Alex Singer",
    responseOptionIds: [],
    title: "Dinner Choice",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders notice and back button when no token is present", () => {
    const navigate = vi.fn();
    render(<MemberPollVoteView enabled={true} navigate={navigate} pollId="poll-123" search="" />);

    expect(screen.getByRole("heading", { name: "Poll Link Required" })).toBeInTheDocument();
    expect(screen.getByText(/A valid poll link token is required to vote/)).toBeInTheDocument();

    const backButtons = screen.getAllByRole("button", {
      name: /Back to Dashboard|Return to Dashboard/i,
    });
    expect(backButtons.length).toBeGreaterThan(0);
    const [firstBackButton] = backButtons;
    expect(firstBackButton).toBeDefined();
    if (firstBackButton) {
      fireEvent.click(firstBackButton);
    }
    expect(navigate).toHaveBeenCalledWith("/dashboard");
  });

  it("loads and displays poll details when valid token is provided", async () => {
    vi.spyOn(api, "getPublicPollDetails").mockResolvedValueOnce(mockDetails);
    const navigate = vi.fn();

    render(
      <MemberPollVoteView
        enabled={true}
        navigate={navigate}
        pollId="poll-123"
        search="?token=valid-secret-token"
      />,
    );

    expect(screen.getByRole("heading", { name: "Loading Poll…" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Dinner Choice" })).toBeInTheDocument();
    });

    expect(screen.getByText("Annual general meeting dinner preference")).toBeInTheDocument();
    expect(screen.getByText(/Alex Singer/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Vegetarian/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Salmon/ })).toBeInTheDocument();
  });

  it("handles poll submission and allows changing vote", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "getPublicPollDetails").mockResolvedValueOnce(mockDetails);
    const submitSpy = vi.spyOn(api, "submitPublicPollVote").mockResolvedValueOnce(undefined);
    const navigate = vi.fn();

    render(
      <MemberPollVoteView
        enabled={true}
        navigate={navigate}
        pollId="poll-123"
        search="?token=valid-secret-token"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Dinner Choice" })).toBeInTheDocument();
    });

    const option = screen.getByRole("radio", { name: /Salmon/ });
    await user.click(option);

    const submitBtn = screen.getByRole("button", { name: "Submit Vote" });
    await user.click(submitBtn);

    expect(submitSpy).toHaveBeenCalledWith("valid-secret-token", ["opt-2"]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Vote Submitted" })).toBeInTheDocument();
    });
    expect(screen.getByText(/Thank you, Alex Singer/)).toBeInTheDocument();

    const changeVoteBtn = screen.getByRole("button", { name: "Change Vote" });
    await user.click(changeVoteBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Dinner Choice" })).toBeInTheDocument();
    });
  });

  it("displays error state when token fetch fails and supports retry", async () => {
    const getDetailsSpy = vi
      .spyOn(api, "getPublicPollDetails")
      .mockRejectedValueOnce(new Error("invalid_token"))
      .mockResolvedValueOnce(mockDetails);
    const navigate = vi.fn();

    render(
      <MemberPollVoteView
        enabled={true}
        navigate={navigate}
        pollId="poll-123"
        search="?token=expired-token"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Link Not Found" })).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This poll link is invalid or expired. Contact an Organization manager for a new link.",
    );

    const retryBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Dinner Choice" })).toBeInTheDocument();
    });
    expect(getDetailsSpy).toHaveBeenCalledTimes(2);
  });

  it("displays error when token pollId does not match route pollId", async () => {
    vi.spyOn(api, "getPublicPollDetails").mockResolvedValueOnce({
      ...mockDetails,
      pollId: "other-poll-999",
    });
    const navigate = vi.fn();

    render(
      <MemberPollVoteView
        enabled={true}
        navigate={navigate}
        pollId="poll-123"
        search="?token=mismatched-token"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Link Not Found" })).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The poll link does not match the requested poll ID.",
    );
  });
});
