import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformHomeView } from "./PlatformHomeView";
import { PublicTermsView } from "./PublicTermsView";

vi.mock("../api", () => ({
  getPlatformHomeTickets: vi.fn().mockResolvedValue([]),
  submitPlatformInquiry: vi.fn().mockResolvedValue({ accepted: true, requestId: "123" }),
}));

describe("PublicTermsView (A2P 10DLC Carrier Compliance)", () => {
  const originalTitle = document.title;

  afterEach(() => {
    document.title = originalTitle;
  });

  it("renders Terms of Service heading and updates document title", () => {
    render(<PublicTermsView />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Terms of Service & Messaging Terms" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/MusicSite \/ Choir Management/)[0]).toBeInTheDocument();
    expect(document.title).toBe("Terms of Service · MusicSite");

    const returnLink = screen.getByRole("link", { name: "← Return to MusicSite" });
    expect(returnLink).toHaveAttribute("href", "/");
  });

  it("contains carrier-mandated messaging terms and A2P 10DLC disclosures", () => {
    render(<PublicTermsView />);

    // Strict non-marketing scope
    expect(
      screen.getByText(
        /Text messages sent through our platform are strictly non-marketing and transactional/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /We never send promotional, marketing, advertising, or fundraising messages via text messaging/,
      ),
    ).toBeInTheDocument();

    // STOP opt-out instructions
    expect(
      screen.getByText(/You may cancel text notifications at any time by replying/i),
    ).toBeInTheDocument();
    expect(screen.getByText("STOP")).toBeInTheDocument();

    // HELP support instructions
    expect(screen.getByText(/For Customer Support:/i)).toBeInTheDocument();
    expect(screen.getByText("HELP")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "support@musicsite.org" })[0]).toHaveAttribute(
      "href",
      "mailto:support@musicsite.org",
    );

    // Message frequency & rates
    expect(screen.getByText(/Message and data rates may apply/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Message frequency varies based on your choir’s schedule, rehearsal calendar, and active performance periods/i,
      ),
    ).toBeInTheDocument();

    // Carrier non-liability
    expect(
      screen.getByText(/Wireless carriers .* are not liable for delayed or undelivered messages/i),
    ).toBeInTheDocument();

    // Mobile data privacy statement
    expect(
      screen.getByText(
        /Your mobile phone number and SMS consent will not be sold, rented, or shared with third parties or affiliates for marketing or promotional purposes/,
      ),
    ).toBeInTheDocument();
  });

  it("includes Terms of Service link in PlatformHomeView footer", async () => {
    render(<PlatformHomeView signedIn={false} />);

    await waitFor(() => {
      const termsLink = screen.getByRole("link", { name: "Terms of Service" });
      expect(termsLink).toBeInTheDocument();
      expect(termsLink).toHaveAttribute("href", "/terms");
    });
  });
});
