import type { PublishedOrganizationProjection } from "@choir/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../auth/api";
import { PublicOrganizationSite } from "./PublicOrganizationSite";

vi.mock("../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof authApi>();
  return {
    ...actual,
    getPublishedOrganizationProjection: vi.fn(),
  };
});

function createProjection(
  overrides?: Partial<PublishedOrganizationProjection["payload"]>,
): PublishedOrganizationProjection {
  return {
    generatedAt: "2026-10-14T12:00:00.000Z",
    organizationId: "11111111-1111-4111-8111-111111111111",
    payload: {
      mediaFileIds: [],
      organizationName: "City Chorale",
      performances: [],
      settings: {
        aboutUsText: "",
        bodyFont: "system",
        contactEmail: "info@example.test",
        enabledNavigation: [],
        headerFont: "system",
        heroFileId: null,
        heroHeadline: "Welcome to Our Choir",
        heroSubtitle: "Voices united in song.",
        historyText: "",
        logoFileId: null,
        showBrandingHeaderFooter: false,
      },
      ticketBundles: [],
      timezone: "America/New_York",
      ...overrides,
    },
    version: 1,
  };
}

describe("PublicOrganizationSite navigation visibility and honest empty states (#199)", () => {
  beforeEach(() => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockReset();
  });

  it.each(["/", "/performances"])(
    "prioritizes ticketed cards on %s before the homepage limit",
    async (pathname) => {
      const projection = createProjection();
      const performances = [
        { title: "First free appearance", days: 1, isTicketingEnabled: false },
        { title: "Second free appearance", days: 2, isTicketingEnabled: false },
        { title: "Third free appearance", days: 3, isTicketingEnabled: false },
        { title: "Next ticketed concert", days: 30, isTicketingEnabled: true },
        { title: "Later ticketed concert", days: 60, isTicketingEnabled: true },
      ]
        .reverse()
        .map(({ days, ...event }) => ({
          ...event,
          id: `performance-${String(days)}`,
          startsAt: new Date(Date.parse(projection.generatedAt) + days * 86_400_000).toISOString(),
          advancePriceCents: 1500,
          dayOfPriceCents: 2000,
          doorsOpenTime: "",
          graphicFileId: null,
          location: "",
          publicDetails: "",
          ticketCapacity: null,
          venueAddress: "",
          venueName: "",
        }));
      vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(
        createProjection({ performances }),
      );
      render(<PublicOrganizationSite fallback={<p>Fallback</p>} pathname={pathname} />);
      await screen.findByRole("heading", {
        name: pathname === "/" ? "Upcoming Performances" : "Performances",
      });
      const expected = [
        "Next ticketed concert",
        "Later ticketed concert",
        "First free appearance",
        "Second free appearance",
        "Third free appearance",
      ];
      expect(
        screen
          .getAllByRole("article")
          .map((card) => within(card).getByRole("heading", { level: 3 }).textContent),
      ).toEqual(pathname === "/" ? expected.slice(0, 3) : expected);
    },
  );

  it("shows public loading failure instead of an account fallback and can retry", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection)
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(createProjection());
    render(<PublicOrganizationSite fallback={<p>Account fallback</p>} pathname="/" />);
    await screen.findByRole("heading", { name: "Website unavailable" });
    expect(screen.queryByText("Account fallback")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry website" }));
    await screen.findByRole("heading", { name: "Welcome to Our Choir" });
  });

  it("shows a public unavailable page when an Organization hostname has no published website", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(null);
    render(<PublicOrganizationSite fallback={null} pathname="/" />);
    await screen.findByRole("heading", { name: "Website unavailable" });
    expect(screen.getByRole("status")).toHaveTextContent("not available on this address yet");
  });

  it("retains the platform home fallback when no Organization website exists", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(null);
    render(<PublicOrganizationSite fallback={<p>Platform home</p>} pathname="/" />);
    await screen.findByText("Platform home");
  });

  it("suppresses Performances and History navigation links when no content has been published", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(createProjection());

    render(<PublicOrganizationSite fallback={<p>Fallback</p>} pathname="/" />);

    await screen.findByRole("heading", { name: "Welcome to Our Choir" });
    const nav = screen.getByRole("navigation", { name: "Public website" });
    expect(within(nav).queryByRole("link", { name: "Performances" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "History" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows Performances in navigation when performances exist, and History when history text exists", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(
      createProjection({
        performances: [
          {
            advancePriceCents: 2000,
            dayOfPriceCents: 2500,
            doorsOpenTime: "18:30",
            graphicFileId: null,
            id: "22222222-2222-4222-8222-222222222222",
            isTicketingEnabled: true,
            location: "Boston, MA",
            publicDetails: "Spring concert featuring choral masterpieces.",
            startsAt: "2026-12-01T19:00:00.000Z",
            ticketCapacity: 200,
            title: "Winter Gala",
            venueAddress: "301 Massachusetts Ave",
            venueName: "Symphony Hall",
          },
        ],
        settings: {
          aboutUsText: "We love singing.",
          bodyFont: "system",
          contactEmail: "info@example.test",
          enabledNavigation: ["tickets"],
          headerFont: "system",
          heroFileId: null,
          heroHeadline: "Welcome",
          heroSubtitle: "Music for all",
          historyText: "Founded in 1985.",
          logoFileId: null,
          showBrandingHeaderFooter: false,
        },
      }),
    );

    render(<PublicOrganizationSite fallback={<p>Fallback</p>} pathname="/" />);

    await screen.findByRole("heading", { name: "Welcome" });
    const nav = screen.getByRole("navigation", { name: "Public website" });
    expect(within(nav).getByRole("link", { name: "Performances" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "History" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Tickets" })).toBeInTheDocument();
  });

  it("renders honest empty state with contact/about links when directly visiting empty /history", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(
      createProjection({
        settings: {
          aboutUsText: "We are a community choir based in Boston.",
          bodyFont: "system",
          contactEmail: "chorus@example.test",
          enabledNavigation: [],
          headerFont: "system",
          heroFileId: null,
          heroHeadline: "Welcome",
          heroSubtitle: "Singing together",
          historyText: "",
          logoFileId: null,
          showBrandingHeaderFooter: false,
        },
      }),
    );

    render(<PublicOrganizationSite fallback={<p>Fallback</p>} pathname="/history" />);

    await screen.findByRole("heading", { name: "Our History" });
    const emptyNotice = screen.getByLabelText("Unpublished history notice");
    expect(emptyNotice).toHaveTextContent("Our history has not been published yet.");
    expect(screen.getByRole("link", { name: "About Us section" })).toHaveAttribute(
      "href",
      "/#about-us",
    );
    expect(screen.getByRole("link", { name: "Contact us directly" })).toHaveAttribute(
      "href",
      "mailto:chorus@example.test",
    );
    expect(screen.getByRole("link", { name: "Return to home page" })).toHaveAttribute("href", "/");
  });

  it("renders honest empty state when directly visiting empty /performances", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(
      createProjection({
        performances: [],
        settings: {
          aboutUsText: "",
          bodyFont: "system",
          contactEmail: "booking@example.test",
          enabledNavigation: ["tickets"],
          headerFont: "system",
          heroFileId: null,
          heroHeadline: "Welcome",
          heroSubtitle: "",
          historyText: "",
          logoFileId: null,
          showBrandingHeaderFooter: false,
        },
      }),
    );

    render(<PublicOrganizationSite fallback={<p>Fallback</p>} pathname="/performances" />);

    await screen.findByRole("heading", { name: "Performances" });
    const emptyNotice = screen.getByLabelText("No published performances notice");
    expect(emptyNotice).toHaveTextContent(
      "No performances are currently published on our schedule.",
    );
    expect(screen.getByRole("link", { name: "Tickets page" })).toHaveAttribute("href", "/tickets");
    expect(screen.getByRole("link", { name: "reach out to our team" })).toHaveAttribute(
      "href",
      "mailto:booking@example.test",
    );
    expect(screen.getByRole("link", { name: "Return to home page" })).toHaveAttribute("href", "/");
  });

  it("renders welcoming empty note on home page when neither performances nor about us are published", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(createProjection());

    render(<PublicOrganizationSite fallback={<p>Fallback</p>} pathname="/" />);

    await screen.findByRole("heading", { name: "Welcome to Our Choir" });
    expect(
      screen.getByText("Welcome! Our public schedule and choir story are currently being updated."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact us directly" })).toHaveAttribute(
      "href",
      "mailto:info@example.test",
    );
  });

  it("renders Privacy and Terms links in the public site footer", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(createProjection());

    render(<PublicOrganizationSite fallback={<p>Fallback</p>} pathname="/" />);

    await screen.findByRole("heading", { name: "Welcome to Our Choir" });
    const privacyLink = screen.getByRole("link", { name: "Privacy" });
    expect(privacyLink).toBeInTheDocument();
    expect(privacyLink).toHaveAttribute("href", "/privacy");

    const termsLink = screen.getByRole("link", { name: "Terms" });
    expect(termsLink).toBeInTheDocument();
    expect(termsLink).toHaveAttribute("href", "/terms");
  });
});
