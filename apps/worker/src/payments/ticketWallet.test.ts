import { afterEach, describe, expect, it, vi } from "vitest";
import { issueWalletPass, walletPassBody } from "./ticketWallet";

const event = {
  id: "concert",
  title: "Fall concert",
  startsAt: "2025-11-01T23:30:00Z",
  doorsOpenTime: "18:30",
  location: "",
  venueAddress: "10 Main St",
  venueName: "Concert Hall",
};
const second = { ...event, id: "encore", title: "Encore", doorsOpenTime: "", venueName: "Annex" };
const body = walletPassBody(
  {
    ...event,
    eventId: event.id,
    eventTitle: event.title,
    eventStartsAt: event.startsAt,
    timezone: "America/New_York",
    bundleTitle: "Fall season",
    quantity: 3,
    includedEvents: [event, second],
  },
  "signed-admission",
  "Community Choir",
  [{ id: event.id, details: "**Parking** in the west lot.\nGeneral seating." }],
);

afterEach(() => vi.unstubAllGlobals());
describe("wallet ticket issuance", () => {
  it("uses the order QR and labels each performance's local times, venue and public instructions", () => {
    expect(body).toMatchObject({
      barcodeValue: "signed-admission",
      logoText: "Community Choir",
      headerFields: [{ label: "Admits", value: "3" }],
    });
    expect(body.backFields[0]?.value).toContain("7:30 PM");
    expect(body.backFields[0]?.value).toContain(
      "Doors open 6:30 PM\nConcert Hall\n10 Main St\nParking in the west lot.\nGeneral seating.",
    );
    expect(body.backFields[1]?.value).not.toMatch(/Parking|Doors open/);
  });

  it("enforces WalletWallet field length and back-field count limits", () => {
    const longOrg = "A".repeat(100);
    const longTitle = "B".repeat(120);
    const longDetails = "C".repeat(600);
    const includedEvents = Array.from({ length: 12 }, (_, index) => ({
      ...event,
      id: `concert-${String(index)}`,
      title: `${longTitle}-${String(index)}`,
    }));
    const constrained = walletPassBody(
      {
        ...event,
        bundleTitle: "D".repeat(300),
        eventId: event.id,
        eventStartsAt: event.startsAt,
        eventTitle: longTitle,
        includedEvents,
        quantity: 2,
        timezone: "America/New_York",
      },
      "signed-admission",
      longOrg,
      includedEvents.map((item) => ({ id: item.id, details: longDetails })),
    );
    expect(constrained.logoText.length).toBeLessThanOrEqual(64);
    expect(constrained.organizationName.length).toBeLessThanOrEqual(64);
    expect(constrained.primaryFields[0]?.value.length).toBeLessThanOrEqual(256);
    expect(constrained.backFields).toHaveLength(10);
    for (const field of constrained.backFields) {
      expect(field.label.length).toBeLessThanOrEqual(64);
      expect(field.value.length).toBeLessThanOrEqual(256);
    }
  });

  it("reads shareUrl from the canonical JSON response, accepts X-Pass-Url fallback, and surfaces safe rejection metadata", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            applePass: "base64-pkpass",
            googleSaveUrl: "https://pay.google.com/gp/v/save/token",
            serialNumber: "serial-1",
            shareUrl: "https://pass.walletwallet.dev/p/example",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { "X-Pass-Url": "https://pass.walletwallet.dev/p/header-fallback" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ shareUrl: "https://other.example/p/example" }), {
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Monthly pass limit reached" }), {
          headers: { "content-type": "application/json" },
          status: 429,
        }),
      );
    vi.stubGlobal("fetch", request);

    expect(await issueWalletPass("test", body)).toEqual({
      shareUrl: "https://pass.walletwallet.dev/p/example",
    });
    expect(request).toHaveBeenCalledWith(
      "https://api.walletwallet.dev/api/passes",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
    );
    expect(await issueWalletPass("test", body)).toEqual({
      shareUrl: "https://pass.walletwallet.dev/p/header-fallback",
    });
    await expect(issueWalletPass("test", body)).rejects.toThrow();
    expect(await issueWalletPass("test", body)).toEqual({
      providerError: "Monthly pass limit reached",
      rejected: true,
      status: 429,
    });
  });
});
