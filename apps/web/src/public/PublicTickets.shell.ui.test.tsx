import { futureIsoDate } from "@choir/testkit";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import type { PublishedOrganizationProjection } from "@choir/contracts";
import type * as AuthApiModule from "../auth/api";
import {
  getPublicCommerceProjection,
  getPublicTransactionFeeSettings,
  getPublishedOrganizationProjection,
} from "../auth/api";
import { PublicTickets } from "./PublicTickets";
import { feeSettings } from "./PublicTickets.ui.fixture";

vi.mock("../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof AuthApiModule>();
  return {
    ...actual,
    createPublicTicketCheckout: vi.fn(),
    getPublicCommerceProjection: vi.fn().mockResolvedValue(null),
    getPublicTicketConfirmationSettings: vi.fn(),
    getPublicTicketDiscountAvailability: vi.fn().mockResolvedValue({ hasRedeemableCode: false }),
    getPublicTicketPurchase: vi.fn(),
    getPublicTransactionFeeSettings: vi.fn(),
    getPublishedOrganizationProjection: vi.fn().mockResolvedValue(null),
    quotePublicTicketCheckout: vi.fn(),
  };
});

describe("PublicTickets shell layout", () => {
  const sampleProjection: PublishedOrganizationProjection = {
    generatedAt: "2026-09-20T00:00:00Z",
    organizationId: "org-1",
    payload: {
      mediaFileIds: [],
      organizationName: "Lancaster Community Chorus",
      performances: [
        {
          advancePriceCents: 1500,
          dayOfPriceCents: 2000,
          doorsOpenTime: "14:30",
          graphicFileId: null,
          id: "74e47064-75b9-47e9-97e6-c28f5430bee0",
          isTicketingEnabled: true,
          location: "Concert Hall",
          publicDetails: "Spring Concert details",
          startsAt: "2027-03-07T15:00:00Z",
          ticketCapacity: 100,
          title: "Spring Concert",
          venueAddress: "123 Concert Way",
          venueName: "Concert Hall",
        },
      ],
      settings: {
        aboutUsText: "",
        bodyFont: "system",
        contactEmail: "info@example.test",
        enabledNavigation: ["tickets"],
        headerFont: "system",
        heroFileId: null,
        heroHeadline: "LCC",
        heroSubtitle: "",
        historyText: "",
        logoFileId: null,
        showBrandingHeaderFooter: false,
      },
      ticketBundles: [],
      timezone: "America/New_York",
    },
    version: 1,
  };

  it("renders standalone transaction layout by default with no general site navigation on /tickets", async () => {
    vi.mocked(getPublishedOrganizationProjection).mockResolvedValue(sampleProjection);
    vi.mocked(getPublicTransactionFeeSettings).mockResolvedValue(feeSettings);

    render(<PublicTickets pathname="/tickets" />);

    expect(await screen.findByRole("heading", { name: "Tickets" })).toBeInTheDocument();
    expect(screen.getByText("Lancaster Community Chorus")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Buy tickets" })).toBeInTheDocument();

    // Standalone shell does not show general website navigation or sign in
    expect(screen.queryByRole("navigation", { name: "Public website" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Performances" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "History" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("renders standalone transaction layout on a ticket detail route", async () => {
    vi.mocked(getPublishedOrganizationProjection).mockResolvedValue(sampleProjection);
    vi.mocked(getPublicTransactionFeeSettings).mockResolvedValue(feeSettings);

    render(<PublicTickets pathname="/tickets/74e47064-75b9-47e9-97e6-c28f5430bee0" />);

    expect(await screen.findByRole("heading", { name: "Spring Concert" })).toBeInTheDocument();
    expect(screen.getByText("Lancaster Community Chorus")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to secure payment" })).toBeInTheDocument();

    // Standalone shell on detail page does not show general navigation
    expect(screen.queryByRole("navigation", { name: "Public website" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Performances" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "History" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("renders closed notice when event performance date is in the past", async () => {
    const basePerformance = sampleProjection.payload.performances[0];
    if (!basePerformance) throw new Error("Expected sample performance");
    const pastProjection: PublishedOrganizationProjection = {
      ...sampleProjection,
      payload: {
        ...sampleProjection.payload,
        performances: [
          {
            ...basePerformance,
            startsAt: "2020-01-01T19:00:00Z",
          },
        ],
      },
    };
    vi.mocked(getPublishedOrganizationProjection).mockResolvedValue(pastProjection);
    vi.mocked(getPublicTransactionFeeSettings).mockResolvedValue(feeSettings);

    render(<PublicTickets pathname="/tickets/74e47064-75b9-47e9-97e6-c28f5430bee0" />);

    expect(
      await screen.findByText("Ticket sales are closed for this performance."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue to secure payment" }),
    ).not.toBeInTheDocument();
  });

  it("reopens ticket sales when live commerce projection reflects a future rescheduled date even if published projection was stale/past", async () => {
    const basePerformance = sampleProjection.payload.performances[0];
    if (!basePerformance) throw new Error("Expected sample performance");
    const stalePublishedProjection: PublishedOrganizationProjection = {
      ...sampleProjection,
      payload: {
        ...sampleProjection.payload,
        performances: [
          {
            ...basePerformance,
            startsAt: "2020-01-01T19:00:00Z",
          },
        ],
      },
    };
    const liveCommerceProjection: PublishedOrganizationProjection = {
      ...sampleProjection,
      payload: {
        ...sampleProjection.payload,
        performances: [
          {
            ...basePerformance,
            startsAt: "2028-10-15T19:00:00Z",
          },
        ],
      },
    };
    vi.mocked(getPublishedOrganizationProjection).mockResolvedValue(stalePublishedProjection);
    vi.mocked(getPublicCommerceProjection).mockResolvedValue(liveCommerceProjection);
    vi.mocked(getPublicTransactionFeeSettings).mockResolvedValue(feeSettings);

    render(<PublicTickets pathname="/tickets/74e47064-75b9-47e9-97e6-c28f5430bee0" />);

    expect(await screen.findByRole("heading", { name: "Spring Concert" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to secure payment" })).toBeInTheDocument();
    expect(
      screen.queryByText("Ticket sales are closed for this performance."),
    ).not.toBeInTheDocument();
  });

  it("renders full organization layout with navigation when showBrandingHeaderFooter is true, marking Tickets as current", async () => {
    const brandedProjection: PublishedOrganizationProjection = {
      ...sampleProjection,
      payload: {
        ...sampleProjection.payload,
        settings: {
          ...sampleProjection.payload.settings,
          enabledNavigation: ["tickets"],
          historyText: "Lancaster Community Chorus was founded in 1995.",
          showBrandingHeaderFooter: true,
        },
      },
    };
    vi.mocked(getPublishedOrganizationProjection).mockResolvedValue(brandedProjection);
    vi.mocked(getPublicTransactionFeeSettings).mockResolvedValue(feeSettings);

    render(<PublicTickets pathname="/tickets" />);

    expect(await screen.findByRole("heading", { name: "Tickets" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Public website" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Performances" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();

    const ticketsLink = screen.getByRole("link", { name: "Tickets" });
    expect(ticketsLink).toHaveAttribute("aria-current", "page");
    expect(ticketsLink).toHaveClass("is-active");
  });

  it("marks Tickets link as current on ticket detail route when showBrandingHeaderFooter is true", async () => {
    const brandedProjection: PublishedOrganizationProjection = {
      ...sampleProjection,
      payload: {
        ...sampleProjection.payload,
        settings: {
          ...sampleProjection.payload.settings,
          enabledNavigation: ["tickets"],
          showBrandingHeaderFooter: true,
        },
      },
    };
    vi.mocked(getPublishedOrganizationProjection).mockResolvedValue(brandedProjection);
    vi.mocked(getPublicTransactionFeeSettings).mockResolvedValue(feeSettings);

    render(<PublicTickets pathname="/tickets/74e47064-75b9-47e9-97e6-c28f5430bee0" />);

    expect(await screen.findByRole("heading", { name: "Spring Concert" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Public website" });
    expect(nav).toBeInTheDocument();

    const ticketsLink = screen.getByRole("link", { name: "Tickets" });
    expect(ticketsLink).toHaveAttribute("aria-current", "page");
    expect(ticketsLink).toHaveClass("is-active");
  });

  it("falls back to commerce projection when published organization projection is null without requiring published website", async () => {
    vi.mocked(getPublishedOrganizationProjection).mockResolvedValue(null);
    vi.mocked(getPublicCommerceProjection).mockResolvedValue(sampleProjection);
    vi.mocked(getPublicTransactionFeeSettings).mockResolvedValue(feeSettings);

    render(<PublicTickets pathname="/tickets" />);

    expect(await screen.findByRole("heading", { name: "Tickets" })).toBeInTheDocument();
    expect(screen.getByText("Spring Concert")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Public website" })).not.toBeInTheDocument();
  });

  it("enabledNavigation does not independently cause hosted navigation to appear when showBrandingHeaderFooter is false", async () => {
    const unbrandedWithNavProjection: PublishedOrganizationProjection = {
      ...sampleProjection,
      payload: {
        ...sampleProjection.payload,
        settings: {
          ...sampleProjection.payload.settings,
          enabledNavigation: ["tickets", "donations", "auditions"],
          showBrandingHeaderFooter: false,
        },
      },
    };
    vi.mocked(getPublishedOrganizationProjection).mockResolvedValue(unbrandedWithNavProjection);
    vi.mocked(getPublicTransactionFeeSettings).mockResolvedValue(feeSettings);

    render(<PublicTickets pathname="/tickets" />);

    expect(await screen.findByRole("heading", { name: "Tickets" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Public website" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Performances" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Donate" })).not.toBeInTheDocument();
  });

  it.each(["removed", "expired", "available", "fallback"])(
    "suggests only currently offered bundles (%s)",
    async (status) => {
      const original = sampleProjection.payload.performances[0];
      if (!original) throw new Error("Missing fixture performance");
      const event = {
        ...original,
        id: "11111111-1111-4111-8111-111111111111",
        title: "Current concert",
        startsAt: futureIsoDate({ days: 30 }),
      };
      const bundle = {
        id: "22222222-2222-4222-8222-222222222222",
        ticketSlug: "season-pass",
        title: "Season pass",
        priceCents: 3000,
        capacity: null,
        graphicFileId: null,
        eventIds: [event.id],
        saleEndAt: futureIsoDate({ days: 20 }),
      };
      const published = {
        ...sampleProjection,
        payload: { ...sampleProjection.payload, performances: [event], ticketBundles: [bundle] },
      };
      const commerce = {
        ...published,
        payload: {
          ...published.payload,
          ticketBundles:
            status === "removed"
              ? []
              : [
                  {
                    ...bundle,
                    saleEndAt:
                      status === "expired"
                        ? new Date(Date.now() - 1).toISOString()
                        : bundle.saleEndAt,
                  },
                ],
        },
      };
      vi.mocked(getPublishedOrganizationProjection).mockResolvedValue(published);
      if (status === "fallback")
        vi.mocked(getPublicCommerceProjection).mockRejectedValue(new Error("Commerce unavailable"));
      else vi.mocked(getPublicCommerceProjection).mockResolvedValue(commerce);
      vi.mocked(getPublicTransactionFeeSettings).mockResolvedValue(feeSettings);
      render(<PublicTickets pathname={`/tickets/${event.id}`} />);
      await screen.findByRole("heading", { name: "Current concert" });
      if (status === "available" || status === "fallback")
        expect(screen.getByRole("link", { name: "View season pass: Season pass" })).toHaveAttribute(
          "href",
          "/tickets/bundles/season-pass",
        );
      else expect(screen.queryByRole("complementary")).toBeNull();
      expect(screen.getByLabelText("Name on order")).toBeVisible();
    },
  );
});
