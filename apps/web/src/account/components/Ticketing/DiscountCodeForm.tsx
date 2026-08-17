import type { OrganizationEvent, TicketBundle } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import type { Dispatch, SetStateAction, SyntheticEvent } from "react";

import type { DiscountDraft } from "./shared";

export function DiscountCodeForm({
  bundles,
  busy,
  closeDiscountDialog,
  discountDialogOpen,
  discountDraft,
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
  readonly editingDiscountCodeId: string | null;
  readonly saveDiscountCode: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
  readonly setDiscountDraft: Dispatch<SetStateAction<DiscountDraft>>;
  readonly ticketEvents: readonly OrganizationEvent[];
}) {
  const eligibleItem = discountDraft.eventId
    ? "event:" + discountDraft.eventId
    : discountDraft.bundleId
      ? "bundle:" + discountDraft.bundleId
      : "";
  const fixedValue =
    discountDraft.discountType === "fixed" &&
    discountDraft.discountValue &&
    !discountDraft.discountValue.includes(".")
      ? (Number(discountDraft.discountValue) / 100).toFixed(2)
      : discountDraft.discountValue;

  return (
    <Dialog
      description="Set the eligible item, discount, and optional Organization-wide redemption limit."
      onClose={closeDiscountDialog}
      open={discountDialogOpen}
      title={editingDiscountCodeId ? "Edit discount code" : "New discount code"}
    >
      <form className="form-stack" onSubmit={(event) => void saveDiscountCode(event)}>
        <label className="field">
          Code
          <input
            required
            maxLength={64}
            value={discountDraft.code}
            onChange={(event) => {
              setDiscountDraft((current) => ({ ...current, code: event.target.value }));
            }}
          />
        </label>
        <label className="field">
          Eligible item
          <select
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
        </label>
        <div className="form-grid form-grid--two">
          <label className="field">
            Discount type
            <select
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
          </label>
          <label className="field">
            {discountDraft.discountType === "percentage"
              ? "Percentage (1–100)"
              : "Amount per unit (USD)"}
            <input
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
          </label>
        </div>
        <label className="field">
          Redemption limit (blank is unlimited)
          <input
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
        </label>
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
        <div className="form-actions">
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
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
        </div>
      </form>
    </Dialog>
  );
}
