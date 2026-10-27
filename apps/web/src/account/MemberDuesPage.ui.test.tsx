import { duesRecordSchema, seasonSchema } from "@choir/contracts";
import { futureIsoDate } from "@choir/testkit";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { AuthApiError, createMyDuesCheckout, getMyDues } from "../auth/api";
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
    onlineDuesPaymentsAvailable: true,
    transactionFeeSettings: { fixedCents: 0, percentage: 0, passFeeToDonor: false },
  });
  render(<MemberDuesPage enabled />);
  await screen.findByRole("heading", { name: "Paid season" });
  const cards = screen.getAllByRole("listitem");
  const paid = cards.find((card) => within(card).queryByRole("heading", { name: "Paid season" }));
  if (!paid) throw new Error("Missing paid card");
  expect(within(paid).getByText("Paid in full", { exact: true })).toBeVisible();
  expect(within(paid).queryByRole("button", { name: "Pay dues" })).not.toBeInTheDocument();
  expect(within(paid).getByText("Amount due")).toBeVisible();
  expect(within(paid).getByText("$0.00", { exact: true })).toBeVisible();
  expect(within(paid).getByText(/Payment received: \$25.91/)).toBeVisible();
  expect(within(paid).queryByText("Total due")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Pay dues" })).toHaveLength(2);
});

it("hides Pay dues buttons and displays truthful message when online dues payments are not available", async () => {
  const at = futureIsoDate({ days: 2 });
  const seasons = [
    seasonSchema.parse({
      id: crypto.randomUUID(),
      name: "Unpaid season",
      createdAt: at,
      updatedAt: at,
      startsAt: at,
      endsAt: futureIsoDate({ days: 90 }),
      duesAmountCents: 2000,
      isActive: true,
    }),
  ];
  vi.mocked(getMyDues).mockResolvedValue({
    seasons,
    dues: [],
    onlineDuesPaymentsAvailable: false,
    transactionFeeSettings: { fixedCents: 0, percentage: 0, passFeeToDonor: false },
  });
  render(<MemberDuesPage enabled />);
  await screen.findByRole("heading", { name: "Unpaid season" });

  expect(
    screen.getByText(
      "Online dues payments are currently unavailable. Contact your Organization about another way to pay.",
    ),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Pay dues" })).not.toBeInTheDocument();
  expect(screen.getByText("Not paid")).toBeVisible();
  expect(screen.getAllByText("$20.00")).toHaveLength(2);
});

it("shows accessible error message and re-enables button if checkout attempt fails", async () => {
  const user = userEvent.setup();
  const at = futureIsoDate({ days: 2 });
  const seasons = [
    seasonSchema.parse({
      id: crypto.randomUUID(),
      name: "Spring Season",
      createdAt: at,
      updatedAt: at,
      startsAt: at,
      endsAt: futureIsoDate({ days: 90 }),
      duesAmountCents: 3500,
      isActive: true,
    }),
  ];
  vi.mocked(getMyDues).mockResolvedValue({
    seasons,
    dues: [],
    onlineDuesPaymentsAvailable: true,
    transactionFeeSettings: { fixedCents: 0, percentage: 0, passFeeToDonor: false },
  });
  vi.mocked(createMyDuesCheckout).mockRejectedValue(
    new AuthApiError(
      "Online dues payments are not enabled for this Organization.",
      409,
      "payments_not_activated",
    ),
  );

  render(<MemberDuesPage enabled />);
  await screen.findByRole("heading", { name: "Spring Season" });

  const payButton = screen.getByRole("button", { name: "Pay dues" });
  await user.click(payButton);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Online dues payments are not enabled for this Organization.");
  expect(screen.getByRole("button", { name: "Pay dues" })).toBeEnabled();
});

it("renders loading notice without showing false MFA prompt or unavailable warning while access is loading", () => {
  render(<MemberDuesPage accessStatus="loading" enabled={false} mfaRequired={false} />);
  expect(screen.getByText("Loading your member workspace…")).toBeVisible();
  expect(screen.queryByText(/Verify Organization MFA/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Your member workspace is not available yet/i)).not.toBeInTheDocument();
});

it("renders MFA prompt only when mfaRequired is true", () => {
  render(<MemberDuesPage accessStatus="ready" enabled={false} mfaRequired={true} />);
  expect(screen.getByText(/Verify Organization MFA to view your dues/i)).toBeVisible();
  expect(screen.queryByText("Loading your member workspace…")).not.toBeInTheDocument();
});

it("renders workspace not available only when accessStatus is none and MFA is not required", () => {
  render(<MemberDuesPage accessStatus="none" enabled={false} mfaRequired={false} />);
  expect(screen.getByText("Your member workspace is not available yet.")).toBeVisible();
  expect(screen.queryByText(/Verify Organization MFA/i)).not.toBeInTheDocument();
});
