import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "./api";
import { EmailChangeConfirmationView } from "./EmailChangeConfirmationView";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof authApi>();
  return {
    ...actual,
    confirmMemberEmailChange: vi.fn(),
  };
});

describe("EmailChangeConfirmationView (#198)", () => {
  beforeEach(() => {
    vi.mocked(authApi.confirmMemberEmailChange).mockReset();
  });

  it("renders invalid notice when token is missing or malformed", () => {
    render(<EmailChangeConfirmationView token={null} />);

    expect(screen.getByRole("heading", { name: "Confirm your email address" })).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "This email change link is invalid, expired, or has already been used.",
    );
    expect(screen.getByRole("link", { name: "Return to your Profile" })).toHaveAttribute(
      "href",
      "/profile",
    );
    expect(authApi.confirmMemberEmailChange).not.toHaveBeenCalled();
  });

  it("renders success notice and email when token confirmation succeeds", async () => {
    vi.mocked(authApi.confirmMemberEmailChange).mockResolvedValue({
      email: "new.member@example.test",
      status: "confirmed",
    });

    render(<EmailChangeConfirmationView token="valid-token-1234567890abcdef" />);

    expect(authApi.confirmMemberEmailChange).toHaveBeenCalledWith("valid-token-1234567890abcdef");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Your sign-in email is now new.member@example.test. We sent confirmation notices to both addresses.",
      );
    });
    expect(screen.getByRole("link", { name: "Return to your Profile" })).toHaveAttribute(
      "href",
      "/profile",
    );
  });

  it("renders error notice when confirmation is rejected by server", async () => {
    vi.mocked(authApi.confirmMemberEmailChange).mockRejectedValue(new Error("Expired token"));

    render(<EmailChangeConfirmationView token="expired-token-1234567890abcdef" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This email change link is invalid, expired, or has already been used. Request a new link from your Profile if you still need to change your email.",
    );
    expect(screen.getByRole("link", { name: "Return to your Profile" })).toHaveAttribute(
      "href",
      "/profile",
    );
  });
});
