import { organizationEventSchema, ticketBundleSchema } from "@choir/contracts";
import { futureIsoDate } from "@choir/testkit";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { generateQRCodeDataUrl } from "../../../shared/qrCode";
import { SharePanel } from "./SharePanel";

vi.mock("../../../auth/api", () => ({
  getOrganizationPublicWebsiteSettings: vi.fn().mockResolvedValue({ logoFileId: null }),
}));
vi.mock("../../../shared/qrCode", () => ({
  generateQRCodeDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,cXI="),
}));

const event = organizationEventSchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Christmas by Candlelight",
  type: "Performance",
  startsAt: futureIsoDate(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ticketSlug: "christmas-by-candlelight",
});
const bundle = ticketBundleSchema.parse({
  id: "22222222-2222-4222-8222-222222222222",
  title: "Season Pass",
  eventIds: [event.id],
  priceCents: 1000,
  saleEndAt: futureIsoDate(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ticketSlug: "season-pass",
});

describe("primary ticket sharing URLs", () => {
  it.each([
    ["Christmas by Candlelight", "/tickets/christmas-by-candlelight"],
    ["Season Pass", "/tickets/bundles/season-pass"],
  ])("shows, copies, and encodes the readable URL for %s", async (title, path) => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText");
    render(<SharePanel bundles={[bundle]} ticketEvents={[event]} />);
    const card = within(screen.getByRole("group", { name: title }));
    const url = new URL(path, window.location.origin).toString();
    expect(card.getByRole("link", { name: url })).toHaveAttribute("href", url);
    await user.click(card.getByRole("button", { name: "Copy link" }));
    expect(copy).toHaveBeenCalledWith(url);
    await waitFor(() => {
      expect(generateQRCodeDataUrl).toHaveBeenCalledWith(expect.objectContaining({ payload: url }));
    });
  });
});
