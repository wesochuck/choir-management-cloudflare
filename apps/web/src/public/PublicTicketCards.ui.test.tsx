import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import type { PublishedOrganizationProjection, TransactionFeeSettings } from "@choir/contracts";
import { TicketsContent } from "./PublicTickets";

const feeSettings: TransactionFeeSettings = {
  fixedCents: 30,
  passFeeToDonor: false,
  percentage: 2.9,
};

const projection: PublishedOrganizationProjection = {
  generatedAt: "2026-09-20T00:00:00Z",
  organizationId: "org-ticket-cards",
  payload: {
    mediaFileIds: [],
    organizationName: "Ticket Card Choir",
    performances: [
      {
        advancePriceCents: 1500,
        dayOfPriceCents: 2000,
        doorsOpenTime: "18:30",
        graphicFileId: null,
        id: "event-ticket-card",
        isTicketingEnabled: true,
        location: "Concert Hall",
        publicDetails: "",
        startsAt: "2027-04-10T15:00:00Z",
        ticketCapacity: 100,
        title: "A Concert with a Deliberately Long Title for Card Layout Coverage",
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
      heroHeadline: "Ticket Card Choir",
      heroSubtitle: "",
      historyText: "",
      logoFileId: null,
      showBrandingHeaderFooter: false,
    },
    ticketBundles: [
      {
        capacity: 50,
        eventIds: ["event-ticket-card"],
        id: "bundle-ticket-card",
        priceCents: 3000,
        saleEndAt: "2027-06-13T15:00:00Z",
        title: "Season Pass",
      },
    ],
    timezone: "America/New_York",
  },
  version: 1,
};

describe("TicketsContent ticket card purchase areas", () => {
  it("keeps bundle and performance prices with their semantic purchase links", () => {
    render(
      <TicketsContent
        feeSettings={feeSettings}
        nowMs={new Date("2026-09-20T00:00:00Z").getTime()}
        pathname="/tickets"
        projection={projection}
      />,
    );

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);

    const [bundleCard, performanceCard] = cards;
    if (!bundleCard || !performanceCard) throw new Error("Expected both ticket cards");

    expect(bundleCard).toHaveClass("public-performance-card--ticket");
    expect(performanceCard).toHaveClass("public-performance-card--ticket");

    const bundlePurchase = bundleCard.querySelector<HTMLElement>(
      ".public-performance-card__purchase",
    );
    const performancePurchase = performanceCard.querySelector<HTMLElement>(
      ".public-performance-card__purchase",
    );
    if (!bundlePurchase || !performancePurchase) {
      throw new Error("Expected each ticket card to contain a purchase area");
    }

    expect(within(bundlePurchase).getByText("$30.00 per pass")).toBeInTheDocument();
    expect(within(bundlePurchase).getByRole("link", { name: "Buy pass" })).toHaveAttribute(
      "href",
      "/tickets/bundles/bundle-ticket-card",
    );
    expect(within(performancePurchase).getByText("From $15.00")).toBeInTheDocument();
    expect(within(performancePurchase).getByRole("link", { name: "Buy tickets" })).toHaveAttribute(
      "href",
      "/tickets/event-ticket-card",
    );

    expect(within(bundleCard).getByText("Multi-performance pass")).toBeInTheDocument();
    expect(within(performanceCard).getByText("Grace Chapel")).toBeInTheDocument();
    expect(
      within(performanceCard).getByRole("link", { name: "View on Google Maps" }),
    ).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Grace%20Chapel%2C%20456%20Choir%20Blvd%2C%20Columbus%2C%20OH%2043215",
    );
  });
});
