import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignInView } from "./SignInView";
import * as googleAuthModule from "./googleAuth";

vi.mock("./googleAuth", async () => {
  const actual = await vi.importActual<typeof googleAuthModule>("./googleAuth");
  return {
    ...actual,
    signInWithGoogle: vi.fn(),
  };
});

describe("SignInView Google UI", () => {
  const originalLocationHref = window.location.href;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.history.pushState({}, "", originalLocationHref);
  });

  it("renders Continue with Google button with accessible name and intro copy", () => {
    render(<SignInView onSignedIn={vi.fn()} />);

    const googleBtn = screen.getByRole("button", { name: "Continue with Google" });
    expect(googleBtn).toBeInTheDocument();
    expect(
      screen.getByText(
        "This site is invitation-only. Passkey is the preferred sign-in method. You can also sign in with Google or an email code, or use an optional password.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("or sign in with email")).toBeInTheDocument();
  });

  it("displays mapped error message and strips error param from URL when error=signup_disabled is present", () => {
    window.history.pushState({}, "", "/login?error=signup_disabled&returnTo=%2Fadmin");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    render(<SignInView onSignedIn={vi.fn()} />);

    expect(
      screen.getByText(
        "This Google account cannot sign in. Use the email address that was invited, or ask an Organization Owner or Administrator for access.",
      ),
    ).toBeInTheDocument();

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/login?returnTo=%2Fadmin");
  });

  it("displays mapped error message when error=account_not_linked is present", () => {
    window.history.pushState({}, "", "/login?error=account_not_linked");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    render(<SignInView onSignedIn={vi.fn()} />);

    expect(
      screen.getByText(
        "Google sign-in is not available for this account yet. Sign in with an email code once to verify your invited email, then you can use Google.",
      ),
    ).toBeInTheDocument();

    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/login");
  });

  it("strips oauth parameter from URL on mount while preserving other parameters", () => {
    window.history.pushState({}, "", "/login?oauth=complete&returnTo=%2Fadmin%2Froster");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    render(<SignInView onSignedIn={vi.fn()} />);

    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/login?returnTo=%2Fadmin%2Froster");
  });

  it("calls signInWithGoogle and handles failure error display", async () => {
    const user = userEvent.setup();
    const signInSpy = vi.mocked(googleAuthModule.signInWithGoogle).mockResolvedValue({
      error: "Unable to complete Google sign-in. Please try again or use another sign-in method.",
      success: false,
    });

    render(<SignInView onSignedIn={vi.fn()} />);

    const googleBtn = screen.getByRole("button", { name: "Continue with Google" });
    await user.click(googleBtn);

    expect(signInSpy).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Unable to complete Google sign-in. Please try again or use another sign-in method.",
        ),
      ).toBeInTheDocument();
    });
  });
});
