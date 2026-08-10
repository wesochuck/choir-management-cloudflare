import type { TicketConfirmationSettings } from "@choir/contracts";
import type { Dispatch, SetStateAction, SyntheticEvent } from "react";

export function ConfirmationPanel({
  confirmationDraft,
  confirmationLoadError,
  confirmationLoaded,
  confirmationSaving,
  onSubmit,
  setConfirmationDraft,
}: {
  readonly confirmationDraft: TicketConfirmationSettings;
  readonly confirmationLoadError: string | null;
  readonly confirmationLoaded: boolean;
  readonly confirmationSaving: boolean;
  readonly onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  readonly setConfirmationDraft: Dispatch<SetStateAction<TicketConfirmationSettings>>;
}) {
  return confirmationLoaded ? (
    <form
      aria-labelledby="ticketing-confirmation-tab"
      className="ticket-confirmation-settings"
      id="ticketing-confirmation-panel"
      onSubmit={(event) => {
        onSubmit(event);
      }}
      role="tabpanel"
    >
      <div>
        <p className="eyebrow">Confirmation page</p>
        <h3>Ticket sales wording</h3>
        <p>Customize the messages shown to buyers after they purchase tickets.</p>
      </div>
      <div className="ticket-confirmation-settings__grid">
        <label className="field">
          Success Message
          <textarea
            onChange={(event) => {
              setConfirmationDraft((current) => ({
                ...current,
                successMessage: event.target.value,
              }));
            }}
            rows={3}
            value={confirmationDraft.successMessage}
          />
        </label>
        <label className="field">
          Pending / Unverified Message
          <textarea
            onChange={(event) => {
              setConfirmationDraft((current) => ({
                ...current,
                pendingMessage: event.target.value,
              }));
            }}
            rows={3}
            value={confirmationDraft.pendingMessage}
          />
        </label>
        <label className="field">
          Will Call Instructions
          <textarea
            onChange={(event) => {
              setConfirmationDraft((current) => ({
                ...current,
                willCallInstructions: event.target.value,
              }));
            }}
            rows={4}
            value={confirmationDraft.willCallInstructions}
          />
        </label>
        <label className="field">
          QR Code Instructions
          <textarea
            onChange={(event) => {
              setConfirmationDraft((current) => ({
                ...current,
                qrCodeInstructions: event.target.value,
              }));
            }}
            rows={4}
            value={confirmationDraft.qrCodeInstructions}
          />
        </label>
      </div>
      <div className="form-actions">
        <button className="button button--primary" disabled={confirmationSaving} type="submit">
          {confirmationSaving ? "Saving…" : "Save ticket wording"}
        </button>
      </div>
    </form>
  ) : (
    <div
      aria-labelledby="ticketing-confirmation-tab"
      id="ticketing-confirmation-panel"
      role="tabpanel"
    >
      <p className="notice notice--error" role="alert">
        {confirmationLoadError ?? "Loading ticket confirmation wording…"}
      </p>
    </div>
  );
}
