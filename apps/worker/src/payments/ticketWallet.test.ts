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
  it("accepts only the provider install link", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { "X-Pass-Url": "https://pass.walletwallet.dev/p/example" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, { headers: { "X-Pass-Url": "https://other.example/p/example" } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", request);
    expect(await issueWalletPass("test", body)).toEqual({
      shareUrl: "https://pass.walletwallet.dev/p/example",
    });
    expect(request).toHaveBeenCalledWith(
      "https://api.walletwallet.dev/api/passes?format=pkpass",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
    );
    await expect(issueWalletPass("test", body)).rejects.toThrow();
    expect(await issueWalletPass("test", body)).toEqual({ rejected: true });
  });
});
