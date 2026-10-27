import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentAuthSession } from "@choir/contracts";

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

  const signedInSession: NonNullable<CurrentAuthSession> = {
    session: {
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      id: "session-existing-profile",
      updatedAt: new Date().toISOString(),
      userId: "user-existing-profile",
    },
    user: {
      createdAt: new Date().toISOString(),
      email: "singer@example.test",
      emailVerified: true,
      id: "user-existing-profile",
      name: "Morgan Reed",
      twoFactorEnabled: false,
      updatedAt: new Date().toISOString(),
    },
  };

  const matchedOptions = {
    alreadyEnrolled: false,
    existingProfile: null,
    matchingProfile: { displayName: "Morgan Reed", voicePart: "Bass 1" },
    profileMatchStatus: "matched" as const,
    organizationName: "City Chamber Choir",
    performerLabel: "Voice Part",
    rosterStructure: "sections_with_parts" as const,
    requestId: "req-matched-profile",
    sections: [{ code: "B", color: "#00f", name: "Bass", trackOnly: false }],
    voiceParts: [{ fullName: "Bass 1", label: "B1", sectionCode: "B" }],
  };

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

  it.each([undefined, "sections_only"] as const)(
    "allows anonymous registration with roster structure %s",
    async (rosterStructure) => {
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
        matchingProfile: null,
        profileMatchStatus: "no_match",
        organizationName: "City Chamber Choir",
        performerLabel: "Voice Part",
        rosterStructure,
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
        expect(
          screen.getByLabelText(rosterStructure === "sections_only" ? "Section" : "Voice Part"),
        ).toBeInTheDocument();
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
    },
  );

  it("connects a verified account to its matching roster profile", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hash: "#token=valid-test-token-123", search: "" },
    });
    vi.mocked(api.previewRosterInvite).mockResolvedValue({
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      logoFileId: null,
      organizationName: "City Chamber Choir",
      organizationSlug: "city-choir",
      requestId: "req-preview",
    });
    vi.mocked(api.getCurrentSession).mockResolvedValue(signedInSession);
    vi.mocked(api.getRosterInviteOptions).mockResolvedValue(matchedOptions);
    vi.mocked(api.redeemRosterInvite).mockResolvedValue({
      enrollmentId: "enrollment-existing",
      membershipId: "membership-existing",
      profileId: "00000000-0000-0000-0000-000000000001",
      requestId: "req-redeem-existing",
      status: "completed",
    });

    render(<JoinRosterView />);

    expect(
      await screen.findByText(/connect your account to your existing roster profile/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Morgan Reed")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Voice Part")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Join with existing profile" }));

    await waitFor(() => {
      expect(api.redeemRosterInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "Morgan Reed",
          phone: "",
          showInDirectory: true,
          token: "valid-test-token-123",
          voicePart: "Bass 1",
        }),
      );
      expect(
        screen.getByText(/existing roster Profile and history were preserved/i),
      ).toBeInTheDocument();
    });
  });

  it("shows a review state and rechecks after an administrator resolves the roster match", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hash: "#token=valid-test-token-123", search: "" },
    });
    vi.mocked(api.previewRosterInvite).mockResolvedValue({
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      logoFileId: null,
      organizationName: "City Chamber Choir",
      organizationSlug: "city-choir",
      requestId: "req-preview",
    });
    vi.mocked(api.getCurrentSession).mockResolvedValue(signedInSession);
    vi.mocked(api.getRosterInviteOptions)
      .mockResolvedValueOnce({
        ...matchedOptions,
        matchingProfile: null,
        profileMatchStatus: "review_required",
      })
      .mockResolvedValueOnce(matchedOptions);

    render(<JoinRosterView />);

    expect(
      await screen.findByRole("heading", { name: "Ask an Organization administrator for help" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "We found a roster record that needs review before this invitation can be completed.",
    );
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check again" }));

    expect(
      await screen.findByText(/connect your account to your existing roster profile/i),
    ).toBeInTheDocument();
    expect(api.getRosterInviteOptions).toHaveBeenCalledTimes(2);
  });
});
