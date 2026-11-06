import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { PlayerRosterInviteBanner } from "./PlayerRosterInviteBanner";

describe("PlayerRosterInviteBanner UI", () => {
  it("renders organization name, exact encouragement copy, and action buttons", () => {
    const onDismiss = vi.fn();
    const onSignUp = vi.fn();

    render(
      <PlayerRosterInviteBanner
        onDismiss={onDismiss}
        onSignUp={onSignUp}
        organizationName="Cantate Chamber Choir"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Singing with Cantate Chamber Choir?" }),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "Register for a free account to save your voice part preference across devices, view rehearsal schedules, and RSVP to concerts.",
      ),
    ).toBeInTheDocument();

    const signUpButton = screen.getByRole("button", { name: "Sign Up" });
    expect(signUpButton).toBeInTheDocument();
    fireEvent.click(signUpButton);
    expect(onSignUp).toHaveBeenCalledTimes(1);

    const dismissButton = screen.getByRole("button", { name: "Maybe later" });
    expect(dismissButton).toBeInTheDocument();
    fireEvent.click(dismissButton);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("falls back to generic choir name when organizationName is omitted", () => {
    render(<PlayerRosterInviteBanner onDismiss={vi.fn()} onSignUp={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Singing with your choir?" })).toBeInTheDocument();
  });
});
