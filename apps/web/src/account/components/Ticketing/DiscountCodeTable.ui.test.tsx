import { discountCodeSchema, type DiscountCode } from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import { DiscountCodeTable } from "./DiscountCodeTable";

function discountCode(overrides: Partial<DiscountCode>): DiscountCode {
  return discountCodeSchema.parse({
    active: true,
    bundleId: null,
    code: "SPRING10",
    createdAt: "2026-07-01T00:00:00.000Z",
    deactivatedAt: null,
    discountAmountCents: 0,
    discountType: "percentage",
    discountValue: 10,
    editable: true,
    eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    firstRedeemedAt: null,
    id: "11111111-2222-4333-8444-555555555555",
    itemTitle: "Spring Concert",
    itemType: "performance",
    originalRevenueCents: 0,
    pendingReservationCount: 0,
    redemptionCount: 0,
    redemptionLimit: 10,
    revenueCents: 0,
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  });
}

function renderDiscountCodeTable(
  codes: readonly DiscountCode[],
  onViewRedemptions: (code: DiscountCode) => void = vi.fn(),
) {
  return render(
    <DiscountCodeTable
      busy={false}
      deactivateDiscountCode={vi.fn(() => Promise.resolve())}
      deactivateDiscountCodeId={null}
      discountCodes={codes}
      editDiscountCode={vi.fn()}
      onViewRedemptions={onViewRedemptions}
      setDeactivateDiscountCodeId={vi.fn()}
    />,
  );
}

describe("DiscountCodeTable redemption controls", () => {
  it("makes positive redemption counts actionable and leaves zero inert", async () => {
    const user = userEvent.setup();
    const onViewRedemptions = vi.fn();
    const positiveCode = discountCode({ redemptionCount: 3 });
    const zeroCode = discountCode({
      code: "WELCOME",
      id: "22222222-3333-4444-8555-666666666666",
    });
    renderDiscountCodeTable([positiveCode, zeroCode], onViewRedemptions);

    const table = screen.getByRole("table");
    const positiveButton = within(table).getByRole("button", {
      name: "View 3 redemptions for SPRING10",
    });
    expect(positiveButton).toHaveTextContent("3");
    expect(within(table).getByText("/10", { exact: true })).toBeInTheDocument();
    expect(within(table).getByText("0/10", { exact: true })).toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: "View 0 redemptions for WELCOME" }),
    ).not.toBeInTheDocument();

    await user.click(positiveButton);
    expect(onViewRedemptions).toHaveBeenCalledOnce();
    expect(onViewRedemptions).toHaveBeenCalledWith(positiveCode);
  });
});
