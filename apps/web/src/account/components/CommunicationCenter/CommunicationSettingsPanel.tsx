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
        <div>
          <h2>Communication settings</h2>
          <p className="field-help">
            Overview of outbound email sender configuration, delivery domains, and provider status.
          </p>
        </div>
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
      </fieldset>

      <section
        aria-labelledby="communication-sender-setup-title"
        className="communication-sender-setup"
      >
        <h3 id="communication-sender-setup-title">Configuring sender &amp; reply-to details</h3>
        <p>
          Organization Administrators can customize the sender display name, reply-to address, and
          custom sending domain in{" "}
          <a href="/admin/settings/email-settings">Email &amp; Sender Settings</a>.
        </p>
        <p className="field-help">
          If custom values are not configured, messages automatically use the verified platform
          default sender.
        </p>
      </section>
    </div>
  );
}
