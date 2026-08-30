import { useEffect, useMemo, useState } from "react";
import type { OrganizationMusicLibrarySettings, OrganizationMusicPiece } from "@choir/contracts";
import { useConfirmation } from "@choir/ui";
import {
  AuthApiError,
  deleteOrganizationMusicGenre,
  getOrganizationMusicLibrarySettings,
  listOrganizationMusic,
  renameOrganizationMusicGenre,
  updateOrganizationMusicLibrarySettings,
} from "../auth/api";
import { AppLink } from "./components/AuthenticatedShell/navigation";
import { GenreChip } from "./components/MusicCatalog/shared";
import { genreKey, uniqueGenreLabels } from "./components/MusicCatalog/utils";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";
import { useFloatingSaveAction } from "./useFloatingSaveAction";

interface MusicCatalogSettingsProps {
  readonly busy: boolean;
  readonly defaultPageSize: number;
  readonly onDefaultPageSizeChange: (value: number) => void;
  readonly onSave: () => void;
  readonly onTemplateChange: (value: string) => void;
  readonly savedDefaultPageSize: number;
  readonly savedTemplate: string;
  readonly template: string;
}

function MusicCatalogSettingsSection({
  busy,
  defaultPageSize,
  onDefaultPageSizeChange,
  onSave,
  onTemplateChange,
  savedDefaultPageSize,
  savedTemplate,
  template,
}: MusicCatalogSettingsProps) {
  const dirty = template.trim() !== savedTemplate || defaultPageSize !== savedDefaultPageSize;

  return (
    <fieldset className="music-publisher-settings">
      <legend>Catalog table &amp; lookup settings</legend>
      <form
        className="music-catalog-settings__form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <label className="field">
          Default rows per page
          <select
            aria-label="Default rows per page"
            value={String(defaultPageSize)}
            onChange={(event) => {
              onDefaultPageSizeChange(Number(event.target.value));
            }}
          >
            <option value="25">25 pieces</option>
            <option value="50">50 pieces</option>
            <option value="100">100 pieces (default)</option>
            <option value="250">250 pieces</option>
          </select>
          <small className="field-help">
            The initial page size used when opening the Music Catalog table.
          </small>
        </label>
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
        <button className="button button--secondary" disabled={busy || !dirty} type="submit">
          {busy ? "Saving…" : "Save catalog settings"}
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

interface MusicGenreSettingsProps {
  readonly busyLabel: string | null;
  readonly genreCounts: ReadonlyMap<string, number>;
  readonly genres: readonly string[];
  readonly onAdd: (label: string) => void;
  readonly onDelete: (label: string) => void;
  readonly onRename: (currentLabel: string, newLabel: string) => void;
}

function MusicGenreSettingsSection({
  busyLabel,
  genreCounts,
  genres,
  onAdd,
  onDelete,
  onRename,
}: MusicGenreSettingsProps) {
  const [newLabel, setNewLabel] = useState("");
  const [renamingLabel, setRenamingLabel] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function submitAdd(): void {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setNewLabel("");
  }

  function submitRename(): void {
    if (!renamingLabel) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renamingLabel) {
      setRenamingLabel(null);
      return;
    }
    onRename(renamingLabel, trimmed);
    setRenamingLabel(null);
  }

  return (
    <fieldset className="music-library-genre-settings">
      <legend>Genres in your catalog</legend>
      <form
        className="music-library-genre-settings__add"
        onSubmit={(event) => {
          event.preventDefault();
          submitAdd();
        }}
      >
        <label className="field">
          Add a genre label
          <input
            maxLength={100}
            placeholder="e.g. Folk, Gospel, Pop"
            type="text"
            value={newLabel}
            onChange={(event) => {
              setNewLabel(event.target.value);
            }}
          />
          <small className="field-help">
            Added labels appear as choices when editing catalog pieces.
          </small>
        </label>
        <button
          className="button button--secondary"
          disabled={busyLabel !== null || newLabel.trim() === ""}
          type="submit"
        >
          {busyLabel === "add" ? "Adding…" : "Add genre"}
        </button>
      </form>
      {genres.length > 0 ? (
        <div className="music-library-genre-settings__list" aria-label="Catalog genres">
          {genres.map((genre) =>
            renamingLabel === genre ? (
              <form
                className="music-library-genre-settings__rename"
                key={genreKey(genre)}
                onSubmit={(event) => {
                  event.preventDefault();
                  submitRename();
                }}
              >
                <input
                  aria-label={`Rename ${genre} genre`}
                  autoFocus
                  maxLength={100}
                  type="text"
                  value={renameValue}
                  onChange={(event) => {
                    setRenameValue(event.target.value);
                  }}
                />
                <button
                  className="button button--secondary button--small"
                  disabled={busyLabel !== null || renameValue.trim() === ""}
                  type="submit"
                >
                  Save
                </button>
                <button
                  className="button button--secondary button--small"
                  onClick={() => {
                    setRenamingLabel(null);
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <span className="music-library-genre-settings__row" key={genreKey(genre)}>
                <GenreChip count={genreCounts.get(genreKey(genre)) ?? 0} genre={genre} />
                <button
                  aria-label={`Rename ${genre} genre`}
                  className="text-button"
                  disabled={busyLabel !== null}
                  onClick={() => {
                    setRenamingLabel(genre);
                    setRenameValue(genre);
                  }}
                  type="button"
                >
                  Rename
                </button>
                <button
                  aria-label={`Delete ${genre} genre`}
                  className="text-button text-button--danger"
                  disabled={busyLabel !== null}
                  onClick={() => {
                    onDelete(genre);
                  }}
                  type="button"
                >
                  Delete
                </button>
              </span>
            ),
          )}
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
  const [genreBusy, setGenreBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { confirm: requestConfirmation, confirmationDialog } = useConfirmation();

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
  const genres = useMemo(() => {
    const labels = new Map<string, string>();
    for (const label of [
      ...(settings?.genres ?? []),
      ...uniqueGenreLabels(pieces.flatMap((piece) => piece.genres)),
    ]) {
      const key = genreKey(label);
      if (!labels.has(key)) labels.set(key, label);
    }
    return [...labels.values()].sort((left, right) => left.localeCompare(right));
  }, [pieces, settings]);

  async function save(section: "catalog" | "practice"): Promise<void> {
    if (!settings || !savedSettings) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const nextSettings = {
      ...savedSettings,
      ...(section === "catalog"
        ? {
            defaultPageSize: settings.defaultPageSize,
            publisherSearchTemplate: settings.publisherSearchTemplate.trim(),
          }
        : { practicePlayerLinkLifetimeDays: settings.practicePlayerLinkLifetimeDays }),
    };
    try {
      const saved = await updateOrganizationMusicLibrarySettings(nextSettings);
      setSettings((current) =>
        current
          ? {
              ...current,
              ...(section === "catalog"
                ? {
                    defaultPageSize: saved.defaultPageSize,
                    publisherSearchTemplate: saved.publisherSearchTemplate,
                  }
                : { practicePlayerLinkLifetimeDays: saved.practicePlayerLinkLifetimeDays }),
            }
          : saved,
      );
      setSavedSettings(saved);
      setSuccess(
        section === "catalog" ? "Catalog settings updated." : "Practice link settings updated.",
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

  async function addGenre(label: string): Promise<void> {
    if (!settings || !savedSettings) return;
    if (genres.some((candidate) => genreKey(candidate) === genreKey(label))) {
      setError("That genre label already exists.");
      return;
    }
    setGenreBusy("add");
    setError(null);
    setSuccess(null);
    try {
      const saved = await updateOrganizationMusicLibrarySettings({
        ...savedSettings,
        genres: [...savedSettings.genres, label].sort((left, right) => left.localeCompare(right)),
      });
      setSettings(saved);
      setSavedSettings(saved);
      setSuccess("Genre added.");
    } catch (caught: unknown) {
      setError(caught instanceof AuthApiError ? caught.message : "The genre could not be added.");
    } finally {
      setGenreBusy(null);
    }
  }

  async function renameGenre(currentLabel: string, newLabel: string): Promise<void> {
    if (
      genres.some(
        (candidate) => candidate !== currentLabel && genreKey(candidate) === genreKey(newLabel),
      )
    ) {
      setError("That genre label already exists.");
      return;
    }
    setGenreBusy(currentLabel);
    setError(null);
    setSuccess(null);
    try {
      const saved = await renameOrganizationMusicGenre({ currentLabel, newLabel });
      setPieces(saved.pieces);
      setSettings(saved.settings);
      setSavedSettings(saved.settings);
      setSuccess("Genre renamed.");
    } catch (caught: unknown) {
      setError(caught instanceof AuthApiError ? caught.message : "The genre could not be renamed.");
    } finally {
      setGenreBusy(null);
    }
  }

  async function removeGenre(label: string): Promise<void> {
    const count = genreCounts.get(genreKey(label)) ?? 0;
    const confirmed = await requestConfirmation({
      confirmLabel: "Remove genre",
      destructive: true,
      description:
        count > 0
          ? `This removes ${label} from ${String(count)} catalog piece${count === 1 ? "" : "s"}.`
          : `This removes the ${label} genre label from your catalog.`,
      title: `Remove ${label}?`,
    });
    if (!confirmed) return;
    setGenreBusy(label);
    setError(null);
    setSuccess(null);
    try {
      const saved = await deleteOrganizationMusicGenre({ label });
      setPieces(saved.pieces);
      setSettings(saved.settings);
      setSavedSettings(saved.settings);
      setSuccess("Genre removed.");
    } catch (caught: unknown) {
      setError(caught instanceof AuthApiError ? caught.message : "The genre could not be removed.");
    } finally {
      setGenreBusy(null);
    }
  }

  const catalogDirty =
    settings !== null &&
    savedSettings !== null &&
    (settings.publisherSearchTemplate.trim() !== savedSettings.publisherSearchTemplate ||
      settings.defaultPageSize !== savedSettings.defaultPageSize);

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
            ? {
                ...current,
                defaultPageSize: savedSettings.defaultPageSize,
                publisherSearchTemplate: savedSettings.publisherSearchTemplate,
              }
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
      {confirmationDialog}
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
          <MusicGenreSettingsSection
            busyLabel={genreBusy}
            genreCounts={genreCounts}
            genres={genres}
            onAdd={(label) => {
              void addGenre(label);
            }}
            onDelete={(label) => {
              void removeGenre(label);
            }}
            onRename={(currentLabel, newLabel) => {
              void renameGenre(currentLabel, newLabel);
            }}
          />
          <MusicCatalogSettingsSection
            busy={busy}
            defaultPageSize={settings.defaultPageSize}
            onDefaultPageSizeChange={(value) => {
              setSettings((current) =>
                current ? { ...current, defaultPageSize: value } : current,
              );
              setError(null);
              setSuccess(null);
            }}
            onSave={() => void save("catalog")}
            onTemplateChange={(value) => {
              setSettings((current) =>
                current ? { ...current, publisherSearchTemplate: value } : current,
              );
              setError(null);
              setSuccess(null);
            }}
            savedDefaultPageSize={savedSettings.defaultPageSize}
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
        </>
      ) : null}
    </section>
  );
}
