import type { DiscountCode } from "@choir/contracts";
import { DataTable } from "@choir/ui";
import type { Dispatch, SetStateAction } from "react";

import { money } from "./shared";

export function DiscountCodeTable({
  busy,
  deactivateDiscountCode,
  deactivateDiscountCodeId,
  discountCodes,
  editDiscountCode,
  onViewRedemptions,
  reactivateDiscountCode,
  setDeactivateDiscountCodeId,
}: {
  readonly busy: boolean;
  readonly deactivateDiscountCode: (codeId: string) => Promise<void>;
  readonly deactivateDiscountCodeId: string | null;
  readonly discountCodes: readonly DiscountCode[];
  readonly editDiscountCode: (code: DiscountCode) => void;
  readonly onViewRedemptions: (code: DiscountCode) => void;
  readonly reactivateDiscountCode: (codeId: string) => Promise<void>;
  readonly setDeactivateDiscountCodeId: Dispatch<SetStateAction<string | null>>;
}) {
  return (
    <DataTable
      columns={[
        {
          header: "Code",
          id: "code",
          render: (code) => <strong>{code.code}</strong>,
          sortValue: (code) => code.code,
        },
        {
          header: "Eligible item",
          id: "item",
          render: (code) => code.itemTitle + " (" + code.itemType + ")",
          sortValue: (code) => code.itemTitle,
        },
        {
          header: "Discount",
          id: "discount",
          render: (code) =>
            code.discountType === "percentage"
              ? String(code.discountValue) + "%"
              : money(code.discountValue),
          sortValue: (code) => code.discountValue,
        },
        {
          header: "Redemptions",
          id: "redemptions",
          render: (code) => (
            <span className="discount-redemptions-cell">
              {code.redemptionCount > 0 ? (
                <>
                  <button
                    aria-label={`View ${String(code.redemptionCount)} redemptions for ${code.code}`}
                    className="text-button discount-redemptions-trigger"
                    onClick={() => {
                      onViewRedemptions(code);
                    }}
                    type="button"
                  >
                    {code.redemptionCount}
                  </button>
                  {code.redemptionLimit === null ? null : `/${String(code.redemptionLimit)}`}
                </>
              ) : (
                <span className="discount-redemptions-zero">
                  {code.redemptionCount}
                  {code.redemptionLimit === null ? "" : `/${String(code.redemptionLimit)}`}
                </span>
              )}
            </span>
          ),
          sortValue: (code) => code.redemptionCount,
        },
        {
          header: "Discounted revenue",
          id: "revenue",
          render: (code) => money(code.revenueCents),
          sortValue: (code) => code.revenueCents,
        },
        {
          header: "Status",
          id: "status",
          render: (code) =>
            code.editable ? (
              code.active ? (
                "Active"
              ) : (
                "Inactive"
              )
            ) : (
              <span title="Terms are locked after the first confirmed redemption.">
                {code.active ? "Active" : "Inactive"}
              </span>
            ),
          sortValue: (code) => (code.active ? 1 : 0),
        },
        {
          header: "Actions",
          id: "actions",
          render: (code) =>
            deactivateDiscountCodeId === code.id ? (
              <div className="danger-confirmation">
                <p>Deactivate this code?</p>
                <div className="form-actions">
                  <button
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() => {
                      setDeactivateDiscountCodeId(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="button button--danger"
                    disabled={busy}
                    onClick={() => void deactivateDiscountCode(code.id)}
                    type="button"
                  >
                    {busy ? "Deactivating…" : "Confirm"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="form-actions">
                {code.editable ? (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      editDiscountCode(code);
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                ) : null}
                {code.active ? (
                  <button
                    className="text-button text-button--danger"
                    disabled={busy}
                    onClick={() => {
                      setDeactivateDiscountCodeId(code.id);
                    }}
                    type="button"
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void reactivateDiscountCode(code.id)}
                    type="button"
                  >
                    Reactivate
                  </button>
                )}
              </div>
            ),
        },
      ]}
      initialSort={{ columnId: "code", direction: "asc" }}
      keySelector={(code) => code.id}
      rows={discountCodes}
    />
  );
}
