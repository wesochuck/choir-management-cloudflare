import type { DiscountCode, OrganizationEvent, TicketBundle } from "@choir/contracts";
import type { Dispatch, SetStateAction, SyntheticEvent } from "react";

import { DiscountCodeForm } from "./DiscountCodeForm";
import { DiscountCodeTable } from "./DiscountCodeTable";
import type { DiscountDraft } from "./shared";

export function DiscountCodesPanel({
  bundles,
  busy,
  closeDiscountDialog,
  deactivateDiscountCode,
  deactivateDiscountCodeId,
  discountCodes,
  discountCodesLoadError,
  discountCodesLoading,
  discountDialogOpen,
  discountDraft,
  discountError,
  editDiscountCode,
  editingDiscountCodeId,
  openNewDiscountCode,
  saveDiscountCode,
  setDeactivateDiscountCodeId,
  setDiscountDraft,
  ticketEvents,
}: {
  readonly bundles: readonly TicketBundle[];
  readonly busy: boolean;
  readonly closeDiscountDialog: () => void;
  readonly deactivateDiscountCode: (codeId: string) => Promise<void>;
  readonly deactivateDiscountCodeId: string | null;
  readonly discountCodes: readonly DiscountCode[];
  readonly discountCodesLoadError: string | null;
  readonly discountCodesLoading: boolean;
  readonly discountDialogOpen: boolean;
  readonly discountDraft: DiscountDraft;
  readonly discountError?: string | null | undefined;
  readonly editDiscountCode: (code: DiscountCode) => void;
  readonly editingDiscountCodeId: string | null;
  readonly openNewDiscountCode: () => void;
  readonly saveDiscountCode: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
  readonly setDeactivateDiscountCodeId: Dispatch<SetStateAction<string | null>>;
  readonly setDiscountDraft: Dispatch<SetStateAction<DiscountDraft>>;
  readonly ticketEvents: readonly OrganizationEvent[];
}) {
  return (
    <div
      aria-labelledby="ticketing-discounts-tab"
      className="ticketing-tab-panel"
      id="ticketing-discounts-panel"
      role="tabpanel"
    >
      <div className="ticketing-page-header">
        <h3>Discount codes</h3>
        <button className="button button--primary" onClick={openNewDiscountCode} type="button">
          New discount code
        </button>
      </div>
      <DiscountCodeForm
        bundles={bundles}
        busy={busy}
        closeDiscountDialog={closeDiscountDialog}
        discountDialogOpen={discountDialogOpen}
        discountDraft={discountDraft}
        discountError={discountError}
        editingDiscountCodeId={editingDiscountCodeId}
        saveDiscountCode={saveDiscountCode}
        setDiscountDraft={setDiscountDraft}
        ticketEvents={ticketEvents}
      />
      {discountCodesLoading ? <p>Loading discount codes…</p> : null}
      {discountCodesLoadError ? (
        <p className="notice notice--error" role="alert">
          {discountCodesLoadError}
        </p>
      ) : null}
      {!discountCodesLoading && !discountCodesLoadError && discountCodes.length === 0 ? (
        <div className="empty-state">
          <p>No discount codes yet.</p>
          <button className="button button--primary" onClick={openNewDiscountCode} type="button">
            Create your first discount code
          </button>
        </div>
      ) : null}
      {discountCodes.length > 0 ? (
        <DiscountCodeTable
          busy={busy}
          deactivateDiscountCode={deactivateDiscountCode}
          deactivateDiscountCodeId={deactivateDiscountCodeId}
          discountCodes={discountCodes}
          editDiscountCode={editDiscountCode}
          setDeactivateDiscountCodeId={setDeactivateDiscountCodeId}
        />
      ) : null}
    </div>
  );
}
