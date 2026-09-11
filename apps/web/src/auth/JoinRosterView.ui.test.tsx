import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JoinRosterView } from "./JoinRosterView";
import * as api from "../api";

vi.mock("../api", async () => {
  const actual = await vi.importActual("../api");
  return {
    ...actual,
    getCurrentSession: vi.fn(),
    getRosterInviteOptions: vi.fn(),
    previewRosterInvite: vi.fn(),
    redeemRosterInvite: vi.fn(),
    signInWithCode: vi.fn(),
    startRosterInvite: vi.fn(),
  };
});

describe("JoinRosterView UI", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("shows error when no token is present in hash or query", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hash: "",
        search: "",
      },
    });

    render(<JoinRosterView />);
    expect(screen.getByText("Invite link unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("No invite link token was provided. Please check the link from your choir."),
    ).toBeInTheDocument();
  });

  it("allows anonymous user to submit email, enter verification OTP, and complete registration", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hash: "#token=valid-test-token-123",
        search: "",
      },
    });

    vi.mocked(api.previewRosterInvite).mockResolvedValue({
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      logoFileId: null,
      organizationName: "City Chamber Choir",
      organizationSlug: "city-choir",
      requestId: "req-preview",
    });

    vi.mocked(api.getCurrentSession).mockResolvedValue(null);

    vi.mocked(api.startRosterInvite).mockResolvedValue({
      requestId: "req-start",
      status: "code_sent",
    });

    vi.mocked(api.signInWithCode).mockResolvedValue();

    vi.mocked(api.getRosterInviteOptions).mockResolvedValue({
      alreadyEnrolled: false,
      existingProfile: null,
      organizationName: "City Chamber Choir",
      performerLabel: "Voice Part",
      requestId: "req-options",
      sections: [{ code: "S", color: "#f00", name: "Soprano", trackOnly: false }],
      voiceParts: [{ fullName: "Soprano 1", label: "S1", sectionCode: "S" }],
    });

    vi.mocked(api.redeemRosterInvite).mockResolvedValue({
      enrollmentId: "enrollment-1",
      membershipId: "membership-1",
      profileId: "00000000-0000-0000-0000-000000000001",
      requestId: "req-redeem",
      status: "completed",
    });

    render(<JoinRosterView />);

    // Wait for preview to finish and show email input
    await waitFor(() => {
      expect(screen.getByText("Join City Chamber Choir")).toBeInTheDocument();
      expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    });

    // Enter email
    const emailInput = screen.getByLabelText("Email address");
    await user.type(emailInput, "singer@example.test");
    const sendCodeBtn = screen.getByRole("button", { name: /continue with email/i });
    fireEvent.click(sendCodeBtn);

    await waitFor(() => {
      expect(api.startRosterInvite).toHaveBeenCalledWith(
        "singer@example.test",
        "valid-test-token-123",
      );
      expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
    });

    // Enter OTP
    const otpInput = screen.getByLabelText("Verification code");
    await user.type(otpInput, "654321");
    const confirmBtn = screen.getByRole("button", { name: /confirm code/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(api.signInWithCode).toHaveBeenCalledWith("singer@example.test", "654321");
      expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    });

    // Fill profile
    const nameInput = screen.getByLabelText("Your name");
    await user.type(nameInput, "Jane Singer");

    const joinBtn = screen.getByRole("button", { name: /join roster/i });
    fireEvent.click(joinBtn);

    await waitFor(() => {
      expect(api.redeemRosterInvite).toHaveBeenCalled();
      expect(screen.getByText("Welcome to City Chamber Choir!")).toBeInTheDocument();
    });
  });
});
