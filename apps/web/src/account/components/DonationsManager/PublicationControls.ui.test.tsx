import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { donationRecordSchema } from "@choir/contracts";
import { PublicationSettings } from "./PublicationSettings";
import { PublicationReview } from "./PublicationReview";
import * as api from "../../../api/donations";
vi.mock("../../../api/donations", async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  listDonationPublications: vi.fn(),
  saveDonationPublication: vi.fn(),
  reviewDonationPublications: vi.fn(),
  setDonationInclusion: vi.fn(),
}));
const p = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Holiday",
  recognitionDate: null,
  artworkDate: null,
  timezone: "America/New_York",
  revision: 1,
};
const gift = donationRecordSchema.parse({
  id: "22222222-2222-4222-8222-222222222222",
  amountCents: 2500,
  anonymous: false,
  buyerEmail: "donor@example.test",
  buyerName: "Example Donor",
  createdAt: "2024-01-01T12:00:00Z",
  updatedAt: "2024-01-01T12:00:00Z",
  expiredAt: null,
  marketingConsent: false,
  patronId: null,
  status: "paid",
  tributeName: "",
  tributeNotifyEmail: "",
  tributeType: "none",
  publicationContext: {
    publication: p,
    paidAt: "2024-01-01T12:00:00Z",
    recognitionStatus: "after_cutoff",
    artworkStatus: "pending",
  },
});
function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return client;
}
beforeEach(() => {
  vi.mocked(api.listDonationPublications).mockResolvedValue({
    publications: [p],
    current: p,
    nextCursor: null,
  });
  vi.mocked(api.saveDonationPublication).mockResolvedValue({
    publications: [{ ...p, revision: 2 }],
    current: { ...p, revision: 2 },
    nextCursor: null,
  });
  vi.mocked(api.reviewDonationPublications).mockResolvedValue({
    donations: [gift],
    nextCursor: null,
  });
  vi.mocked(api.setDonationInclusion).mockResolvedValue({ success: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("publication settings and review controls", () => {
  it("loads existing values and saves two independently optional overall dates", async () => {
    const user = userEvent.setup();
    mount(<PublicationSettings />);
    const input = await screen.findByRole("textbox", { name: "Publication name" });
    expect(input).toHaveValue("Holiday");
    await user.clear(input);
    await user.type(input, "Spring");
    await user.click(screen.getByRole("button", { name: "Save publication" }));
    await waitFor(() => {
      expect(api.saveDonationPublication).toHaveBeenCalledWith(
        expect.objectContaining({
          id: p.id,
          name: "Spring",
          recognitionDate: null,
          artworkDate: null,
          expectedRevision: 1,
        }),
      );
    });
  });
  it("keeps late facts visible and requires an explicit target before marking inclusion", async () => {
    const user = userEvent.setup();
    mount(<PublicationReview />);
    expect(
      (await screen.findAllByText("After name cutoff — review for inclusion"))[0],
    ).toBeInTheDocument();
    const action = screen.getAllByRole("button", { name: "Mark included" })[0];
    if (!action) throw new Error("Missing action");
    expect(action).toBeDisabled();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Include in publication" }),
      p.id,
    );
    await user.click(action);
    const dialog = await screen.findByRole("dialog", { name: "Record publication inclusion?" });
    const confirm = within(dialog).getByRole("button", { name: "Mark included" });
    await user.click(confirm);
    await waitFor(() => {
      expect(api.setDonationInclusion).toHaveBeenCalledWith(
        expect.objectContaining({ donationId: gift.id, publicationId: p.id, expectedRevision: 0 }),
      );
    });
  });
  it("shows refunded state and retains inclusion while preventing a new inclusion", async () => {
    vi.mocked(api.reviewDonationPublications).mockResolvedValue({
      donations: [
        {
          ...gift,
          status: "refunded",
          includedPublicationId: p.id,
          includedPublicationName: p.name,
        },
      ],
      nextCursor: null,
    });
    const user = userEvent.setup();
    mount(<PublicationReview />);
    expect((await screen.findAllByText("Refunded"))[0]).toBeInTheDocument();
    expect((await screen.findAllByText("Included in Holiday"))[0]).toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Include in publication" }),
      p.id,
    );
    for (const button of screen.getAllByRole("button", { name: "Mark included" }))
      expect(button).toBeDisabled();
    expect(api.setDonationInclusion).not.toHaveBeenCalled();
  });
});
