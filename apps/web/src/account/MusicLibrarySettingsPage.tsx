import { useCallback, useEffect, useMemo, useState } from "react";
import type { OrganizationMusicLibrarySettings, OrganizationMusicPiece } from "@choir/contracts";
import { NumberInput, DataTable, type DataTableColumn, useConfirmation } from "@choir/ui";
import {
  AuthApiError,
  batchAddOrganizationMusicGenres,
  deleteOrganizationMusicGenre,
  getOrganizationMusicLibrarySettings,
  listOrganizationMusic,
  renameOrganizationMusicGenre,
  updateOrganizationMusicLibrarySettings,
} from "../auth/api";
import { usePersistedDraft } from "../persistence";
import { AppLink } from "./components/AuthenticatedShell/navigation";
import { genreKey, uniqueGenreLabels } from "./components/MusicCatalog/utils";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";

interface MusicCatalogSettingsProps {
  readonly busy?: boolean | undefined;
  readonly defaultPageSize: number;
  readonly onDefaultPageSizeChange: (value: number) => void;
  readonly onSave?: (() => void) | undefined;
  readonly onTemplateChange: (value: string) => void;
  readonly savedDefaultPageSize?: number | undefined;
  readonly savedTemplate?: string | undefined;
  readonly template: string;
}

function MusicCatalogSettingsSection({
  busy = false,
  defaultPageSize,
  onDefaultPageSizeChange,
  onSave,
  onTemplateChange,
  savedDefaultPageSize,
  savedTemplate,
  template,
}: MusicCatalogSettingsProps) {
  const dirty =
    (savedDefaultPageSize !== undefined && defaultPageSize !== savedDefaultPageSize) ||
    (savedTemplate !== undefined && template.trim() !== savedTemplate.trim());
  return (
    <fieldset className="music-publisher-settings">
      <legend>Catalog table &amp; lookup settings</legend>
      <div className="music-catalog-settings__form form-stack">
        <div className="field">
          <label htmlFor="music-catalog-default-page-size">Default rows per page</label>
          <select
            aria-describedby="music-catalog-default-page-size-help"
            id="music-catalog-default-page-size"
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
          <span className="field-help" id="music-catalog-default-page-size-help">
            The initial page size used when opening the Music Catalog table.
          </span>
        </div>
        <div className="field">
          <label htmlFor="music-publisher-template">Publisher search URL template</label>
          <input
            aria-describedby="music-publisher-settings-help"
            id="music-publisher-template"
            placeholder="https://publisher.example/search?catalog={catalogId}"
            type="text"
            value={template}
            onChange={(event) => {
              onTemplateChange(event.target.value);
            }}
          />
          <span className="field-help" id="music-publisher-settings-help">
            Leave blank to hide. Use <code>{"{catalogId}"}</code> where the catalog number belongs.
          </span>
        </div>
        <button
          className="button button--secondary"
          disabled={busy || !dirty}
          onClick={onSave}
          type="button"
        >
          Save catalog settings
        </button>
      </div>
    </fieldset>
  );
}

interface MusicPracticeSettingsProps {
  readonly busy?: boolean | undefined;
  readonly lifetimeDays: number;
  readonly onLifetimeChange: (value: number) => void;
  readonly onSave?: (() => void) | undefined;
  readonly savedLifetimeDays?: number | undefined;
}

function MusicPracticeSettingsSection({
  busy = false,
  lifetimeDays,
  onLifetimeChange,
  onSave,
  savedLifetimeDays,
}: MusicPracticeSettingsProps) {
  const dirty = savedLifetimeDays !== undefined && lifetimeDays !== savedLifetimeDays;
  return (
    <fieldset className="music-practice-settings">
      <legend>Public practice-player links</legend>
      <div className="music-practice-settings__form form-stack">
        <div className="field">
          <label htmlFor="music-practice-lifetime-days">Link lifetime (days)</label>
          <NumberInput
            id="music-practice-lifetime-days"
            min="1"
            max="3650"
            value={lifetimeDays}
            onChange={(event) => {
              onLifetimeChange(Number(event.target.value));
            }}
          />
        </div>
        <button
          className="button button--secondary"
          disabled={busy || !dirty}
          onClick={onSave}
          type="button"
        >
          Save practice settings
        </button>
      </div>
    </fieldset>
  );
}

interface GenreTableRow {
  readonly id: string;
  readonly isPending: boolean;
  readonly name: string;
  readonly pieceCount: number | null;
}

interface MusicGenreSettingsProps {
  readonly busyLabel: string | null;
  readonly genreCounts: ReadonlyMap<string, number>;
  readonly genres: readonly string[];
  readonly onAddPending: (labels: readonly string[]) => void;
  readonly onClearPending: () => void;
  readonly onDelete: (label: string) => void;
  readonly onRemovePending: (label: string) => void;
  readonly onRename: (currentLabel: string, newLabel: string) => void;
  readonly onSavePending: () => void;
  readonly pendingGenres: readonly string[];
}

function MusicGenreSettingsSection({
  busyLabel,
  genreCounts,
  genres,
  onAddPending,
  onClearPending,
  onDelete,
  onRemovePending,
  onRename,
  onSavePending,
  pendingGenres,
}: MusicGenreSettingsProps) {
  const [newLabel, setNewLabel] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [renamingLabel, setRenamingLabel] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function submitAdd(): void {
    const raw = newLabel.trim();
    if (!raw) return;
    const candidates = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (candidates.length === 0) return;

    for (const candidate of candidates) {
      if (candidate.length > 100) {
        setLocalError(`Genre label "${candidate}" exceeds 100 characters.`);
        return;
      }
    }

    const seenInInput = new Set<string>();
    const toAdd: string[] = [];
    for (const candidate of candidates) {
      const key = genreKey(candidate);
      if (seenInInput.has(key)) {
        setLocalError(`Genre label "${candidate}" is duplicated in your input.`);
        return;
      }
      seenInInput.add(key);
      if (genres.some((existing) => genreKey(existing) === key)) {
        setLocalError(`Genre label "${candidate}" already exists.`);
        return;
      }
      if (pendingGenres.some((pending) => genreKey(pending) === key)) {
        setLocalError(`Genre label "${candidate}" is already staged to be added.`);
        return;
      }
      toAdd.push(candidate);
    }

    if (genres.length + pendingGenres.length + toAdd.length > 100) {
      setLocalError("A maximum of 100 genres is allowed in your catalog.");
      return;
    }

    setLocalError(null);
    onAddPending(toAdd);
    setNewLabel("");
  }

  const submitRename = useCallback((): void => {
    if (!renamingLabel) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renamingLabel) {
      setRenamingLabel(null);
      return;
    }
    onRename(renamingLabel, trimmed);
    setRenamingLabel(null);
  }, [onRename, renamingLabel, renameValue]);

  const rows: readonly GenreTableRow[] = useMemo(() => {
    const list: GenreTableRow[] = [];
    for (const genre of genres) {
      list.push({
        id: `saved:${genreKey(genre)}`,
        isPending: false,
        name: genre,
        pieceCount: genreCounts.get(genreKey(genre)) ?? 0,
      });
    }
    for (const pending of pendingGenres) {
      list.push({
        id: `pending:${genreKey(pending)}`,
        isPending: true,
        name: pending,
        pieceCount: null,
      });
    }
    return list;
  }, [genreCounts, genres, pendingGenres]);

  const columns: readonly DataTableColumn<GenreTableRow>[] = useMemo(
    () => [
      {
        header: "Genre",
        id: "name",
        mobileLabel: "Genre",
        render: (row) =>
          renamingLabel === row.name ? (
            <form
              className="music-library-genre-settings__rename"
              onSubmit={(event) => {
                event.preventDefault();
                submitRename();
              }}
            >
              <input
                aria-label={`Rename ${row.name} genre`}
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
            <div className="music-library-genre-table__name-cell">
              <span>{row.name}</span>
              {row.isPending ? (
                <span className="status-pill status-pill--neutral">Pending</span>
              ) : null}
            </div>
          ),
        sortValue: (row) => row.name.toLowerCase(),
      },
      {
        align: "right",
        header: "Pieces",
        id: "pieceCount",
        mobileLabel: "Pieces",
        render: (row) => <span className="tabular-nums">{row.pieceCount ?? "—"}</span>,
        sortValue: (row) => row.pieceCount ?? -1,
      },
      {
        align: "right",
        header: "Actions",
        id: "actions",
        mobileLabel: "Actions",
        render: (row) => (
          <div className="table-actions">
            {row.isPending ? (
              <button
                aria-label={`Remove pending genre ${row.name}`}
                className="text-button text-button--danger"
                disabled={busyLabel !== null}
                onClick={() => {
                  onRemovePending(row.name);
                }}
                type="button"
              >
                Remove
              </button>
            ) : renamingLabel === row.name ? null : (
              <>
                <button
                  aria-label={`Rename ${row.name} genre`}
                  className="text-button"
                  disabled={busyLabel !== null}
                  onClick={() => {
                    setRenamingLabel(row.name);
                    setRenameValue(row.name);
                  }}
                  type="button"
                >
                  Rename
                </button>
                <button
                  aria-label={`Delete ${row.name} genre`}
                  className="text-button text-button--danger"
                  disabled={busyLabel !== null}
                  onClick={() => {
                    onDelete(row.name);
                  }}
                  type="button"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        ),
      },
    ],
    [busyLabel, onDelete, onRemovePending, renamingLabel, renameValue, submitRename],
  );

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
        <div className="field">
          <label htmlFor="music-genre-new-label">Add genre labels</label>
          <input
            aria-describedby="music-genre-new-label-help"
            id="music-genre-new-label"
            maxLength={100}
            placeholder="e.g. Folk, Gospel, Pop"
            type="text"
            value={newLabel}
            onChange={(event) => {
              setNewLabel(event.target.value);
              if (localError) setLocalError(null);
            }}
          />
          <span className="field-help" id="music-genre-new-label-help">
            Type one or more genre labels (comma-separated) and click &ldquo;Add to list&rdquo; to
            stage them.
          </span>
        </div>
        <button
          className="button button--secondary"
          disabled={busyLabel !== null || newLabel.trim() === ""}
          type="submit"
        >
          Add to list
        </button>
      </form>
      {localError ? (
        <p className="notice notice--error" role="alert">
          {localError}
        </p>
      ) : null}
      {pendingGenres.length > 0 ? (
        <div
          aria-label="Staged genres"
          className="music-library-genre-settings__staged-banner"
          role="region"
        >
          <p className="music-library-genre-settings__staged-count">
            <strong>{String(pendingGenres.length)}</strong> new genre
            {pendingGenres.length === 1 ? "" : "s"} staged to be saved.
          </p>
          <div className="music-library-genre-settings__staged-actions">
            <button
              className="button button--primary button--small"
              disabled={busyLabel !== null}
              onClick={onSavePending}
              type="button"
            >
              {busyLabel === "batch-add"
                ? "Saving…"
                : `Save ${String(pendingGenres.length)} new genre${pendingGenres.length === 1 ? "" : "s"}`}
            </button>
            <button
              className="button button--secondary button--small"
              disabled={busyLabel !== null}
              onClick={onClearPending}
              type="button"
            >
              Clear staged
            </button>
          </div>
        </div>
      ) : null}
      <DataTable
        columns={columns}
        emptyMessage="No genres have been added to catalog pieces yet."
        initialSort={{ columnId: "name", direction: "asc" }}
        keySelector={(row) => row.id}
        rows={rows}
      />
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
  const [initialSettings, setInitialSettings] = useState<OrganizationMusicLibrarySettings | null>(
    null,
  );
  const [pieces, setPieces] = useState<readonly OrganizationMusicPiece[]>([]);
  const [loading, setLoading] = useState(true);
  const [genreBusy, setGenreBusy] = useState<string | null>(null);
  const [pendingGenres, setPendingGenres] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { confirm: requestConfirmation, confirmationDialog } = useConfirmation();

  const {
    draft: settings,
    error: draftError,
    persisted: savedSettings,
    save,
    saving,
    updateField,
  } = usePersistedDraft<OrganizationMusicLibrarySettings>({
    initialValue: initialSettings,
    normalize: (item) => ({
      ...item,
      publisherSearchTemplate: item.publisherSearchTemplate.trim(),
    }),
    onSaveSuccess: () => {
      setSuccess("Music library settings saved.");
    },
    resourceKey: "organization-music-library-settings",
    save: updateOrganizationMusicLibrarySettings,
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      getOrganizationMusicLibrarySettings(controller.signal),
      listOrganizationMusic(controller.signal),
    ])
      .then(([loaded, catalog]) => {
        setInitialSettings(loaded);
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

  async function savePendingGenres(): Promise<void> {
    if (pendingGenres.length === 0 || !settings) return;
    setGenreBusy("batch-add");
    setError(null);
    setSuccess(null);
    try {
      const saved = await batchAddOrganizationMusicGenres({ labels: pendingGenres });
      if (saved.pieces.length > 0) {
        setPieces(saved.pieces);
      }
      updateField("genres", saved.settings.genres);
      setInitialSettings(saved.settings);
      setSuccess(
        `${String(pendingGenres.length)} new genre${pendingGenres.length === 1 ? "" : "s"} added.`,
      );
      setPendingGenres([]);
    } catch (caught: unknown) {
      setError(caught instanceof AuthApiError ? caught.message : "The genres could not be added.");
    } finally {
      setGenreBusy(null);
    }
  }

  async function renameGenre(currentLabel: string, newLabel: string): Promise<void> {
    if (
      genres.some(
        (candidate) => candidate !== currentLabel && genreKey(candidate) === genreKey(newLabel),
      ) ||
      pendingGenres.some((candidate) => genreKey(candidate) === genreKey(newLabel))
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
      updateField("genres", saved.settings.genres);
      setInitialSettings(saved.settings);
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
      description:
        count > 0
          ? `This removes ${label} from ${String(count)} catalog piece${count === 1 ? "" : "s"}.`
          : `This removes the ${label} genre label from your catalog.`,
      destructive: true,
      title: `Remove ${label}?`,
    });
    if (!confirmed) return;
    setGenreBusy(label);
    setError(null);
    setSuccess(null);
    try {
      const saved = await deleteOrganizationMusicGenre({ label });
      setPieces(saved.pieces);
      updateField("genres", saved.settings.genres);
      setInitialSettings(saved.settings);
      setSuccess("Genre removed.");
    } catch (caught: unknown) {
      setError(caught instanceof AuthApiError ? caught.message : "The genre could not be removed.");
    } finally {
      setGenreBusy(null);
    }
  }

  const effectiveError = error ?? draftError;

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
      {effectiveError ? (
        <p className="notice notice--error" role="alert">
          {effectiveError}
        </p>
      ) : null}
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      {settings ? (
        <>
          <MusicGenreSettingsSection
            busyLabel={genreBusy}
            genreCounts={genreCounts}
            genres={genres}
            onAddPending={(labels) => {
              setPendingGenres((current) => [...current, ...labels]);
              setError(null);
              setSuccess(null);
            }}
            onClearPending={() => {
              setPendingGenres([]);
            }}
            onDelete={(label) => {
              void removeGenre(label);
            }}
            onRemovePending={(label) => {
              setPendingGenres((current) =>
                current.filter((item) => genreKey(item) !== genreKey(label)),
              );
            }}
            onRename={(currentLabel, newLabel) => {
              void renameGenre(currentLabel, newLabel);
            }}
            onSavePending={() => {
              void savePendingGenres();
            }}
            pendingGenres={pendingGenres}
          />
          <MusicCatalogSettingsSection
            busy={saving}
            defaultPageSize={settings.defaultPageSize}
            onDefaultPageSizeChange={(value) => {
              updateField("defaultPageSize", value);
              setError(null);
              setSuccess(null);
            }}
            onSave={() => {
              void save();
            }}
            onTemplateChange={(value) => {
              updateField("publisherSearchTemplate", value);
              setError(null);
              setSuccess(null);
            }}
            savedDefaultPageSize={savedSettings?.defaultPageSize}
            savedTemplate={savedSettings?.publisherSearchTemplate}
            template={settings.publisherSearchTemplate}
          />
          <MusicPracticeSettingsSection
            busy={saving}
            lifetimeDays={settings.practicePlayerLinkLifetimeDays}
            onLifetimeChange={(value) => {
              updateField("practicePlayerLinkLifetimeDays", value);
              setError(null);
              setSuccess(null);
            }}
            onSave={() => {
              void save();
            }}
            savedLifetimeDays={savedSettings?.practicePlayerLinkLifetimeDays}
          />
        </>
      ) : null}
    </section>
  );
}
