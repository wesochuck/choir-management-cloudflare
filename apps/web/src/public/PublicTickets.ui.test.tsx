import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import type { PublishedOrganizationProjection, TransactionFeeSettings } from "@choir/contracts";
import { TicketBundlePurchaseForm, TicketsContent } from "./PublicTickets";
import { getEventVenueDetails } from "./venueDetails";

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
            venueAddress: "123 Concert Way",
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
            venueAddress: "123 Concert Way",
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
            venueAddress: "123 Concert Way",
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
            venueAddress: "123 Concert Way",
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
            venueAddress: "123 Concert Way",
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
            venueAddress: "123 Concert Way",
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
            venueAddress: "123 Concert Way",
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
            venueAddress: "123 Concert Way",
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

  it("renders venue address and Google Maps lookup link on the concert ticket purchase page", async () => {
    const projection: PublishedOrganizationProjection = {
      generatedAt: "2026-09-20T00:00:00Z",
      organizationId: "org-1",
      payload: {
        mediaFileIds: [],
        organizationName: "LCC",
        performances: [
          {
            advancePriceCents: 2000,
            dayOfPriceCents: 2500,
            doorsOpenTime: "19:00",
            graphicFileId: null,
            id: "11111111-1111-4111-8111-111111111111",
            isTicketingEnabled: true,
            location: "Main Auditorium",
            publicDetails: "",
            startsAt: "2026-12-15T19:30:00Z",
            ticketCapacity: 200,
            title: "Holiday Spectacular",
            venueAddress: "789 Music Ave, Cincinnati, OH 45202",
            venueName: "Symphony Hall",
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
        ticketBundles: [],
        timezone: "America/New_York",
      },
      version: 1,
    };

    render(
      <TicketsContent
        feeSettings={feeSettings}
        nowMs={new Date("2026-09-20T00:00:00Z").getTime()}
        pathname="/tickets/11111111-1111-4111-8111-111111111111"
        projection={projection}
      />,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Holiday Spectacular" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Symphony Hall")).toBeInTheDocument();
    expect(screen.getByText("789 Music Ave, Cincinnati, OH 45202")).toBeInTheDocument();

    const mapLink = screen.getByRole("link", { name: "View on Google Maps" });
    expect(mapLink).toBeInTheDocument();
    expect(mapLink).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Symphony%20Hall%2C%20789%20Music%20Ave%2C%20Cincinnati%2C%20OH%2045202",
    );
    expect(mapLink).toHaveAttribute("target", "_blank");
    expect(mapLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders venue address and Google Maps links in performance cards on the main tickets page", () => {
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
            id: "event-spring",
            isTicketingEnabled: true,
            location: "",
            publicDetails: "",
            startsAt: "2027-04-10T15:00:00Z",
            ticketCapacity: 150,
            title: "Spring Choral Gala",
            venueAddress: "456 Choir Blvd, Columbus, OH 43215",
            venueName: "Grace Chapel",
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
        ticketBundles: [],
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

    expect(
      screen.getByRole("heading", { level: 2, name: "Spring Choral Gala" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Grace Chapel")).toBeInTheDocument();
    expect(screen.getByText("456 Choir Blvd, Columbus, OH 43215")).toBeInTheDocument();

    const mapLink = screen.getByRole("link", { name: "View on Google Maps" });
    expect(mapLink).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Grace%20Chapel%2C%20456%20Choir%20Blvd%2C%20Columbus%2C%20OH%2043215",
    );
    expect(mapLink).toHaveAttribute("target", "_blank");
    expect(mapLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders venue address and Google Maps links in included concerts on the bundle ticket page", async () => {
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
            id: "event-fall",
            isTicketingEnabled: true,
            location: "",
            publicDetails: "",
            startsAt: "2026-10-15T15:00:00Z",
            ticketCapacity: 100,
            title: "Fall Awakening",
            venueAddress: "100 Autumn Way, Dayton, OH 45402",
            venueName: "Memorial Hall",
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
            eventIds: ["event-fall"],
            id: "bundle-pass",
            priceCents: 2500,
            saleEndAt: "2026-10-15T15:00:00Z",
            title: "Season Pass",
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

    expect(
      await screen.findByRole("heading", { level: 1, name: "Season Pass" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Memorial Hall")).toBeInTheDocument();
    expect(screen.getByText("100 Autumn Way, Dayton, OH 45402")).toBeInTheDocument();

    const mapLink = screen.getByRole("link", { name: "View on Google Maps" });
    expect(mapLink).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Memorial%20Hall%2C%20100%20Autumn%20Way%2C%20Dayton%2C%20OH%2045402",
    );
    expect(mapLink).toHaveAttribute("target", "_blank");
    expect(mapLink).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("getEventVenueDetails", () => {
  it("resolves both venue name and venue address into the query", () => {
    const details = getEventVenueDetails({
      location: "",
      venueAddress: "123 Main St, Springfield, IL 62701",
      venueName: "Lincoln Hall",
    });
    expect(details.displayName).toBe("Lincoln Hall");
    expect(details.venueAddress).toBe("123 Main St, Springfield, IL 62701");
    expect(details.googleMapsUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=Lincoln%20Hall%2C%20123%20Main%20St%2C%20Springfield%2C%20IL%2062701",
    );
  });

  it("handles fallback location as address when venue name is present", () => {
    const details = getEventVenueDetails({
      location: "456 State St",
      venueAddress: "",
      venueName: "Community Center",
    });
    expect(details.displayName).toBe("Community Center");
    expect(details.venueAddress).toBe("456 State St");
    expect(details.googleMapsUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=Community%20Center%2C%20456%20State%20St",
    );
  });

  it("handles address only without venue name", () => {
    const details = getEventVenueDetails({
      location: "",
      venueAddress: "789 Broadway",
      venueName: "",
    });
    expect(details.displayName).toBe("");
    expect(details.venueAddress).toBe("789 Broadway");
    expect(details.googleMapsUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=789%20Broadway",
    );
  });

  it("returns null map url when no venue or address information exists", () => {
    const details = getEventVenueDetails({
      location: "",
      venueAddress: "",
      venueName: "",
    });
    expect(details.displayName).toBe("");
    expect(details.venueAddress).toBe("");
    expect(details.googleMapsUrl).toBeNull();
  });
});
