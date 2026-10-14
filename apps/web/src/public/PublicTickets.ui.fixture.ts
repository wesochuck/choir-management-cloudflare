import type { PublishedOrganizationProjection, TransactionFeeSettings } from "@choir/contracts";

export const feeSettings: TransactionFeeSettings = {
  fixedCents: 30,
  passFeeToDonor: false,
  percentage: 2.9,
};

export function checkoutProjection(
  eventPriceCents: number,
  bundlePriceCents: number,
): PublishedOrganizationProjection {
  return {
    generatedAt: "2026-09-20T00:00:00Z",
    organizationId: "org-1",
    payload: {
      mediaFileIds: [],
      organizationName: "LCC",
      performances: [
        {
          advancePriceCents: eventPriceCents,
          dayOfPriceCents: eventPriceCents,
          doorsOpenTime: "",
          graphicFileId: null,
          id: "11111111-1111-4111-8111-111111111111",
          isTicketingEnabled: true,
          location: "",
          publicDetails: "",
          startsAt: "2027-12-20T19:00:00Z",
          ticketCapacity: 100,
          title: "Checkout test concert",
          venueAddress: "",
          venueName: "",
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
          capacity: 100,
          eventIds: ["11111111-1111-4111-8111-111111111111"],
          graphicFileId: null,
          id: "22222222-2222-4222-8222-222222222222",
          priceCents: bundlePriceCents,
          saleEndAt: "2027-12-19T19:00:00Z",
          title: "Checkout test bundle",
        },
      ],
      timezone: "America/New_York",
    },
    version: 1,
  };
}
