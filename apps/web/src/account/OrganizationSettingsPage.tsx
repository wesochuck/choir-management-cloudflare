import { useEffect, useState } from "react";

import {
  AuthApiError,
  getOrganizationCalendarSettings,
  updateOrganizationCalendarSettings,
} from "../auth/api";
import { RosterConfiguration } from "./RosterConfiguration";

export function OrganizationSettingsPage({ enabled }: { readonly enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getOrganizationCalendarSettings(controller.signal)
      .then((settings) => {
        setTimezone(settings.timezone);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError("Organization settings could not be loaded.");
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  async function saveTimezone() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const settings = await updateOrganizationCalendarSettings(timezone);
      setTimezone(settings.timezone);
      setSuccess("Organization timezone updated.");
    } catch (saveError: unknown) {
      setError(
        saveError instanceof AuthApiError
          ? saveError.message
          : "The Organization timezone could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <p className="notice notice--warning">
        Verify Organization MFA to change Organization settings.
      </p>
    );
  }

  return (
    <div className="settings-stack">
      <section className="surface-card" aria-labelledby="calendar-settings-title">
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">Events</p>
          <h2 id="calendar-settings-title">Calendar settings</h2>
        </div>
        {loading ? <p role="status">Loading calendar settings…</p> : null}
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="notice notice--success" role="status">
            {success}
          </p>
        ) : null}
        {!loading ? (
          <form
            className="form-stack settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTimezone();
            }}
          >
            <div className="field">
              <label htmlFor="settings-timezone">IANA timezone</label>
              <input
                id="settings-timezone"
                list="settings-timezones"
                maxLength={100}
                onChange={(event) => {
                  setTimezone(event.target.value);
                }}
                required
                value={timezone}
              />
              <datalist id="settings-timezones">
                <option value="UTC" />
                <option value="America/New_York" />
                <option value="America/Chicago" />
                <option value="America/Denver" />
                <option value="America/Los_Angeles" />
              </datalist>
            </div>
            <button className="button button--primary" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save timezone"}
            </button>
          </form>
        ) : null}
      </section>
      <RosterConfiguration enabled={enabled} />
    </div>
  );
}
