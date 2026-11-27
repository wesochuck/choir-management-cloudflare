import type {
  OrganizationEmailSettings,
  OrganizationProviderStatusResponse,
} from "@choir/contracts";

interface CommunicationSettingsPanelProps {
  readonly emailSettings: OrganizationEmailSettings | null;
  readonly providerStatus: OrganizationProviderStatusResponse | null;
}

export function CommunicationSettingsPanel({
  emailSettings,
  providerStatus,
}: CommunicationSettingsPanelProps) {
  const fromName =
    emailSettings?.fromName ?? providerStatus?.emailSender.fromName ?? "Choir Management";

  const fromEmail =
    emailSettings?.customDomainStatus === "active" && emailSettings.customDomain
      ? `announcements@${emailSettings.customDomain}`
      : (providerStatus?.emailSender.fromEmail ?? "Not configured");

  const replyTo = emailSettings?.replyToEmail ?? "None (replies sent to sender address)";

  const sendingDomain = emailSettings?.customDomain
    ? `${emailSettings.customDomain} (${emailSettings.customDomainStatus})`
    : "Platform default";

  return (
    <div className="communication-settings-panel">
      <div className="communication-settings-panel__header">
        <h2>Communication settings</h2>
      </div>

      <fieldset className="communication-sender-details-card">
        <legend>Sender details</legend>
        <dl aria-label="Configured sender details" className="communication-sender-details">
          <div>
            <dt>From name</dt>
            <dd>{fromName}</dd>
          </div>
          <div>
            <dt>From email</dt>
            <dd>{fromEmail}</dd>
          </div>
          <div>
            <dt>Reply-to email</dt>
            <dd>{replyTo}</dd>
          </div>
          <div>
            <dt>Sending domain</dt>
            <dd>{sendingDomain}</dd>
          </div>
        </dl>
        <a className="button button--secondary" href="/admin/settings?tab=email">
          Edit sender settings
        </a>
      </fieldset>
    </div>
  );
}
