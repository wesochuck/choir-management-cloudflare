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
  setDeactivateDiscountCodeId,
}: {
  readonly busy: boolean;
  readonly deactivateDiscountCode: (codeId: string) => Promise<void>;
  readonly deactivateDiscountCodeId: string | null;
  readonly discountCodes: readonly DiscountCode[];
  readonly editDiscountCode: (code: DiscountCode) => void;
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
          render: (code) =>
            String(code.redemptionCount) +
            (code.redemptionLimit === null ? "" : "/" + String(code.redemptionLimit)),
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
          render: (code) => (code.active ? "Active" : "Inactive"),
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
                <button
                  className="text-button"
                  disabled={busy || !code.editable}
                  onClick={() => {
                    editDiscountCode(code);
                  }}
                  title={
                    code.editable
                      ? undefined
                      : "Terms are locked after the first confirmed redemption."
                  }
                  type="button"
                >
                  Edit
                </button>
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
                ) : null}
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
