import type { OrganizationEvent, TicketBundle } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import type { Dispatch, SetStateAction, SyntheticEvent } from "react";

import type { DiscountDraft } from "./shared";

function getEligibleItem(draft: DiscountDraft): string {
  if (draft.eventId) return "event:" + draft.eventId;
  if (draft.bundleId) return "bundle:" + draft.bundleId;
  return "";
}

function getFixedValue(draft: DiscountDraft): string {
  if (draft.discountType === "fixed" && draft.discountValue && !draft.discountValue.includes(".")) {
    return (Number(draft.discountValue) / 100).toFixed(2);
  }
  return draft.discountValue;
}

export function DiscountCodeForm({
  bundles,
  busy,
  closeDiscountDialog,
  discountDialogOpen,
  discountDraft,
  discountError,
  editingDiscountCodeId,
  saveDiscountCode,
  setDiscountDraft,
  ticketEvents,
}: {
  readonly bundles: readonly TicketBundle[];
  readonly busy: boolean;
  readonly closeDiscountDialog: () => void;
  readonly discountDialogOpen: boolean;
  readonly discountDraft: DiscountDraft;
  readonly discountError?: string | null | undefined;
  readonly editingDiscountCodeId: string | null;
  readonly saveDiscountCode: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
  readonly setDiscountDraft: Dispatch<SetStateAction<DiscountDraft>>;
  readonly ticketEvents: readonly OrganizationEvent[];
}) {
  const eligibleItem = getEligibleItem(discountDraft);
  const fixedValue = getFixedValue(discountDraft);

  return (
    <Dialog
      description="Set the eligible item, discount, and optional Organization-wide redemption limit."
      onClose={closeDiscountDialog}
      open={discountDialogOpen}
      title={editingDiscountCodeId ? "Edit discount code" : "New discount code"}
    >
      {discountError ? (
        <p className="notice notice--error" role="alert">
          {discountError}
        </p>
      ) : null}
      <form className="form-stack" onSubmit={(event) => void saveDiscountCode(event)}>
        <div className="field">
          <label htmlFor="discount-code">Code</label>
          <input
            id="discount-code"
            required
            maxLength={64}
            value={discountDraft.code}
            onChange={(event) => {
              setDiscountDraft((current) => ({ ...current, code: event.target.value }));
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="discount-eligible-item">Eligible item</label>
          <select
            id="discount-eligible-item"
            required
            value={eligibleItem}
            onChange={(event) => {
              const [kind, id] = event.target.value.split(":");
              setDiscountDraft((current) => ({
                ...current,
                bundleId: kind === "bundle" ? (id ?? null) : null,
                eventId: kind === "event" ? (id ?? null) : null,
              }));
            }}
          >
            <option value="">Choose a performance or bundle</option>
            <optgroup label="Performances">
              {ticketEvents.map((event) => (
                <option key={event.id} value={"event:" + event.id}>
                  {event.title}
                </option>
              ))}
            </optgroup>
            <optgroup label="Ticket bundles">
              {bundles.map((bundle) => (
                <option key={bundle.id} value={"bundle:" + bundle.id}>
                  {bundle.title}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <fieldset className="fieldset-container">
          <legend>Discount amount</legend>
          <div className="form-grid form-grid--two">
            <div className="field">
              <label htmlFor="discount-type">Discount type</label>
              <select
                id="discount-type"
                value={discountDraft.discountType}
                onChange={(event) => {
                  const type = event.target.value === "fixed" ? "fixed" : "percentage";
                  setDiscountDraft((current) => ({
                    ...current,
                    discountType: type,
                  }));
                }}
              >
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed amount per unit</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="discount-value">
                {discountDraft.discountType === "percentage"
                  ? "Percentage (1–100)"
                  : "Amount per unit (USD)"}
              </label>
              <input
                id="discount-value"
                required
                min={discountDraft.discountType === "percentage" ? 1 : 0}
                max={discountDraft.discountType === "percentage" ? 100 : undefined}
                step={discountDraft.discountType === "percentage" ? 1 : 0.01}
                type="number"
                value={fixedValue}
                onChange={(event) => {
                  setDiscountDraft((current) => ({
                    ...current,
                    discountValue:
                      current.discountType === "fixed"
                        ? String(Math.round(Number(event.target.value) * 100))
                        : event.target.value,
                  }));
                }}
              />
            </div>
          </div>
        </fieldset>
        <div className="field">
          <label className="field__label-row" htmlFor="discount-redemption-limit">
            <span>Redemption limit</span>{" "}
            <span className="field-help field-help--inline">(blank is unlimited)</span>
          </label>
          <input
            id="discount-redemption-limit"
            min="1"
            step="1"
            type="number"
            value={discountDraft.redemptionLimit}
            onChange={(event) => {
              setDiscountDraft((current) => ({
                ...current,
                redemptionLimit: event.target.value,
              }));
            }}
          />
        </div>
        {editingDiscountCodeId ? null : (
          <label>
            <input
              checked={discountDraft.active}
              type="checkbox"
              onChange={(event) => {
                setDiscountDraft((current) => ({
                  ...current,
                  active: event.target.checked,
                }));
              }}
            />{" "}
            Available for redemption
          </label>
        )}
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
          <button
            className="button button--primary"
            disabled={
              busy ||
              (!discountDraft.eventId && !discountDraft.bundleId) ||
              !discountDraft.discountValue
            }
            type="submit"
          >
            {busy ? "Saving…" : "Save discount code"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
