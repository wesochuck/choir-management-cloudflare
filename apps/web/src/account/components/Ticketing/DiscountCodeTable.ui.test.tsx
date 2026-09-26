import { discountCodeSchema, type DiscountCode } from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { Dispatch, SetStateAction } from "react";
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
  options: {
    readonly deactivateDiscountCode?: (codeId: string) => Promise<void>;
    readonly editDiscountCode?: (code: DiscountCode) => void;
    readonly onViewRedemptions?: (code: DiscountCode) => void;
    readonly reactivateDiscountCode?: (codeId: string) => Promise<void>;
    readonly setDeactivateDiscountCodeId?: Dispatch<SetStateAction<string | null>>;
  } = {},
) {
  return render(
    <DiscountCodeTable
      busy={false}
      deactivateDiscountCode={options.deactivateDiscountCode ?? vi.fn(() => Promise.resolve())}
      deactivateDiscountCodeId={null}
      discountCodes={codes}
      editDiscountCode={options.editDiscountCode ?? vi.fn()}
      onViewRedemptions={options.onViewRedemptions ?? vi.fn()}
      reactivateDiscountCode={options.reactivateDiscountCode ?? vi.fn(() => Promise.resolve())}
      setDeactivateDiscountCodeId={options.setDeactivateDiscountCodeId ?? vi.fn()}
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
    renderDiscountCodeTable([positiveCode, zeroCode], { onViewRedemptions });

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

  it("exposes appropriate Edit, Deactivate, and Reactivate actions based on active status and term lock", async () => {
    const user = userEvent.setup();
    const reactivateDiscountCode = vi.fn(() => Promise.resolve());
    const editDiscountCode = vi.fn();
    const setDeactivateDiscountCodeId = vi.fn();

    const activeEditable = discountCode({
      active: true,
      code: "ACTIVE_EDITABLE",
      editable: true,
      id: "11111111-1111-4111-8111-111111111111",
      redemptionCount: 0,
    });
    const activeLocked = discountCode({
      active: true,
      code: "ACTIVE_LOCKED",
      editable: false,
      id: "22222222-2222-4222-8222-222222222222",
      redemptionCount: 2,
    });
    const inactiveEditable = discountCode({
      active: false,
      code: "INACTIVE_EDITABLE",
      editable: true,
      id: "33333333-3333-4333-8333-333333333333",
      redemptionCount: 0,
    });
    const inactiveLocked = discountCode({
      active: false,
      code: "INACTIVE_LOCKED",
      editable: false,
      id: "44444444-4444-4444-8444-444444444444",
      redemptionCount: 5,
    });

    renderDiscountCodeTable([activeEditable, activeLocked, inactiveEditable, inactiveLocked], {
      editDiscountCode,
      reactivateDiscountCode,
      setDeactivateDiscountCodeId,
    });

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    const [rowEl0, rowEl1, rowEl2, rowEl3] = rows;
    expect(rowEl0).toBeDefined();
    expect(rowEl1).toBeDefined();
    expect(rowEl2).toBeDefined();
    expect(rowEl3).toBeDefined();
    if (!rowEl0 || !rowEl1 || !rowEl2 || !rowEl3) {
      throw new Error("Expected 4 rows");
    }

    // Row 0: Active + editable -> Edit, Deactivate
    const row0 = within(rowEl0);
    expect(row0.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(row0.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    expect(row0.queryByRole("button", { name: "Reactivate" })).not.toBeInTheDocument();

    // Row 1: Active + locked -> Deactivate only
    const row1 = within(rowEl1);
    expect(row1.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(row1.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    expect(row1.queryByRole("button", { name: "Reactivate" })).not.toBeInTheDocument();

    // Row 2: Inactive + editable -> Edit, Reactivate
    const row2 = within(rowEl2);
    expect(row2.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(row2.getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    expect(row2.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();

    // Row 3: Inactive + locked -> Reactivate only (no Edit)
    const row3 = within(rowEl3);
    expect(row3.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(row3.getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    expect(row3.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();

    // Reactivation calls reactivateDiscountCode without opening edit dialog
    await user.click(row3.getByRole("button", { name: "Reactivate" }));
    expect(reactivateDiscountCode).toHaveBeenCalledOnce();
    expect(reactivateDiscountCode).toHaveBeenCalledWith(inactiveLocked.id);
    expect(editDiscountCode).not.toHaveBeenCalled();
  });
});
