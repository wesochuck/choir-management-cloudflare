import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PublishedOrganizationProjection,
  PublicTicketReceipt,
  TransactionFeeSettings,
} from "@choir/contracts";
import type * as AuthApiModule from "../auth/api";
import {
  AuthApiError,
  getPublicCommerceProjection,
  getPublicTicketConfirmationSettings,
  getPublicTicketPurchase,
  getPublicTransactionFeeSettings,
  getPublishedOrganizationProjection,
} from "../auth/api";
import {
  PublicTickets,
  TicketBundlePurchaseForm,
  TicketDiscountControls,
  type TicketDiscountState,
  TicketReceipt,
  TicketsContent,
} from "./PublicTickets";
import { getEventVenueDetails } from "./venueDetails";

vi.mock("../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof AuthApiModule>();
  return {
    ...actual,
    createPublicTicketCheckout: vi.fn(),
    getPublicCommerceProjection: vi.fn(),
    getPublicTicketConfirmationSettings: vi.fn(),
    getPublicTicketDiscountAvailability: vi.fn().mockResolvedValue({ hasRedeemableCode: false }),
    getPublicTicketPurchase: vi.fn(),
    getPublicTransactionFeeSettings: vi.fn(),
    getPublishedOrganizationProjection: vi.fn(),
    quotePublicTicketCheckout: vi.fn(),
  };
});

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
    expect(
      screen.getByLabelText("I would like to receive updates about future events and programs"),
    ).toBeInTheDocument();
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

describe("TicketDiscountControls", () => {
  const dummyQuote = {
    discountAmountCents: 0,
    discountCode: null,
    discountType: null,
    discountValue: null,
    discountedSubtotalCents: 2000,
    feeCents: 50,
    originalSubtotalCents: 2000,
    originalUnitPriceCents: 2000,
    quantity: 1,
    totalCents: 2050,
  };

  const createMockState = (overrides: Partial<TicketDiscountState> = {}): TicketDiscountState => ({
    appliedCode: null,
    applyCode: vi.fn(),
    clearCode: vi.fn(),
    codeInput: "",
    displayQuote: dummyQuote,
    hasRedeemableCode: true,
    quoteBusy: false,
    quoteError: null,
    setCodeInput: vi.fn(),
    ...overrides,
  });

  it("renders nothing when hasRedeemableCode is false", () => {
    const state = createMockState({ hasRedeemableCode: false });
    const { container } = render(<TicketDiscountControls state={state} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Have a discount code?" })).not.toBeInTheDocument();
  });

  it("renders compact disclosure button and hides input initially when a code is eligible", () => {
    const state = createMockState({ hasRedeemableCode: true });
    render(<TicketDiscountControls state={state} />);
    const button = screen.getByRole("button", { name: "Have a discount code?" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "ticket-discount-region");
    expect(screen.queryByLabelText("Discount code (optional)")).not.toBeInTheDocument();
  });

  it("expands the labeled input and Apply button on disclosure click, updating aria-expanded", async () => {
    const user = userEvent.setup();
    const state = createMockState({ hasRedeemableCode: true });
    render(<TicketDiscountControls state={state} />);

    const button = screen.getByRole("button", { name: "Have a discount code?" });
    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    const input = screen.getByLabelText("Discount code (optional)");
    expect(input).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply code" })).toBeInTheDocument();

    // Clicking again collapses
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Discount code (optional)")).not.toBeInTheDocument();
  });

  it("replaces expanded input with compact applied state with Remove action after successful apply", () => {
    const state = createMockState({
      appliedCode: "SUMMER25",
      displayQuote: {
        ...dummyQuote,
        discountAmountCents: 500,
        discountCode: "SUMMER25",
        discountedSubtotalCents: 1500,
        totalCents: 1550,
      },
    });
    render(<TicketDiscountControls state={state} />);

    expect(screen.getByText("SUMMER25 applied")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Discount code (optional)")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Have a discount code?" })).not.toBeInTheDocument();
  });

  it("stays expanded and displays safe error when code is invalid", () => {
    const state = createMockState({
      codeInput: "BADCODE",
      quoteError: "This code is not valid for this purchase.",
    });
    render(<TicketDiscountControls state={state} />);

    expect(screen.getByRole("button", { name: "Have a discount code?" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const input = screen.getByLabelText("Discount code (optional)");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("BADCODE");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute(
      "aria-describedby",
      "ticket-discount-code-error ticket-discount-code-help",
    );
    const errorAlert = screen.getByRole("alert");
    expect(errorAlert).toHaveTextContent("This code is not valid for this purchase.");
  });

  it("calls clearCode and returns to compact available state when Remove is clicked", async () => {
    const user = userEvent.setup();
    const clearCode = vi.fn();
    const state = createMockState({
      appliedCode: "SUMMER25",
      clearCode,
      displayQuote: {
        ...dummyQuote,
        discountAmountCents: 500,
        discountCode: "SUMMER25",
      },
    });
    const { rerender } = render(<TicketDiscountControls state={state} />);

    const removeBtn = screen.getByRole("button", { name: "Remove" });
    await user.click(removeBtn);
    expect(clearCode).toHaveBeenCalledTimes(1);

    // After clearing code
    const resetState = createMockState({ appliedCode: null });
    rerender(<TicketDiscountControls state={resetState} />);
    const disclosure = screen.getByRole("button", { name: "Have a discount code?" });
    expect(disclosure).toBeInTheDocument();
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Discount code (optional)")).not.toBeInTheDocument();
  });

  it("shows checking status in applied state when quote is busy during quantity change", () => {
    const state = createMockState({
      appliedCode: "SUMMER25",
      displayQuote: {
        ...dummyQuote,
        discountAmountCents: 500,
        discountCode: "SUMMER25",
      },
      quoteBusy: true,
    });
    render(<TicketDiscountControls state={state} />);

    expect(screen.getByText("SUMMER25 applied")).toBeInTheDocument();
    expect(screen.getByText("(checking…)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("supports keyboard interaction and applies code on Enter key press", async () => {
    const user = userEvent.setup();
    const applyCode = vi.fn();
    const state = createMockState({
      applyCode,
      codeInput: "WINTER10",
    });
    render(<TicketDiscountControls state={state} />);

    const disclosure = screen.getByRole("button", { name: "Have a discount code?" });
    disclosure.focus();
    await user.keyboard("{Enter}");

    const input = screen.getByLabelText("Discount code (optional)");
    expect(input).toBeInTheDocument();

    input.focus();
    await user.keyboard("{Enter}");
    expect(applyCode).toHaveBeenCalledTimes(1);
  });
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
    expect(screen.getByRole("button", { name: "Complete ticket order" })).toBeInTheDocument();

    // Standalone shell on detail page does not show general navigation
    expect(screen.queryByRole("navigation", { name: "Public website" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Performances" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "History" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("renders full organization layout with navigation when showBrandingHeaderFooter is true, marking Tickets as current", async () => {
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
});

describe("TicketReceipt", () => {
  const baseSampleReceipt: PublicTicketReceipt = {
    amountPaidCents: 2000,
    bundleId: null,
    bundleTitle: "",
    buyerName: "Jane Doe",
    checkoutMode: "stripe",
    currency: "usd",
    discountAmountCents: 0,
    discountCode: null,
    discountType: null,
    discountValue: null,
    discountedSubtotalCents: 0,
    eventId: "11111111-1111-4111-8111-111111111111",
    eventStartsAt: "2026-10-15T19:30:00Z",
    eventTitle: "Spring Concert",
    feeCents: 100,
    id: "22222222-2222-4222-8222-222222222222",
    includedEvents: [],
    location: "Main Auditorium",
    originalSubtotalCents: 1900,
    originalUnitPriceCents: 1900,
    quantity: 1,
    requestId: "33333333-3333-4333-8333-333333333333",
    scanToken: null,
    status: "pending",
    timezone: "America/New_York",
    unitPriceCents: 1900,
    venueAddress: "123 Concert Hall Way, New York, NY 10001",
    venueName: "Symphony Hall",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getPublicTicketConfirmationSettings).mockResolvedValue({
      admissionInstructions: "Keep this confirmation available on your phone.",
      pendingMessage: "Order processing message.",
      qrCodeInstructions: "Show this QR code at the door.",
      successMessage: "Order success message.",
      willCallInstructions: "Pick up at will call.",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("automatically transitions pending -> pending -> paid and stops polling after paid", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    const paidReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: "credential.token.123",
      status: "paid",
    };

    vi.mocked(getPublicTicketPurchase)
      .mockResolvedValueOnce(pendingReceipt)
      .mockResolvedValueOnce(pendingReceipt)
      .mockResolvedValueOnce(paidReceipt);

    render(<TicketReceipt token="tok-1" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();
    expect(screen.getByText("Order processing message.")).toBeInTheDocument();
    expect(screen.queryByText("Door credential")).not.toBeInTheDocument();
    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();
    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByRole("heading", { name: "Your tickets are confirmed" })).toBeInTheDocument();
    expect(screen.getByText("Order success message.")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole("img", { name: /Admission QR code/ })).toBeInTheDocument();
    expect(screen.queryByText("credential.token.123")).not.toBeInTheDocument();
    expect(screen.queryByText("Manual credential")).not.toBeInTheDocument();
    expect(screen.getAllByText("Symphony Hall").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/123 Concert Hall Way/).length).toBeGreaterThanOrEqual(1);
    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(3);
  });

  it("automatically transitions pending -> refunded, stops polling, and displays refunded state", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    const refundedReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "refunded",
    };

    vi.mocked(getPublicTicketPurchase)
      .mockResolvedValueOnce(pendingReceipt)
      .mockResolvedValueOnce(refundedReceipt);

    render(<TicketReceipt token="tok-refund" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByRole("heading", { name: "Ticket order refunded" })).toBeInTheDocument();
    expect(screen.getByText("This ticket order has been refunded.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Admission QR code/ })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(2);
  });

  it("automatically transitions pending -> expired, stops polling, and displays expired state", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    const expiredReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "expired",
    };

    vi.mocked(getPublicTicketPurchase)
      .mockResolvedValueOnce(pendingReceipt)
      .mockResolvedValueOnce(expiredReceipt);

    render(<TicketReceipt token="tok-expire" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByRole("heading", { name: "Ticket order expired" })).toBeInTheDocument();
    expect(
      screen.getByText("This ticket order has expired because payment was not completed."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Admission QR code/ })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(2);
  });

  it("cancels polling on unmount", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    vi.mocked(getPublicTicketPurchase).mockResolvedValue(pendingReceipt);

    const { unmount } = render(<TicketReceipt token="tok-unmount" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(1);
  });

  it("treats 404 as unavailable and does not repeatedly poll", async () => {
    vi.mocked(getPublicTicketPurchase).mockRejectedValue(
      new AuthApiError("Ticket order not found.", 404, "not_found"),
    );

    render(<TicketReceipt token="tok-invalid" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("This ticket receipt is unavailable.")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getPublicTicketPurchase).toHaveBeenCalledTimes(1);
  });

  it("recovers from transient network or 5xx errors while polling", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    const paidReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: "recovered.token",
      status: "paid",
    };

    vi.mocked(getPublicTicketPurchase)
      .mockResolvedValueOnce(pendingReceipt)
      .mockRejectedValueOnce(new AuthApiError("Internal error", 503, "ticket_order_unavailable"))
      .mockResolvedValueOnce(paidReceipt);

    render(<TicketReceipt token="tok-recover" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();

    // Second call fails with 503
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    // Pending receipt remains visible despite transient error
    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();

    // Third call succeeds with paid
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole("heading", { name: "Your tickets are confirmed" })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole("img", { name: /Admission QR code/ })).toBeInTheDocument();
    expect(screen.queryByText("recovered.token")).not.toBeInTheDocument();
  });

  it("leaves pending receipt visible with manual retry action upon poll timeout", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    vi.mocked(getPublicTicketPurchase).mockResolvedValue(pendingReceipt);

    render(<TicketReceipt token="tok-timeout" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();

    // Advance beyond the 45-second timeout window
    await act(async () => {
      await vi.advanceTimersByTimeAsync(46000);
    });

    // Receipt details remain visible
    expect(screen.getByRole("heading", { name: "Ticket order processing" })).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Spring Concert")).toBeInTheDocument();
    expect(
      screen.getByText(
        "We are still waiting for confirmation from the payment provider. Your order details are below.",
      ),
    ).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: "Check status again" });
    expect(retryButton).toBeInTheDocument();

    // Clicking retry starts a new check
    const callsBefore = vi.mocked(getPublicTicketPurchase).mock.calls.length;
    await act(async () => {
      retryButton.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(vi.mocked(getPublicTicketPurchase).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("does not display QR code or scan credential until paid response includes scanToken", async () => {
    const pendingReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      scanToken: null,
      status: "pending",
    };
    vi.mocked(getPublicTicketPurchase).mockResolvedValueOnce(pendingReceipt);

    render(<TicketReceipt token="tok-cred" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole("img", { name: /Admission QR code/ })).not.toBeInTheDocument();
    expect(screen.queryByText("credential.token.123")).not.toBeInTheDocument();
  });

  it("renders bundle included performances with venue information", async () => {
    const bundleReceipt: PublicTicketReceipt = {
      ...baseSampleReceipt,
      bundleId: "bundle-1",
      bundleTitle: "Choral Subscription 2026",
      includedEvents: [
        {
          id: "event-a",
          location: "Chapel",
          startsAt: "2026-11-01T19:00:00Z",
          title: "Concert A",
          venueAddress: "100 Church St",
          venueName: "Grace Chapel",
        },
        {
          id: "event-b",
          location: "Hall",
          startsAt: "2026-12-05T19:00:00Z",
          title: "Concert B",
          venueAddress: "200 State St",
          venueName: "Cathedral Hall",
        },
      ],
      scanToken: "bundle.scan.token",
      status: "paid",
    };
    vi.mocked(getPublicTicketPurchase).mockResolvedValueOnce(bundleReceipt);

    render(<TicketReceipt token="tok-bundle" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(
      screen.getByRole("heading", { level: 2, name: "Choral Subscription 2026" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Concert A")).toBeInTheDocument();
    expect(screen.getByText("Grace Chapel")).toBeInTheDocument();
    expect(screen.getByText(/100 Church St/)).toBeInTheDocument();
    expect(screen.getByText("Concert B")).toBeInTheDocument();
    expect(screen.getByText("Cathedral Hall")).toBeInTheDocument();
    expect(screen.getByText(/200 State St/)).toBeInTheDocument();
  });
});
