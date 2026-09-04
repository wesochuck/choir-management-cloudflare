import type { SyntheticEvent } from "react";

import type { DonationSettingsState } from "./types";

export function DonationPageSettingsTab({
  busy,
  portalButtonText,
  portalDescription,
  savePortalSettings,
  setPortalButtonText,
  setPortalDescription,
  settingsState,
}: {
  readonly busy: boolean;
  readonly portalButtonText: string;
  readonly portalDescription: string;
  readonly savePortalSettings: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
  readonly setPortalButtonText: (value: string) => void;
  readonly setPortalDescription: (value: string) => void;
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
        <label className="field">
          Call-to-action heading
          <input
            required
            maxLength={200}
            value={portalButtonText}
            onChange={(event) => {
              setPortalButtonText(event.target.value);
            }}
          />
        </label>
        <label className="field">
          Portal description
          <textarea
            maxLength={2000}
            rows={5}
            value={portalDescription}
            onChange={(event) => {
              setPortalDescription(event.target.value);
            }}
          />
        </label>
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save page settings"}
        </button>
      </fieldset>
    </form>
  );
}
