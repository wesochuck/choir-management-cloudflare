import type { OrganizationAuditionSettings } from "@choir/contracts";
import type { AdministratorRecipient } from "../types";

export function AdminNotificationsSection({
  administratorRecipients,
  draft,
  onAddRecipient,
  onRemoveRecipient,
  onToggleAdminNotify,
  onToggleAdministrator,
  recipientEmail,
  setRecipientEmail,
}: {
  readonly administratorRecipients: readonly AdministratorRecipient[];
  readonly draft: OrganizationAuditionSettings;
  readonly onAddRecipient: () => void;
  readonly onRemoveRecipient: (email: string) => void;
  readonly onToggleAdminNotify: (enabled: boolean) => void;
  readonly onToggleAdministrator: (recipient: AdministratorRecipient, checked: boolean) => void;
  readonly recipientEmail: string;
  readonly setRecipientEmail: (email: string) => void;
}) {
  return (
    <fieldset className="surface-card organization-settings-panel form-stack">
      <legend>Administrator notifications</legend>
      <label className="checkbox-field">
        <input
          checked={draft.adminNotifyEnabled}
          onChange={(event) => {
            onToggleAdminNotify(event.target.checked);
          }}
          type="checkbox"
        />
        Notify administrators when an inquiry arrives
      </label>
      {draft.adminNotifyEnabled ? (
        <>
          <fieldset className="form-stack">
            <legend>Roster administrators</legend>
            <p className="field-help">
              Select linked Organization owners and administrators. A Profile must allow
              administrator notifications to receive inquiry emails.
            </p>
            {administratorRecipients.length > 0 ? (
              <div className="form-stack">
                {administratorRecipients.map((recipient) => {
                  const eligible =
                    recipient.profile.receiveAdminNotifications && !recipient.profile.doNotEmail;
                  return (
                    <label className="checkbox-row" key={recipient.profile.id}>
                      <input
                        checked={draft.adminNotifyUsers.includes(recipient.email)}
                        disabled={!eligible}
                        onChange={(event) => {
                          onToggleAdministrator(recipient, event.target.checked);
                        }}
                        type="checkbox"
                      />
                      <span>
                        {recipient.profile.displayName} · {recipient.email}
                        <small className="field-help">
                          {!eligible
                            ? "Emails disabled in this Profile"
                            : recipient.role === "owner"
                              ? "Owner"
                              : "Administrator"}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="notice">
                No linked roster administrators are available. Link an owner or administrator to a
                Profile to select them here.
              </p>
            )}
          </fieldset>
          <fieldset className="form-stack">
            <legend>Additional recipients</legend>
            <p className="field-help">
              Add any additional email addresses that should receive inquiry notifications.
            </p>
            <div className="form-actions">
              <input
                aria-label="Administrator notification email"
                onChange={(event) => {
                  setRecipientEmail(event.target.value);
                }}
                placeholder="Additional email address (optional)"
                type="email"
                value={recipientEmail}
              />
              <button className="button button--secondary" onClick={onAddRecipient} type="button">
                Add additional recipient
              </button>
            </div>
            {draft.adminNotifyUsers.length > 0 ? (
              <ul className="account-list">
                {draft.adminNotifyUsers.map((email) => (
                  <li className="flex items-center justify-between gap-2" key={email}>
                    <span>{email}</span>
                    <button
                      className="text-button text-button--danger"
                      onClick={() => {
                        onRemoveRecipient(email);
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="notice">No additional recipients added.</p>
            )}
          </fieldset>
        </>
      ) : null}
    </fieldset>
  );
}
