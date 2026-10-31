import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import type { PublishedOrganizationProjection } from "@choir/contracts";
import type * as AuthApiModule from "../auth/api";
import {
  createPublicTicketCheckout,
  getPublicTicketDiscountAvailability,
  quotePublicTicketCheckout,
} from "../auth/api";
import { TicketBundlePurchaseForm, TicketsContent } from "./PublicTickets";
import { getEventVenueDetails } from "./venueDetails";
import { checkoutProjection, feeSettings } from "./PublicTickets.ui.fixture";

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

describe("optional doors-open information", () => {
  describe.each([
    "/tickets",
    "/tickets/11111111-1111-4111-8111-111111111111",
    "/tickets/bundles/22222222-2222-4222-8222-222222222222",
  ])("doors-open time on %s", (pathname) => {
    it.each([
      ["14:30", "2:30 PM"],
      ["09:05", "9:05 AM"],
      ["00:00", "12:00 AM"],
      ["12:00", "12:00 PM"],
    ])("formats %s as %s and omits missing times", (doorsOpenTime, expectedTime) => {
      const base = checkoutProjection(1500, 3000);
      const withDoors = {
        ...base,
        payload: {
          ...base.payload,
          performances: base.payload.performances.map((event) => ({
            ...event,
            doorsOpenTime,
          })),
        },
      };
      const props = { feeSettings, nowMs: new Date("2026-01-01T00:00:00Z").getTime(), pathname };
      const { rerender } = render(<TicketsContent {...props} projection={withDoors} />);
      expect(screen.getByText(`Doors open at ${expectedTime}.`)).toBeInTheDocument();
      rerender(<TicketsContent {...props} projection={base} />);
      expect(screen.queryByText(/Doors open/)).not.toBeInTheDocument();
    });
  });
});

describe("TicketBundlePurchaseForm", () => {
  it("prevents an unsupported paid total while keeping free and fifty-cent bundle totals available", async () => {
    const unsupported = checkoutProjection(500, 17);
    const unsupportedBundle = unsupported.payload.ticketBundles[0];
    expect(unsupportedBundle).toBeDefined();
    if (!unsupportedBundle) throw new Error("Expected checkout test bundle");
    const { rerender } = render(
      <TicketBundlePurchaseForm
        bundle={unsupportedBundle}
        feeSettings={feeSettings}
        projection={unsupported}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Card payments must total at least $0.50");
    expect(screen.getByRole("button", { name: "Continue to secure payment" })).toBeDisabled();

    const complimentary = checkoutProjection(500, 0);
    const complimentaryBundle = complimentary.payload.ticketBundles[0];
    expect(complimentaryBundle).toBeDefined();
    if (!complimentaryBundle) throw new Error("Expected complimentary test bundle");
    rerender(
      <TicketBundlePurchaseForm
        bundle={complimentaryBundle}
        feeSettings={feeSettings}
        projection={complimentary}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm free order" })).toBeEnabled();

    const boundary = checkoutProjection(500, 19);
    const boundaryBundle = boundary.payload.ticketBundles[0];
    expect(boundaryBundle).toBeDefined();
    if (!boundaryBundle) throw new Error("Expected boundary test bundle");
    rerender(
      <TicketBundlePurchaseForm
        bundle={boundaryBundle}
        feeSettings={feeSettings}
        projection={boundary}
      />,
    );
    expect(screen.getByRole("button", { name: "Continue to secure payment" })).toBeEnabled();
  });

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
            graphicFileId: null,
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
    expect(
      screen.getByLabelText("I would like to receive updates about future events and programs"),
    ).toBeInTheDocument();
  });
});

describe("TicketsContent", () => {
  it("prevents an unsupported ticket total while keeping free and fifty-cent tickets available", async () => {
    const unsupported = checkoutProjection(17, 500);
    const { rerender } = render(
      <TicketsContent
        feeSettings={feeSettings}
        nowMs={new Date("2026-09-20T00:00:00Z").getTime()}
        pathname="/tickets/11111111-1111-4111-8111-111111111111"
        projection={unsupported}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Card payments must total at least $0.50");
    expect(screen.getByRole("button", { name: "Continue to secure payment" })).toBeDisabled();

    const complimentary = checkoutProjection(0, 500);
    rerender(
      <TicketsContent
        feeSettings={feeSettings}
        nowMs={new Date("2026-09-20T00:00:00Z").getTime()}
        pathname="/tickets/11111111-1111-4111-8111-111111111111"
        projection={complimentary}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm free order" })).toBeEnabled();

    const boundary = checkoutProjection(19, 500);
    rerender(
      <TicketsContent
        feeSettings={feeSettings}
        nowMs={new Date("2026-09-20T00:00:00Z").getTime()}
        pathname="/tickets/11111111-1111-4111-8111-111111111111"
        projection={boundary}
      />,
    );
    expect(screen.getByRole("button", { name: "Continue to secure payment" })).toBeEnabled();
  });

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
            graphicFileId: null,
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
            graphicFileId: null,
            id: "bundle-spring",
            priceCents: 2500,
            saleEndAt: "2027-04-01T15:00:00Z",
            title: "Spring Pass",
          },
          {
            capacity: 50,
            eventIds: ["event-sooner"],
            graphicFileId: null,
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
    expect(
      screen.getByLabelText("I would like to receive updates about future events and programs"),
    ).toBeInTheDocument();
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
            graphicFileId: null,
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

describe("TicketCheckoutFooter", () => {
  const freeQuote = {
    discountAmountCents: 2000,
    discountCode: "FREE100",
    discountType: "percentage",
    discountValue: 100,
    discountedSubtotalCents: 0,
    feeCents: 0,
    originalSubtotalCents: 2000,
    originalUnitPriceCents: 2000,
    quantity: 1,
    totalCents: 0,
  } as const;

  function singleForm(eventPriceCents: number) {
    const projection = checkoutProjection(eventPriceCents, 500);
    render(
      <TicketsContent
        feeSettings={feeSettings}
        nowMs={new Date("2026-09-20T00:00:00Z").getTime()}
        pathname="/tickets/11111111-1111-4111-8111-111111111111"
        projection={projection}
      />,
    );
  }

  function bundleForm(bundlePriceCents: number) {
    const projection = checkoutProjection(500, bundlePriceCents);
    const bundle = projection.payload.ticketBundles[0];
    if (!bundle) throw new Error("Expected checkout test bundle");
    render(
      <TicketBundlePurchaseForm
        bundle={bundle}
        feeSettings={feeSettings}
        projection={projection}
      />,
    );
  }

  it("reassures paid single-performance buyers about the Stripe next step", async () => {
    singleForm(2000);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("You won't be charged yet.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You'll review and confirm your payment securely with Stripe on the next page.",
      ),
    ).toBeInTheDocument();
    const lockIcon = document.querySelector(".ticket-checkout-footer__icon");
    expect(lockIcon).toHaveAttribute("width", "16");
    expect(lockIcon).toHaveAttribute("height", "16");
    expect(screen.getByRole("button", { name: "Continue to secure payment" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Confirm free order" })).not.toBeInTheDocument();
  });

  it("reassures paid bundle buyers about the Stripe next step", async () => {
    bundleForm(2000);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("You won't be charged yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to secure payment" })).toBeEnabled();
  });

  it("confirms free orders inside Choir Manager without promising Stripe", async () => {
    const projection = checkoutProjection(0, 0);
    const bundle = projection.payload.ticketBundles[0];
    if (!bundle) throw new Error("Expected checkout test bundle");
    const { rerender } = render(
      <TicketsContent
        feeSettings={feeSettings}
        nowMs={new Date("2026-09-20T00:00:00Z").getTime()}
        pathname="/tickets/11111111-1111-4111-8111-111111111111"
        projection={projection}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("No payment required.")).toBeInTheDocument();
    expect(
      screen.getByText("Your free order will be confirmed when you continue."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm free order" })).toBeEnabled();
    expect(screen.queryByText(/Stripe on the next page/)).not.toBeInTheDocument();

    rerender(
      <TicketBundlePurchaseForm
        bundle={bundle}
        feeSettings={feeSettings}
        projection={projection}
      />,
    );
    expect(screen.getByText("No payment required.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm free order" })).toBeEnabled();
  });

  it("updates the CTA when applying and removing a 100 percent discount", async () => {
    const user = userEvent.setup();
    vi.mocked(getPublicTicketDiscountAvailability).mockResolvedValue(true);
    vi.mocked(quotePublicTicketCheckout).mockResolvedValue({ ...freeQuote });
    try {
      singleForm(2000);
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        screen.getByRole("button", { name: "Continue to secure payment" }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Have a discount code?" }));
      await user.type(screen.getByLabelText("Discount code (optional)"), "FREE100");
      await user.click(screen.getByRole("button", { name: "Apply code" }));
      expect(await screen.findByRole("button", { name: "Confirm free order" })).toBeEnabled();
      expect(screen.getByText("No payment required.")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Remove" }));
      expect(
        await screen.findByRole("button", { name: "Continue to secure payment" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("No payment required.")).not.toBeInTheDocument();
    } finally {
      vi.mocked(getPublicTicketDiscountAvailability).mockResolvedValue(false);
      vi.mocked(quotePublicTicketCheckout).mockReset();
    }
  });

  it("labels submission in progress for the actual paid action", async () => {
    const user = userEvent.setup();
    vi.mocked(createPublicTicketCheckout).mockImplementation(() => new Promise(() => undefined));
    try {
      singleForm(2000);
      await act(async () => {
        await Promise.resolve();
      });
      await user.type(screen.getByLabelText("Name on order"), "Casey Buyer");
      await user.type(screen.getByLabelText("Email"), "casey@example.test");
      await user.type(screen.getByLabelText("Confirm email"), "casey@example.test");
      await user.click(screen.getByRole("button", { name: "Continue to secure payment" }));
      expect(await screen.findByRole("button", { name: "Continuing to payment…" })).toBeDisabled();
    } finally {
      vi.mocked(createPublicTicketCheckout).mockReset();
    }
  });
});
