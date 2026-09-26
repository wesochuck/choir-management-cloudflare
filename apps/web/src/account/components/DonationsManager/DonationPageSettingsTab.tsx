import type { SyntheticEvent } from "react";

import type { DonationSettingsState } from "./types";

export function DonationPageSettingsTab({
  busy,
  portalButtonText,
  portalDescription,
  portalThankYouMessage,
  savePortalSettings,
  setPortalButtonText,
  setPortalDescription,
  setPortalThankYouMessage,
  settingsState,
}: {
  readonly busy: boolean;
  readonly portalButtonText: string;
  readonly portalDescription: string;
  readonly portalThankYouMessage: string;
  readonly savePortalSettings: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
  readonly setPortalButtonText: (value: string) => void;
  readonly setPortalDescription: (value: string) => void;
  readonly setPortalThankYouMessage: (value: string) => void;
  readonly settingsState: DonationSettingsState;
}) {
  if (settingsState.status === "loading") return <p>Loading donation settings…</p>;
  if (settingsState.status === "error") {
    return <p className="notice notice--error">Donation settings could not be loaded.</p>;
  }
  return (
    <form onSubmit={(event) => void savePortalSettings(event)}>
      <fieldset className="surface-card form-stack donation-page-settings">
        <legend>Donation page settings</legend>
        <div>
          <p>Customize the headline and explanation shown to donors before checkout.</p>
        </div>
        <div className="field">
          <label htmlFor="donation-portal-cta-heading">Call-to-action heading</label>
          <input
            id="donation-portal-cta-heading"
            required
            maxLength={200}
            value={portalButtonText}
            onChange={(event) => {
              setPortalButtonText(event.target.value);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="donation-portal-description">Portal description</label>
          <textarea
            id="donation-portal-description"
            maxLength={2000}
            rows={5}
            value={portalDescription}
            onChange={(event) => {
              setPortalDescription(event.target.value);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="donation-portal-thank-you">Thank-you message after donation</label>
          <textarea
            aria-describedby="donation-portal-thank-you-help"
            id="donation-portal-thank-you"
            required
            maxLength={2000}
            rows={5}
            value={portalThankYouMessage}
            onChange={(event) => {
              setPortalThankYouMessage(event.target.value);
            }}
          />
          <p className="field-help" id="donation-portal-thank-you-help">
            Shown after a successful gift. Use plain text; this message cannot contain HTML.
          </p>
        </div>
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save page settings"}
        </button>
      </fieldset>
    </form>
  );
}
