import { useEffect, useState } from "react";
import { usePersistedDraft } from "../persistence";
import {
  getCheckoutReminderSettings,
  updateCheckoutReminderSettings,
} from "../api/checkoutReminders";

export function CheckoutReminderSettingsPanel() {
  const [initial, setInitial] = useState<{ enabled: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const { draft, error, saving, updateField } = usePersistedDraft<{ enabled: boolean }>({
    initialValue: initial,
    resourceKey: "checkout-reminder-settings",
    save: async (value) => {
      const saved = await updateCheckoutReminderSettings(value.enabled);
      return { enabled: saved.enabled };
    },
    onSaveSuccess: () => {
      setSuccess(true);
    },
  });
  useEffect(() => {
    const controller = new AbortController();
    getCheckoutReminderSettings(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setInitial({ enabled: value.enabled });
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(
            failure instanceof Error ? failure.message : "Reminder settings could not be loaded.",
          );
      });
    return () => {
      controller.abort();
    };
  }, []);
  return (
    <fieldset className="surface-card organization-settings-panel" disabled={saving}>
      <legend>Incomplete checkout reminders</legend>
      {loadError || error ? (
        <p className="notice notice--error" role="alert">
          {loadError ?? error}
        </p>
      ) : null}
      {success ? <p role="status">Reminder settings saved.</p> : null}
      {!draft ? (
        !loadError ? (
          <p role="status">Loading reminder settings…</p>
        ) : null
      ) : (
        <>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => {
                setSuccess(false);
                updateField("enabled", event.target.checked);
              }}
            />
            <span>Send incomplete checkout reminders</span>
          </label>
          <p className="field-help">
            Send one gentle email 24 hours after someone starts a ticket purchase or donation but
            does not finish. Each email address receives at most one reminder every 30 days.
            Recipients can stop future reminders.
          </p>
          <p className="field-help">
            Turning this off also stops reminders waiting to send. Turning it back on covers only
            new checkouts.
          </p>
          <a href="/admin/communications?tab=templates">Edit reminder templates</a>
        </>
      )}
    </fieldset>
  );
}
