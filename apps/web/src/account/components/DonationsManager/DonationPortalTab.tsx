import { QRCodeShareCard } from "../../QRCodeShareCard";
import type { DonationSettingsState } from "./types";

export function DonationPortalTab({
  settingsState,
}: {
  readonly settingsState: DonationSettingsState;
}) {
  if (settingsState.status === "loading") return <p>Loading donation settings…</p>;
  if (settingsState.status === "error") {
    return <p className="notice notice--error">Donation settings could not be loaded.</p>;
  }
  return (
    <QRCodeShareCard
      asFieldset
      description="Share this page with supporters so they can choose a donation level or enter a custom amount."
      path="/donate"
      title="Public donation page"
    />
  );
}
