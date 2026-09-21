import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import type { PublishedOrganizationProjection, TransactionFeeSettings } from "@choir/contracts";
import { TicketBundlePurchaseForm, TicketsContent } from "./PublicTickets";

vi.mock("../auth/api", () => ({
  createPublicTicketCheckout: vi.fn(),
  getPublicCommerceProjection: vi.fn(),
  getPublicTicketConfirmationSettings: vi.fn(),
  getPublicTicketDiscountAvailability: vi.fn().mockResolvedValue({ hasRedeemableCode: false }),
  getPublicTicketPurchase: vi.fn(),
  getPublicTransactionFeeSettings: vi.fn(),
  getPublishedOrganizationProjection: vi.fn(),
  quotePublicTicketCheckout: vi.fn(),
}));

const feeSettings: TransactionFeeSettings = {
  fixedCents: 30,
  passFeeToDonor: false,
  percentage: 2.9,
};

describe("TicketBundlePurchaseForm", () => {
  it("renders included concerts in chronological order with the soonest at the top in a bulleted list", async () => {
    const projection: PublishedOrganizationProjection = {
      generatedAt: "2026-09-20T00:00:00Z",
      organizationId: "org-1",
      payload: {
        mediaFileIds: [],
        organizationName: "LCC",
        performances: [
          {
            advancePriceCents: 1500,
            dayOfPriceCents: 2000,
            doorsOpenTime: "14:30",
            graphicFileId: null,
            id: "event-lullaby",
            isTicketingEnabled: true,
            location: "Concert Hall",
            publicDetails: "",
            startsAt: "2027-03-07T15:00:00Z",
            ticketCapacity: 100,
            title: "Lullaby of Broadway",
            venueName: "Concert Hall",
          },
          {
            advancePriceCents: 1500,
            dayOfPriceCents: 2000,
            doorsOpenTime: "14:30",
            graphicFileId: null,
            id: "event-earth",
            isTicketingEnabled: true,
            location: "Concert Hall",
            publicDetails: "",
            startsAt: "2026-11-15T15:00:00Z",
            ticketCapacity: 100,
            title: "Earth and Sky and Sea",
            venueName: "Concert Hall",
          },
          {
            advancePriceCents: 1500,
            dayOfPriceCents: 2000,
            doorsOpenTime: "14:30",
            graphicFileId: null,
            id: "event-70s",
            isTicketingEnabled: true,
            location: "Concert Hall",
            publicDetails: "",
            startsAt: "2027-06-13T15:00:00Z",
            ticketCapacity: 100,
            title: "Singing the 70s",
            venueName: "Concert Hall",
          },
        ],
        settings: {
          aboutUsText: "",
          bodyFont: "system",
          contactEmail: "",
          enabledNavigation: ["tickets"],
          headerFont: "system",
          heroFileId: null,
          heroHeadline: "LCC",
          heroSubtitle: "",
          historyText: "",
          logoFileId: null,
          showBrandingHeaderFooter: false,
        },
        ticketBundles: [
          {
            capacity: 50,
            eventIds: ["event-lullaby", "event-earth", "event-70s"],
            id: "bundle-season",
            priceCents: 3000,
            saleEndAt: "2027-06-13T15:00:00Z",
            title: "LCC 2026 - 2027 Season",
          },
        ],
        timezone: "America/New_York",
      },
      version: 1,
    };

    const bundle = projection.payload.ticketBundles[0];
    expect(bundle).toBeDefined();
    if (!bundle) throw new Error("Bundle not found");

    render(
      <TicketBundlePurchaseForm
        bundle={bundle}
        feeSettings={feeSettings}
        projection={projection}
      />,
    );

    const list = await screen.findByRole("list");
    expect(list).toHaveClass("public-bundle-event-list");

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);

    // Soonest concert (November 15, 2026) must be first
    expect(items[0]).toHaveTextContent("Earth and Sky and Sea");
    // Middle concert (March 7, 2027) second
    expect(items[1]).toHaveTextContent("Lullaby of Broadway");
    // Latest concert (June 13, 2027) last
    expect(items[2]).toHaveTextContent("Singing the 70s");
  });
});

describe("TicketsContent", () => {
  it("displays bundles first, then concerts in chronological order with the closest concert to today after the bundles", () => {
    const projection: PublishedOrganizationProjection = {
      generatedAt: "2026-09-20T00:00:00Z",
      organizationId: "org-1",
      payload: {
        mediaFileIds: [],
        organizationName: "LCC",
        performances: [
          {
            advancePriceCents: 1500,
            dayOfPriceCents: 2000,
            doorsOpenTime: "14:30",
            graphicFileId: null,
            id: "event-70s",
            isTicketingEnabled: true,
            location: "Concert Hall",
            publicDetails: "",
            startsAt: "2027-06-13T15:00:00Z",
            ticketCapacity: 100,
            title: "Singing the 70s",
            venueName: "Concert Hall",
          },
          {
            advancePriceCents: 1500,
            dayOfPriceCents: 2000,
            doorsOpenTime: "14:30",
            graphicFileId: null,
            id: "event-earth",
            isTicketingEnabled: true,
            location: "Concert Hall",
            publicDetails: "",
            startsAt: "2026-11-15T15:00:00Z",
            ticketCapacity: 100,
            title: "Earth and Sky and Sea",
            venueName: "Concert Hall",
          },
          {
            advancePriceCents: 1500,
            dayOfPriceCents: 2000,
            doorsOpenTime: "14:30",
            graphicFileId: null,
            id: "event-lullaby",
            isTicketingEnabled: true,
            location: "Concert Hall",
            publicDetails: "",
            startsAt: "2027-03-07T15:00:00Z",
            ticketCapacity: 100,
            title: "Lullaby of Broadway",
            venueName: "Concert Hall",
          },
        ],
        settings: {
          aboutUsText: "",
          bodyFont: "system",
          contactEmail: "",
          enabledNavigation: ["tickets"],
          headerFont: "system",
          heroFileId: null,
          heroHeadline: "LCC",
          heroSubtitle: "",
          historyText: "",
          logoFileId: null,
          showBrandingHeaderFooter: false,
        },
        ticketBundles: [
          {
            capacity: 50,
            eventIds: ["event-lullaby", "event-earth", "event-70s"],
            id: "bundle-season",
            priceCents: 3000,
            saleEndAt: "2027-06-13T15:00:00Z",
            title: "LCC 2026 - 2027 Season",
          },
        ],
        timezone: "America/New_York",
      },
      version: 1,
    };

    render(
      <TicketsContent
        feeSettings={feeSettings}
        nowMs={new Date("2026-09-20T00:00:00Z").getTime()}
        pathname="/tickets"
        projection={projection}
      />,
    );

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(4);

    // 1. Bundle is first
    expect(headings[0]).toHaveTextContent("LCC 2026 - 2027 Season");
    // 2. Closest concert to today (Nov 15, 2026) immediately follows bundles
    expect(headings[1]).toHaveTextContent("Earth and Sky and Sea");
    // 3. Next chronological concert (March 7, 2027)
    expect(headings[2]).toHaveTextContent("Lullaby of Broadway");
    // 4. Latest concert (June 13, 2027)
    expect(headings[3]).toHaveTextContent("Singing the 70s");
  });

  it("always puts all bundles before any concerts even when multiple bundles exist", () => {
    const projection: PublishedOrganizationProjection = {
      generatedAt: "2026-09-20T00:00:00Z",
      organizationId: "org-1",
      payload: {
        mediaFileIds: [],
        organizationName: "LCC",
        performances: [
          {
            advancePriceCents: 1500,
            dayOfPriceCents: 2000,
            doorsOpenTime: "14:30",
            graphicFileId: null,
            id: "event-later",
            isTicketingEnabled: true,
            location: "Concert Hall",
            publicDetails: "",
            startsAt: "2027-05-01T15:00:00Z",
            ticketCapacity: 100,
            title: "May Concert",
            venueName: "Concert Hall",
          },
          {
            advancePriceCents: 1500,
            dayOfPriceCents: 2000,
            doorsOpenTime: "14:30",
            graphicFileId: null,
            id: "event-sooner",
            isTicketingEnabled: true,
            location: "Concert Hall",
            publicDetails: "",
            startsAt: "2026-10-10T15:00:00Z",
            ticketCapacity: 100,
            title: "October Concert",
            venueName: "Concert Hall",
          },
        ],
        settings: {
          aboutUsText: "",
          bodyFont: "system",
          contactEmail: "",
          enabledNavigation: ["tickets"],
          headerFont: "system",
          heroFileId: null,
          heroHeadline: "LCC",
          heroSubtitle: "",
          historyText: "",
          logoFileId: null,
          showBrandingHeaderFooter: false,
        },
        ticketBundles: [
          {
            capacity: 50,
            eventIds: ["event-later"],
            id: "bundle-spring",
            priceCents: 2500,
            saleEndAt: "2027-04-01T15:00:00Z",
            title: "Spring Pass",
          },
          {
            capacity: 50,
            eventIds: ["event-sooner"],
            id: "bundle-fall",
            priceCents: 2000,
            saleEndAt: "2026-09-30T15:00:00Z",
            title: "Fall Pass",
          },
        ],
        timezone: "America/New_York",
      },
      version: 1,
    };

    render(
      <TicketsContent
        feeSettings={feeSettings}
        nowMs={new Date("2026-09-20T00:00:00Z").getTime()}
        pathname="/tickets"
        projection={projection}
      />,
    );

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(4);

    // Both bundles come first
    expect(headings[0]).toHaveTextContent("Fall Pass");
    expect(headings[1]).toHaveTextContent("Spring Pass");
    // Concerts follow in chronological order (October before May)
    expect(headings[2]).toHaveTextContent("October Concert");
    expect(headings[3]).toHaveTextContent("May Concert");
  });
});
