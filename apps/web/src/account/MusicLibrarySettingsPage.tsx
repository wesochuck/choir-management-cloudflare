import type { OrganizationMusicLibrarySettings } from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  getOrganizationMusicLibrarySettings,
  updateOrganizationMusicLibrarySettings,
} from "../auth/api";
import { AppLink } from "./components/AuthenticatedShell/navigation";

export function MusicLibrarySettingsPage({
  enabled,
  navigate,
}: {
  readonly enabled: boolean;
  readonly navigate: (href: string) => void;
}) {
  const [settings, setSettings] = useState<OrganizationMusicLibrarySettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<OrganizationMusicLibrarySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getOrganizationMusicLibrarySettings(controller.signal)
      .then((loaded) => {
        setSettings(loaded);
        setSavedSettings(loaded);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(
          caught instanceof AuthApiError
            ? caught.message
            : "Music library settings could not be loaded.",
        );
        setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  async function save(): Promise<void> {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await updateOrganizationMusicLibrarySettings({
        ...settings,
        publisherSearchTemplate: settings.publisherSearchTemplate.trim(),
      });
      setSettings(saved);
      setSavedSettings(saved);
      setSuccess("Music library settings updated.");
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "Music library settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <p className="notice notice--warning">
        Verify Organization MFA to change Music library settings.
      </p>
    );
  }

  return (
    <section
      className="account-section music-library-settings-section"
      aria-label="Music library settings"
    >
      <div className="section-heading section-heading--compact">
        <p className="section-description">
          Configure publisher catalog links and the expiry period for public practice-player links.
        </p>
      </div>
      <nav className="music-library-tabs" aria-label="Music library sections">
        <AppLink href="/admin/library" onNavigate={navigate}>
          Library
        </AppLink>
        <AppLink ariaCurrent="page" href="/admin/library/settings" onNavigate={navigate}>
          Settings <span className="sr-only">(current)</span>
        </AppLink>
      </nav>
      {loading ? <p role="status">Loading music library settings…</p> : null}
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
      {settings && savedSettings ? (
        <section
          className="music-publisher-settings"
          aria-labelledby="music-library-settings-title"
        >
          <div>
            <p className="eyebrow">Music library setting</p>
            <h2 id="music-library-settings-title">Publisher catalog search</h2>
            <p>
              Add the publisher’s HTTPS search URL and use <code>{"{catalogId}"}</code> where the
              catalog number belongs. Matching rows will include a direct Search link.
            </p>
          </div>
          <form
            className="music-publisher-settings__form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className="field">
              Publisher search URL template
              <input
                aria-describedby="music-publisher-settings-help"
                placeholder="https://publisher.example/search?catalog={catalogId}"
                type="text"
                value={settings.publisherSearchTemplate}
                onChange={(event) => {
                  setSettings((current) =>
                    current ? { ...current, publisherSearchTemplate: event.target.value } : current,
                  );
                  setError(null);
                  setSuccess(null);
                }}
              />
              <small className="field-help" id="music-publisher-settings-help">
                Leave blank to hide publisher links. HTTPS and the exact{" "}
                <code>{"{catalogId}"}</code> placeholder are required.
              </small>
            </label>
            <label className="field">
              Public practice link lifetime (days)
              <input
                min="1"
                max="3650"
                type="number"
                value={settings.practicePlayerLinkLifetimeDays}
                onChange={(event) => {
                  setSettings((current) =>
                    current
                      ? { ...current, practicePlayerLinkLifetimeDays: Number(event.target.value) }
                      : current,
                  );
                  setError(null);
                  setSuccess(null);
                }}
              />
              <small className="field-help">
                Existing links keep their expiry. New links default to 180 days and can be rotated
                by an administrator.
              </small>
            </label>
            <button
              className="button button--secondary"
              disabled={
                busy ||
                (settings.publisherSearchTemplate.trim() ===
                  savedSettings.publisherSearchTemplate &&
                  settings.practicePlayerLinkLifetimeDays ===
                    savedSettings.practicePlayerLinkLifetimeDays)
              }
              type="submit"
            >
              {busy ? "Saving…" : "Save settings"}
            </button>
          </form>
        </section>
      ) : null}
    </section>
  );
}
