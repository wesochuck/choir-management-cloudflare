import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformHomeTicketListing } from "@choir/contracts";
import { PlatformHomeView } from "./PlatformHomeView";
import * as api from "../api";

vi.mock("../api", () => ({
  getPlatformHomeTickets: vi.fn(),
  submitPlatformInquiry: vi.fn(),
}));

const mockListing: PlatformHomeTicketListing = {
  eventId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Lancaster Community Chorus",
  startsAt: "2026-11-15T19:30:00.000Z",
  ticketsUrl: "https://tickets.lancasterchorus.org/tickets/11111111-1111-4111-8111-111111111111",
  timezone: "America/New_York",
  title: "Winter Masterworks",
  venueName: "Fairfield County Heritage Hall",
};

describe("PlatformHomeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getPlatformHomeTickets).mockResolvedValue([mockListing]);
    vi.mocked(api.submitPlatformInquiry).mockResolvedValue({
      accepted: true,
      requestId: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("renders Upcoming performances and For community choirs action links for anonymous users", async () => {
    render(<PlatformHomeView signedIn={false} />);

    const performancesLink = screen.getByRole("link", { name: "Upcoming performances" });
    expect(performancesLink).toBeInTheDocument();
    expect(performancesLink).toHaveAttribute("href", "#upcoming-performances");

    const choirsLink = screen.getByRole("link", { name: "For community choirs" });
    expect(choirsLink).toBeInTheDocument();
    expect(choirsLink).toHaveAttribute("href", "#community-choirs");

    // Does not offer member sign in to anonymous visitors
    expect(screen.queryByRole("link", { name: "Member sign in" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Already a member?" })).toBeNull();

    await waitFor(() => {
      expect(screen.getByText("Winter Masterworks")).toBeInTheDocument();
    });
  });

  it("renders Open your workspace linking to /account for authenticated users", async () => {
    render(<PlatformHomeView signedIn={true} />);

    const workspaceLink = screen.getByRole("link", { name: "Open your workspace" });
    expect(workspaceLink).toBeInTheDocument();
    expect(workspaceLink).toHaveAttribute("href", "/account");

    await waitFor(() => {
      expect(screen.getByText("Winter Masterworks")).toBeInTheDocument();
    });
  });

  it("does not render generic links to /join-roster or /player", async () => {
    const { container } = render(<PlatformHomeView signedIn={false} />);

    expect(container.querySelector('a[href="/join-roster"]')).toBeNull();
    expect(container.querySelector('a[href^="/join-roster"]')).toBeNull();
    expect(container.querySelector('a[href="/player"]')).toBeNull();
    expect(container.querySelector('a[href^="/player"]')).toBeNull();

    await waitFor(() => {
      expect(screen.getByText("Winter Masterworks")).toBeInTheDocument();
    });
  });

  it("provides clear member guidance to use unique choir-provided links", async () => {
    render(<PlatformHomeView signedIn={false} />);

    expect(
      screen.getByText(
        /Have an invitation or practice-player link\? Use the unique link provided by your choir\./i,
      ),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Winter Masterworks")).toBeInTheDocument();
    });
  });

  it("renders upcoming ticket listings without emoji and links directly to tickets", async () => {
    render(<PlatformHomeView signedIn={false} />);

    await waitFor(() => {
      expect(screen.getByText("Winter Masterworks")).toBeInTheDocument();
    });

    expect(screen.getByText("Lancaster Community Chorus")).toBeInTheDocument();
    expect(screen.getByText("Fairfield County Heritage Hall")).toBeInTheDocument();
    // Check that emoji location pins are not present
    expect(screen.queryByText(/📍/)).toBeNull();

    const ticketButton = screen.getByRole("link", { name: "Tickets & details" });
    expect(ticketButton).toHaveAttribute("href", mockListing.ticketsUrl);
  });

  it("handles ticket empty and error states gracefully", async () => {
    vi.mocked(api.getPlatformHomeTickets).mockResolvedValueOnce([]);
    const { unmount } = render(<PlatformHomeView signedIn={false} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          /No public ticketed events are currently scheduled across associated choirs\./i,
        ),
      ).toBeInTheDocument();
    });

    unmount();

    vi.mocked(api.getPlatformHomeTickets).mockRejectedValueOnce(new Error("Network error"));
    render(<PlatformHomeView signedIn={false} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Performance feed is temporarily unavailable\. Check back soon\./i),
      ).toBeInTheDocument();
    });
  });

  it("labels inquiry fields, submits successfully, and displays accessible confirmation", async () => {
    const user = userEvent.setup();
    render(<PlatformHomeView signedIn={false} />);

    expect(screen.getByRole("heading", { name: "For community choirs." })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Organization Name \*/i), "Buckeye Choral Guild");
    await user.type(screen.getByLabelText(/Contact Name \*/i), "John Doe");
    await user.type(screen.getByLabelText(/Email Address \*/i), "john@buckeye.org");
    await user.type(screen.getByLabelText(/Location in Fairfield County/i), "Lancaster, OH");
    await user.type(screen.getByLabelText(/Message & details/i), "We are looking for a platform.");

    const submitBtn = screen.getByRole("button", { name: "Send inquiry to admins" });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText("Thank you! Your inquiry was sent to the platform administrators."),
      ).toBeInTheDocument();
    });

    expect(api.submitPlatformInquiry).toHaveBeenCalledWith({
      contactName: "John Doe",
      email: "john@buckeye.org",
      location: "Lancaster, OH",
      message: "We are looking for a platform.",
      organizationName: "Buckeye Choral Guild",
      website: "",
    });

    // Resetting form returns to inputs
    await user.click(screen.getByRole("button", { name: "Send another inquiry" }));
    expect(screen.getByLabelText(/Organization Name \*/i)).toBeInTheDocument();
  });

  it("displays accessible error notice when inquiry submission fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.submitPlatformInquiry).mockRejectedValueOnce(
      new Error("Inquiry submission rate limit exceeded"),
    );

    render(<PlatformHomeView signedIn={false} />);

    await user.type(screen.getByLabelText(/Organization Name \*/i), "Choir");
    await user.type(screen.getByLabelText(/Contact Name \*/i), "Jane");
    await user.type(screen.getByLabelText(/Email Address \*/i), "jane@choir.org");
    await user.click(screen.getByRole("button", { name: "Send inquiry to admins" }));

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Inquiry submission rate limit exceeded");
    });
  });

  it("consistently uses Choir Management branding and never mentions MusicSite", async () => {
    const { container } = render(<PlatformHomeView signedIn={false} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Choir Management");
    expect(container.textContent).not.toContain("MusicSite");

    await waitFor(() => {
      expect(screen.getByText("Winter Masterworks")).toBeInTheDocument();
    });
  });
});
