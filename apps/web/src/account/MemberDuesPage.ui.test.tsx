import { duesRecordSchema, seasonSchema } from "@choir/contracts";
import { futureIsoDate } from "@choir/testkit";
import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { getMyDues } from "../auth/api";
import { MemberDuesPage } from "./MemberDuesPage";

vi.mock("../auth/api", () => ({
  AuthApiError: class extends Error {},
  getMyDues: vi.fn(),
  createMyDuesCheckout: vi.fn(),
}));

it("keeps dues amounts and payment eligibility correct for paid, expired, and missing records", async () => {
  const at = futureIsoDate({ days: 2 });
  const seasons = ["Paid season", "Expired season", "Unpaid season"].map((name) =>
    seasonSchema.parse({
      id: crypto.randomUUID(),
      name,
      createdAt: at,
      updatedAt: at,
      startsAt: at,
      endsAt: futureIsoDate({ days: 90 }),
      duesAmountCents: 2000,
      isActive: true,
    }),
  );
  const dues = seasons.slice(0, 2).map((season, index) =>
    duesRecordSchema.parse({
      id: crypto.randomUUID(),
      seasonId: season.id,
      profileId: crypto.randomUUID(),
      createdAt: at,
      updatedAt: at,
      paidAt: index === 0 ? at : null,
      amountCents: 2500,
      feeCents: 91,
      status: index === 0 ? "paid" : "expired",
    }),
  );
  const first = dues[0];
  if (!first) throw new Error("Missing fixture");
  vi.mocked(getMyDues).mockResolvedValue({
    seasons,
    dues: [...dues, { ...first, status: "expired", amountCents: 9900 }],
    transactionFeeSettings: { fixedCents: 0, percentage: 0, passFeeToDonor: false },
  });
  render(<MemberDuesPage enabled />);
  await screen.findByRole("heading", { name: "Paid season" });
  const cards = screen.getAllByRole("listitem");
  const paid = cards.find((card) => within(card).queryByRole("heading", { name: "Paid season" }));
  if (!paid) throw new Error("Missing paid card");
  expect(within(paid).getByText("Paid", { exact: true })).toBeVisible();
  expect(within(paid).queryByRole("button", { name: "Pay dues" })).not.toBeInTheDocument();
  expect(
    within(paid).getByText(
      new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(25.91),
    ),
  ).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Pay dues" })).toHaveLength(2);
});
