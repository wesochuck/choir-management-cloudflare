import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformHomeView } from "./PlatformHomeView";
import { PublicPrivacyPolicyView } from "./PublicPrivacyPolicyView";

vi.mock("../api", () => ({
  getPlatformHomeTickets: vi.fn().mockResolvedValue([]),
  submitPlatformInquiry: vi.fn().mockResolvedValue({ accepted: true, requestId: "123" }),
}));

describe("PublicPrivacyPolicyView (A2P 10DLC Carrier Compliance)", () => {
  const originalTitle = document.title;

  afterEach(() => {
    document.title = originalTitle;
  });

  it("renders Privacy Policy heading and updates document title", () => {
    render(<PublicPrivacyPolicyView />);

    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    expect(screen.getAllByText(/MusicSite \/ Choir Management/)[0]).toBeInTheDocument();
    expect(document.title).toBe("Privacy Policy · MusicSite");

    const returnLink = screen.getByRole("link", { name: "← Return to MusicSite" });
    expect(returnLink).toHaveAttribute("href", "/");
  });

  it("contains carrier-mandated non-marketing disclosures and 10DLC non-sharing language", () => {
    render(<PublicPrivacyPolicyView />);

    // Strict non-marketing scope
    expect(
      screen.getByText(
        /Text messages sent through our platform are exclusively non-marketing and transactional/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /We never send promotional, marketing, advertising, or fundraising messages via text messaging/,
      ),
    ).toBeInTheDocument();

    // Exact non-sharing statement
    expect(
      screen.getByText(
        /No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. All the above categories exclude text messaging originator opt-in data and consent; this information will not be shared with any third parties./,
      ),
    ).toBeInTheDocument();

    // STOP opt-out instructions
    expect(
      screen.getByText(/You may opt out of SMS messages at any time by replying/i),
    ).toBeInTheDocument();
    expect(screen.getByText("STOP")).toBeInTheDocument();

    // HELP support instructions
    expect(screen.getByText(/For Help or Support:/i)).toBeInTheDocument();
    expect(screen.getByText("HELP")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "support@musicsite.org" })[0]).toHaveAttribute(
      "href",
      "mailto:support@musicsite.org",
    );

    // Message frequency & rates
    expect(screen.getByText(/Message and data rates may apply/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Message frequency varies based on your choir’s schedule and seasonal events/i,
      ),
    ).toBeInTheDocument();

    // Carrier non-liability
    expect(
      screen.getByText(/Wireless carriers .* are not liable for delayed or undelivered messages/i),
    ).toBeInTheDocument();
  });

  it("includes privacy policy and support links in PlatformHomeView footer", async () => {
    render(<PlatformHomeView signedIn={false} />);

    await waitFor(() => {
      const privacyLink = screen.getByRole("link", { name: "Privacy Policy" });
      expect(privacyLink).toBeInTheDocument();
      expect(privacyLink).toHaveAttribute("href", "/privacy");
    });

    const supportLink = screen.getByRole("link", { name: "Support" });
    expect(supportLink).toBeInTheDocument();
    expect(supportLink).toHaveAttribute("href", "mailto:support@musicsite.org");
  });
});
