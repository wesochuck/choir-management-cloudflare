import type { OrganizationMusicLibrarySettings, OrganizationMusicPiece } from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";

import {
  AuthApiError,
  getOrganizationMusicLibrarySettings,
  listOrganizationMusic,
  updateOrganizationMusicLibrarySettings,
} from "../auth/api";
import { AppLink } from "./components/AuthenticatedShell/navigation";
import { GenreChip } from "./components/MusicCatalog/shared";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";
import { genreKey, uniqueGenreLabels } from "./components/MusicCatalog/utils";
import { useFloatingSaveAction } from "./useFloatingSaveAction";

interface MusicPublisherSettingsProps {
  readonly busy: boolean;
  readonly onSave: () => void;
  readonly onTemplateChange: (value: string) => void;
  readonly savedTemplate: string;
  readonly template: string;
}

function MusicPublisherSettingsSection({
  busy,
  onSave,
  onTemplateChange,
  savedTemplate,
  template,
}: MusicPublisherSettingsProps) {
  return (
    <fieldset className="music-publisher-settings">
      <legend>Catalog lookup link</legend>
      <form
        className="music-publisher-settings__form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <label className="field">
          Publisher search URL template
          <input
            aria-describedby="music-publisher-settings-help"
            placeholder="https://publisher.example/search?catalog={catalogId}"
            type="text"
            value={template}
            onChange={(event) => {
              onTemplateChange(event.target.value);
            }}
          />
          <small className="field-help" id="music-publisher-settings-help">
            Leave blank to hide. Use <code>{"{catalogId}"}</code> where the catalog number belongs.
          </small>
        </label>
        <button
          className="button button--secondary"
          disabled={busy || template.trim() === savedTemplate}
          type="submit"
        >
          {busy ? "Saving…" : "Save catalog link"}
        </button>
      </form>
    </fieldset>
  );
}

interface MusicPracticeSettingsProps {
  readonly busy: boolean;
  readonly onLifetimeChange: (value: number) => void;
  readonly onSave: () => void;
  readonly lifetimeDays: number;
  readonly savedLifetimeDays: number;
}

function MusicPracticeSettingsSection({
  busy,
  lifetimeDays,
  onLifetimeChange,
  onSave,
  savedLifetimeDays,
}: MusicPracticeSettingsProps) {
  return (
    <fieldset className="music-practice-settings">
      <legend>Public practice-player links</legend>
      <form
        className="music-practice-settings__form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <label className="field">
          Link lifetime (days)
          <input
            min="1"
            max="3650"
            type="number"
            value={lifetimeDays}
            onChange={(event) => {
              onLifetimeChange(Number(event.target.value));
            }}
          />
        </label>
        <button
          className="button button--secondary"
          disabled={busy || lifetimeDays === savedLifetimeDays}
          type="submit"
        >
          {busy ? "Saving…" : "Save practice settings"}
        </button>
      </form>
    </fieldset>
  );
}

function MusicGenreSettingsSection({
  genreCounts,
  genres,
}: {
  readonly genreCounts: ReadonlyMap<string, number>;
  readonly genres: readonly string[];
}) {
  return (
    <fieldset className="music-library-genre-settings">
      <legend>Genres in your catalog</legend>
      {genres.length > 0 ? (
        <div className="music-library-genre-settings__list" aria-label="Catalog genres">
          {genres.map((genre) => (
            <GenreChip
              count={genreCounts.get(genreKey(genre)) ?? 0}
              genre={genre}
              key={genreKey(genre)}
            />
          ))}
        </div>
      ) : (
        <p className="music-library-genre-settings__empty">
          No genres have been added to catalog pieces yet.
        </p>
      )}
    </fieldset>
  );
}

export function MusicLibrarySettingsPage({
  enabled,
  navigate,
}: {
  readonly enabled: boolean;
  readonly navigate: (href: string) => void;
}) {
  const [settings, setSettings] = useState<OrganizationMusicLibrarySettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<OrganizationMusicLibrarySettings | null>(null);
  const [pieces, setPieces] = useState<readonly OrganizationMusicPiece[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      getOrganizationMusicLibrarySettings(controller.signal),
      listOrganizationMusic(controller.signal),
    ])
      .then(([loaded, catalog]) => {
        setSettings(loaded);
        setSavedSettings(loaded);
        setPieces(catalog);
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

  const genreCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const piece of pieces) {
      for (const genre of uniqueGenreLabels(piece.genres)) {
        const key = genreKey(genre);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [pieces]);
  const genres = useMemo(
    () =>
      uniqueGenreLabels(pieces.flatMap((piece) => piece.genres)).sort((left, right) =>
        left.localeCompare(right),
      ),
    [pieces],
  );

  async function save(section: "catalog" | "practice"): Promise<void> {
    if (!settings || !savedSettings) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const nextSettings = {
      ...savedSettings,
      ...(section === "catalog"
        ? { publisherSearchTemplate: settings.publisherSearchTemplate.trim() }
        : { practicePlayerLinkLifetimeDays: settings.practicePlayerLinkLifetimeDays }),
    };
    try {
      const saved = await updateOrganizationMusicLibrarySettings(nextSettings);
      setSettings((current) =>
        current
          ? {
              ...current,
              ...(section === "catalog"
                ? { publisherSearchTemplate: saved.publisherSearchTemplate }
                : { practicePlayerLinkLifetimeDays: saved.practicePlayerLinkLifetimeDays }),
            }
          : saved,
      );
      setSavedSettings(saved);
      setSuccess(
        section === "catalog"
          ? "Catalog lookup settings updated."
          : "Practice link settings updated.",
      );
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

  const catalogDirty =
    settings !== null &&
    savedSettings !== null &&
    settings.publisherSearchTemplate.trim() !== savedSettings.publisherSearchTemplate;

  const practiceDirty =
    settings !== null &&
    savedSettings !== null &&
    settings.practicePlayerLinkLifetimeDays !== savedSettings.practicePlayerLinkLifetimeDays;

  useFloatingSaveAction({
    busy,
    dirty: catalogDirty,
    id: "organization-music-library-catalog-settings",
    onDiscard: () => {
      if (savedSettings) {
        setSettings((current) =>
          current
            ? { ...current, publisherSearchTemplate: savedSettings.publisherSearchTemplate }
            : null,
        );
        setError(null);
      }
    },
    onSave: () => save("catalog"),
  });

  useFloatingSaveAction({
    busy,
    dirty: practiceDirty,
    id: "organization-music-library-practice-settings",
    onDiscard: () => {
      if (savedSettings) {
        setSettings((current) =>
          current
            ? {
                ...current,
                practicePlayerLinkLifetimeDays: savedSettings.practicePlayerLinkLifetimeDays,
              }
            : null,
        );
        setError(null);
      }
    },
    onSave: () => save("practice"),
  });

  if (!enabled) {
    return (
      <OrganizationMfaPrompt message="Verify Organization MFA to change Music library settings." />
    );
  }

  return (
    <section
      className="account-section music-library-settings-section"
      aria-label="Music library settings"
    >
      <nav className="music-library-tabs" aria-label="Music library sections">
        <AppLink href="/admin/library" onNavigate={navigate}>
          Music Catalog
        </AppLink>
        <AppLink href="/admin/library?view=credits" onNavigate={navigate}>
          Composers &amp; arrangers
        </AppLink>
        <AppLink ariaCurrent="page" href="/admin/library/settings" onNavigate={navigate}>
          Library Settings <span className="sr-only">(current)</span>
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
        <>
          <MusicPublisherSettingsSection
            busy={busy}
            onSave={() => void save("catalog")}
            onTemplateChange={(value) => {
              setSettings((current) =>
                current ? { ...current, publisherSearchTemplate: value } : current,
              );
              setError(null);
              setSuccess(null);
            }}
            savedTemplate={savedSettings.publisherSearchTemplate}
            template={settings.publisherSearchTemplate}
          />
          <MusicPracticeSettingsSection
            busy={busy}
            lifetimeDays={settings.practicePlayerLinkLifetimeDays}
            onLifetimeChange={(value) => {
              setSettings((current) =>
                current ? { ...current, practicePlayerLinkLifetimeDays: value } : current,
              );
              setError(null);
              setSuccess(null);
            }}
            onSave={() => void save("practice")}
            savedLifetimeDays={savedSettings.practicePlayerLinkLifetimeDays}
          />
          <MusicGenreSettingsSection genreCounts={genreCounts} genres={genres} />
        </>
      ) : null}
    </section>
  );
}
