import type { PublishedOrganizationProjection } from "@choir/contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    generatedAt: new Date().toISOString(),
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
          publicDetails: "[Event information](https://events.example.test/details)",
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
      const viewAll = screen.queryByRole("link", { name: "View all performances" });
      if (pathname === "/") expect(viewAll).toHaveAttribute("href", "/performances");
      else expect(viewAll).not.toBeInTheDocument();
      const freeCard = screen
        .getByRole("heading", { name: "First free appearance" })
        .closest("article");
      if (!freeCard) throw new Error("Expected free performance card");
      expect(freeCard).not.toHaveClass("public-performance-card--linked");
      expect(
        within(freeCard).queryByRole("link", { name: "First free appearance" }),
      ).not.toBeInTheDocument();
      expect(within(freeCard).getByRole("link", { name: "Event information" })).toHaveAttribute(
        "href",
        "https://events.example.test/details",
      );
      expect(screen.queryByText("View performance →")).not.toBeInTheDocument();
      const ticketCard = screen
        .getByRole("heading", { name: "Next ticketed concert" })
        .closest("article");
      if (!ticketCard) throw new Error("Expected ticketed performance card");
      expect(ticketCard).toHaveClass("public-performance-card--linked");
      expect(
        within(ticketCard).getByRole("link", { name: "Next ticketed concert" }),
      ).toHaveAttribute("href", "/tickets/performance-30");
      expect(within(ticketCard).getByText("View tickets →")).toBeInTheDocument();
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
    expect(within(nav).getByRole("link", { name: "Performer login" })).toBeInTheDocument();
  });

  it.each(["Singer", "Musician", "Performer", "Choir Member"])(
    "uses the published %s terminology for the signed-out login link",
    async (performerLabel) => {
      vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(
        createProjection({ performerLabel }),
      );
      render(<PublicOrganizationSite fallback={null} pathname="/" />);
      const nav = await screen.findByRole("navigation", { name: "Public website" });
      expect(within(nav).getByRole("link", { name: `${performerLabel} login` })).toHaveAttribute(
        "href",
        "/login",
      );
      expect(within(nav).queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    },
  );

  it("shows an accessible dashboard link with an account icon when signed in", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(
      createProjection({ performerLabel: "Singer" }),
    );
    render(<PublicOrganizationSite fallback={null} pathname="/" signedIn />);
    const link = await screen.findByRole("link", { name: "My dashboard" });
    expect(link).toHaveAttribute("href", "/login");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(link).not.toHaveTextContent("←");
    expect(screen.queryByRole("link", { name: "Singer login" })).not.toBeInTheDocument();
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

  it("updates document.title with the organization name on home and subpages", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(
      createProjection({
        settings: {
          ...createProjection().payload.settings,
          historyText: "Our story",
        },
      }),
    );

    const { rerender } = render(<PublicOrganizationSite fallback={<p>Fallback</p>} pathname="/" />);

    await screen.findByRole("heading", { name: "Welcome to Our Choir" });
    await waitFor(() => {
      expect(document.title).toBe("City Chorale");
    });

    rerender(<PublicOrganizationSite fallback={<p>Fallback</p>} pathname="/history" />);
    await waitFor(() => {
      expect(document.title).toBe("History · City Chorale");
    });
  });
});

describe.each(["/", "/performances"])("public performance venue links on %s", (pathname) => {
  it.each([
    {
      venueName: "Fairfield Christian Church",
      venueAddress: "1965 N Columbus St, Lancaster, OH",
      location: "Sanctuary",
      label: "Fairfield Christian Church",
      query: "Fairfield Christian Church, 1965 N Columbus St, Lancaster, OH",
    },
    {
      venueName: "Community Hall",
      venueAddress: "",
      location: "100 Main St",
      label: "Community Hall",
      query: "Community Hall, 100 Main St",
    },
    {
      venueName: "Community Hall",
      venueAddress: "",
      location: "Community Hall",
      label: "Community Hall",
      query: "Community Hall",
    },
    {
      venueName: "",
      venueAddress: "",
      location: "Downtown & Main / Park",
      label: "Downtown & Main / Park",
      query: "Downtown & Main / Park",
    },
    {
      venueName: "",
      venueAddress: "123 Main St",
      location: "",
      label: "123 Main St",
      query: "123 Main St",
    },
    { venueName: " ", venueAddress: " ", location: " ", label: "", query: "" },
  ])(
    "links $label to Google Maps when a venue is available",
    async ({ label, query, ...venue }) => {
      const projection = createProjection();
      vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(
        createProjection({
          performances: [
            {
              ...venue,
              id: "11111111-1111-4111-8111-111111111111",
              title: "Free community concert",
              startsAt: new Date(Date.parse(projection.generatedAt) + 86_400_000).toISOString(),
              isTicketingEnabled: false,
              advancePriceCents: 0,
              dayOfPriceCents: 0,
              doorsOpenTime: "",
              graphicFileId: null,
              publicDetails: "Everyone is welcome.",
              ticketCapacity: null,
            },
          ],
        }),
      );
      render(<PublicOrganizationSite fallback={null} pathname={pathname} />);
      const heading = await screen.findByRole("heading", { name: "Free community concert" });
      const card = heading.closest("article");
      if (!card) throw new Error("Expected performance card");
      if (!query) {
        expect(within(card).queryByRole("link")).not.toBeInTheDocument();
        return;
      }
      const link = within(card).getByRole("link", {
        name: `${label} on Google Maps (opens in a new tab)`,
      });
      expect(link).toHaveTextContent(label);
      expect(link).toHaveAttribute(
        "href",
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(within(card).queryByText("View tickets →")).not.toBeInTheDocument();
    },
  );
});

describe("public upcoming and past performance sections", () => {
  const now = Date.parse("2026-10-25T16:00:00.000Z");
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function event(id: string, days: number, isTicketingEnabled = false) {
    return {
      id: id.toLowerCase().replaceAll(" ", "-"),
      title: id,
      startsAt: new Date(now + days * 86_400_000).toISOString(),
      isTicketingEnabled,
      advancePriceCents: 1500,
      dayOfPriceCents: 2000,
      doorsOpenTime: "",
      graphicFileId: null,
      publicDetails: "[Program notes](https://example.test/program)",
      ticketCapacity: null,
      venueName: "Community Hall",
      venueAddress: "123 Main St",
      location: "",
    };
  }

  it("uses current time with old snapshots, preserves upcoming ticket priority, and orders past events newest first", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue({
      ...createProjection({
        performances: [
          event("Older concert", -90, true),
          event("Next free event", 1),
          event("Recent concert", -1, true),
          event("Ticketed concert", 30, true),
          event("Starting now", 0),
        ],
      }),
      generatedAt: new Date(now - 100 * 86_400_000).toISOString(),
    });
    render(<PublicOrganizationSite fallback={null} pathname="/performances" />);
    const upcoming = await screen.findByRole("region", { name: "Upcoming performances" });
    const past = screen.getByRole("region", { name: "Past performances" });
    expect(
      screen.getByText("Join us at an upcoming event, or explore performances from past seasons."),
    ).toBeInTheDocument();
    expect(
      within(upcoming)
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(["Ticketed concert", "Starting now", "Next free event"]);
    expect(
      within(past)
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(["Recent concert", "Older concert"]);
    expect(upcoming.compareDocumentPosition(past) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(upcoming).getByRole("link", { name: "Ticketed concert" })).toHaveAttribute(
      "href",
      "/tickets/ticketed-concert",
    );
    expect(within(past).queryByText("View tickets →")).not.toBeInTheDocument();
    expect(within(past).queryByRole("link", { name: "Recent concert" })).not.toBeInTheDocument();
    expect(within(past).getAllByRole("link", { name: /on Google Maps/ })).toHaveLength(2);
    expect(within(past).getAllByRole("link", { name: "Program notes" })).toHaveLength(2);
  });

  it("shows an upcoming empty message while retaining a past-only archive", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(
      createProjection({ performances: [event("Past concert", -1)] }),
    );
    render(<PublicOrganizationSite fallback={null} pathname="/performances" />);
    const upcoming = await screen.findByRole("region", { name: "Upcoming performances" });
    expect(upcoming).toHaveTextContent("No upcoming performances are currently published.");
    expect(screen.getByRole("region", { name: "Past performances" })).toHaveTextContent(
      "Past concert",
    );
  });

  it("omits the past divider when only upcoming events exist", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(
      createProjection({ performances: [event("Future concert", 1)] }),
    );
    render(<PublicOrganizationSite fallback={null} pathname="/performances" />);
    expect(await screen.findByRole("region", { name: "Upcoming performances" })).toHaveTextContent(
      "Future concert",
    );
    expect(screen.queryByRole("region", { name: "Past performances" })).not.toBeInTheDocument();
  });

  it("shows only the three newest past events on the homepage", async () => {
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(
      createProjection({
        performances: [
          event("Oldest", -100),
          event("Recent", -1),
          event("Third", -3),
          event("Second", -2),
        ],
      }),
    );
    render(<PublicOrganizationSite fallback={null} pathname="/" />);
    await screen.findByRole("heading", { name: "Past Performances" });
    expect(
      screen
        .getAllByRole("article")
        .map((card) => within(card).getByRole("heading", { level: 3 }).textContent),
    ).toEqual(["Recent", "Second", "Third"]);
    expect(screen.queryByRole("heading", { name: "Oldest" })).not.toBeInTheDocument();
  });
});
