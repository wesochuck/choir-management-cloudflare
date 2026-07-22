import type {
  OrganizationMusicPiece,
  OrganizationMusicPieceRequest,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";

import {
  AuthApiError,
  createOrganizationMusicPiece,
  deleteOrganizationMusicPiece,
  getOrganizationRosterConfiguration,
  importOrganizationMusicCsv,
  listOrganizationMusic,
  updateOrganizationMusicPiece,
} from "../auth/api";

const emptyPiece: OrganizationMusicPieceRequest = {
  arranger: "",
  catalogId: "",
  composer: "",
  copies: null,
  durationSeconds: null,
  genres: [],
  notes: "",
  parentId: null,
  purchaseDate: null,
  sectionBuckets: [],
  title: "",
  trackFileIds: {},
};

function requestFrom(piece: OrganizationMusicPiece): OrganizationMusicPieceRequest {
  return {
    arranger: piece.arranger,
    catalogId: piece.catalogId,
    composer: piece.composer,
    copies: piece.copies,
    durationSeconds: piece.durationSeconds,
    genres: piece.genres,
    notes: piece.notes,
    parentId: piece.parentId,
    purchaseDate: piece.purchaseDate,
    sectionBuckets: piece.sectionBuckets,
    title: piece.title,
    trackFileIds: piece.trackFileIds,
  };
}

function durationText(seconds: number | null): string {
  if (seconds === null) return "";
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

function parseDuration(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{1,4}):([0-5]\d)$/.exec(trimmed);
  if (!match) return undefined;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const total = minutes * 60 + seconds;
  return total <= 86_400 ? total : undefined;
}

function uniqueLabels(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ];
}

function CatalogList({
  editingId,
  onEdit,
  pieces,
  search,
}: {
  readonly editingId: string | null;
  readonly onEdit: (piece: OrganizationMusicPiece) => void;
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly search: string;
}) {
  const parents = new Map(pieces.map((piece) => [piece.id, piece]));
  const needle = search.trim().toLocaleLowerCase();
  const visible = pieces.filter((piece) =>
    [piece.title, piece.composer, piece.arranger, piece.catalogId, ...piece.genres]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle),
  );
  if (visible.length === 0) {
    return <p className="empty-state">No music pieces match this catalog search.</p>;
  }
  return (
    <ul className="music-catalog-list">
      {visible.map((piece) => (
        <li className={editingId === piece.id ? "is-selected" : ""} key={piece.id}>
          <button
            aria-label={`Edit music piece: ${piece.title}`}
            type="button"
            onClick={() => {
              onEdit(piece);
            }}
          >
            <span>
              <strong>{piece.parentId ? `↳ ${piece.title}` : piece.title}</strong>
              {piece.parentId ? (
                <small>Movement of {parents.get(piece.parentId)?.title}</small>
              ) : null}
              <small>
                {[piece.composer, piece.arranger, piece.catalogId].filter(Boolean).join(" · ") ||
                  "No catalog metadata"}
              </small>
            </span>
            <span className="status-pill">{durationText(piece.durationSeconds) || "—"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SectionBuckets({
  configuration,
  onChange,
  selected,
}: {
  readonly configuration: OrganizationRosterConfiguration;
  readonly onChange: (sections: string[]) => void;
  readonly selected: readonly string[];
}) {
  const available = configuration.sections.filter(({ trackOnly }) => !trackOnly);
  return (
    <fieldset className="music-section-buckets">
      <legend>Sections using this music</legend>
      {available.map((section) => (
        <label className="checkbox-row" key={section.code}>
          <input
            checked={selected.includes(section.code)}
            type="checkbox"
            onChange={(event) => {
              onChange(
                event.target.checked
                  ? [...selected, section.code]
                  : selected.filter((code) => code !== section.code),
              );
            }}
          />
          {section.name} ({section.code})
        </label>
      ))}
    </fieldset>
  );
}

function MusicDeleteControls({
  busy,
  childCount,
  deleteConfirm,
  editingId,
  onAddMovement,
  onCancel,
  onConfirm,
  onRequest,
  onUnlinkChildren,
  unlinkChildren,
}: {
  readonly busy: boolean;
  readonly childCount: number;
  readonly deleteConfirm: boolean;
  readonly editingId: string | null;
  readonly onAddMovement: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly onRequest: () => void;
  readonly onUnlinkChildren: (enabled: boolean) => void;
  readonly unlinkChildren: boolean;
}) {
  return (
    <>
      <div className="form-actions">
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Saving music…" : "Save music piece"}
        </button>
        {editingId ? (
          <button className="button button--secondary" type="button" onClick={onAddMovement}>
            Add movement
          </button>
        ) : null}
        {editingId && !deleteConfirm ? (
          <button className="button button--danger" type="button" onClick={onRequest}>
            Delete music piece
          </button>
        ) : null}
      </div>
      {deleteConfirm ? (
        <div className="danger-confirmation" role="group" aria-label="Confirm music deletion">
          <p>This cannot be undone. Referenced set-list pieces cannot be deleted.</p>
          {childCount > 0 ? (
            <label className="checkbox-row">
              <input
                checked={unlinkChildren}
                type="checkbox"
                onChange={(event) => {
                  onUnlinkChildren(event.target.checked);
                }}
              />
              Keep {String(childCount)} movement(s) as top-level works
            </label>
          ) : null}
          <div className="form-actions">
            <button
              className="button button--danger"
              disabled={busy || (childCount > 0 && !unlinkChildren)}
              type="button"
              onClick={onConfirm}
            >
              Confirm delete
            </button>
            <button
              className="button button--secondary"
              disabled={busy}
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function MusicCatalog({ enabled }: { readonly enabled: boolean }) {
  const [pieces, setPieces] = useState<readonly OrganizationMusicPiece[]>([]);
  const [roster, setRoster] = useState<OrganizationRosterConfiguration | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [piece, setPiece] = useState<OrganizationMusicPieceRequest>(emptyPiece);
  const [durationInput, setDurationInput] = useState("");
  const [genresInput, setGenresInput] = useState("");
  const [copiesInput, setCopiesInput] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [unlinkChildren, setUnlinkChildren] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationMusic(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
    ])
      .then(([catalog, configuration]) => {
        setPieces(catalog);
        setRoster(configuration);
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError("The music catalog could not be loaded.");
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  const topLevelPieces = useMemo(
    () => pieces.filter(({ id, parentId }) => !parentId && id !== editingId),
    [editingId, pieces],
  );
  const childCount = editingId ? pieces.filter(({ parentId }) => parentId === editingId).length : 0;

  function selectPiece(selected: OrganizationMusicPiece): void {
    setEditingId(selected.id);
    setPiece(requestFrom(selected));
    setDurationInput(durationText(selected.durationSeconds));
    setGenresInput(selected.genres.join(", "));
    setCopiesInput(selected.copies === null ? "" : String(selected.copies));
    setDeleteConfirm(false);
    setUnlinkChildren(false);
    setMessage(null);
    setError(null);
  }

  function beginNew(parentId: string | null = null): void {
    setEditingId(null);
    setPiece({ ...emptyPiece, parentId });
    setDurationInput("");
    setGenresInput("");
    setCopiesInput("");
    setDeleteConfirm(false);
    setMessage(null);
    setError(null);
  }

  async function save(): Promise<void> {
    const durationSeconds = parseDuration(durationInput);
    const copies = copiesInput.trim() ? Number(copiesInput) : null;
    if (durationSeconds === undefined) {
      setError("Duration must use minutes:seconds, such as 4:05.");
      return;
    }
    if (copies !== null && (!Number.isInteger(copies) || copies < 0 || copies > 1_000_000)) {
      setError("Copies must be a whole number from 0 through 1,000,000.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const request = {
        ...piece,
        copies,
        durationSeconds,
        genres: uniqueLabels(genresInput),
      };
      const saved = editingId
        ? await updateOrganizationMusicPiece(editingId, request)
        : await createOrganizationMusicPiece(request);
      setPieces((current) =>
        editingId
          ? current.map((candidate) => (candidate.id === saved.id ? saved : candidate))
          : [...current, saved].sort((a, b) => a.title.localeCompare(b.title)),
      );
      selectPiece(saved);
      setMessage("Music piece saved.");
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError ? caught.message : "The music piece could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganizationMusicPiece(editingId, unlinkChildren);
      setPieces((current) =>
        current
          .filter(({ id }) => id !== editingId)
          .map((candidate) =>
            candidate.parentId === editingId ? { ...candidate, parentId: null } : candidate,
          ),
      );
      beginNew();
      setMessage("Music piece deleted.");
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The music piece could not be deleted. It may still be referenced.",
      );
      setDeleteConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(): Promise<void> {
    if (!importFile) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const imported = await importOrganizationMusicCsv(await importFile.text());
      setPieces(await listOrganizationMusic());
      setImportFile(null);
      setMessage(`${String(imported)} music piece(s) imported.`);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError ? caught.message : "The music CSV could not be imported.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;

  return (
    <section className="account-section" aria-labelledby="music-catalog-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Repertoire</p>
        <h2 id="music-catalog-title">Music catalog</h2>
        <p className="section-description">
          Manage owned works and movements. Audio tracks remain private Organization files and will
          appear here when linked through the track workflow.
        </p>
      </div>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="notice notice--success" role="status">
          {message}
        </p>
      ) : null}
      {!roster ? (
        <p>Loading music catalog…</p>
      ) : (
        <div className="music-catalog-layout">
          <div>
            <div className="music-catalog-toolbar">
              <label className="field">
                Search catalog
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                />
              </label>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  beginNew();
                }}
              >
                Add music piece
              </button>
              <a
                className="button button--secondary"
                download
                href="/api/organization/music/export"
              >
                Export CSV
              </a>
            </div>
            <div className="form-stack music-csv-import">
              <label className="field">
                Import music CSV
                <input
                  accept=".csv,text/csv"
                  type="file"
                  onChange={(event) => {
                    setImportFile(event.target.files?.item(0) ?? null);
                  }}
                />
              </label>
              <button
                className="button button--secondary"
                disabled={busy || !importFile}
                type="button"
                onClick={() => void importCsv()}
              >
                {busy ? "Importing…" : "Import CSV"}
              </button>
              <p className="field-help">
                Imports up to 500 top-level works atomically. Existing catalog entries are retained.
              </p>
            </div>
            <CatalogList
              editingId={editingId}
              onEdit={selectPiece}
              pieces={pieces}
              search={search}
            />
          </div>
          <form
            className="form-stack music-piece-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <h3>
              {editingId ? "Edit music piece" : piece.parentId ? "Add movement" : "Add music piece"}
            </h3>
            <div className="music-fields-grid">
              <label className="field music-field--wide">
                Title
                <input
                  maxLength={500}
                  required
                  value={piece.title}
                  onChange={(event) => {
                    setPiece((current) => ({ ...current, title: event.target.value }));
                  }}
                />
              </label>
              <label className="field">
                Composer
                <input
                  maxLength={300}
                  value={piece.composer}
                  onChange={(event) => {
                    setPiece((current) => ({ ...current, composer: event.target.value }));
                  }}
                />
              </label>
              <label className="field">
                Arranger
                <input
                  maxLength={300}
                  value={piece.arranger}
                  onChange={(event) => {
                    setPiece((current) => ({ ...current, arranger: event.target.value }));
                  }}
                />
              </label>
              <label className="field">
                Catalog ID
                <input
                  maxLength={200}
                  value={piece.catalogId}
                  onChange={(event) => {
                    setPiece((current) => ({ ...current, catalogId: event.target.value }));
                  }}
                />
              </label>
              <label className="field">
                Purchase date
                <input
                  type="date"
                  value={piece.purchaseDate ?? ""}
                  onChange={(event) => {
                    setPiece((current) => ({
                      ...current,
                      purchaseDate: event.target.value || null,
                    }));
                  }}
                />
              </label>
              <label className="field">
                Copies
                <input
                  inputMode="numeric"
                  min="0"
                  step="1"
                  type="number"
                  value={copiesInput}
                  onChange={(event) => {
                    setCopiesInput(event.target.value);
                  }}
                />
              </label>
              <label className="field">
                Duration (minutes:seconds)
                <input
                  placeholder="4:05"
                  value={durationInput}
                  onChange={(event) => {
                    setDurationInput(event.target.value);
                  }}
                />
              </label>
              <label className="field music-field--wide">
                Genres (comma separated)
                <input
                  value={genresInput}
                  onChange={(event) => {
                    setGenresInput(event.target.value);
                  }}
                />
              </label>
              <label className="field music-field--wide">
                Parent work
                <select
                  value={piece.parentId ?? ""}
                  onChange={(event) => {
                    setPiece((current) => ({ ...current, parentId: event.target.value || null }));
                  }}
                >
                  <option value="">Top-level work</option>
                  {topLevelPieces.map((parent) => (
                    <option key={parent.id} value={parent.id}>
                      {parent.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field music-field--wide">
                Notes
                <textarea
                  maxLength={100_000}
                  rows={4}
                  value={piece.notes}
                  onChange={(event) => {
                    setPiece((current) => ({ ...current, notes: event.target.value }));
                  }}
                />
              </label>
            </div>
            <SectionBuckets
              configuration={roster}
              selected={piece.sectionBuckets}
              onChange={(sectionBuckets) => {
                setPiece((current) => ({ ...current, sectionBuckets }));
              }}
            />
            {editingId ? (
              <p className="field-help">
                Private tracks linked: {String(Object.keys(piece.trackFileIds).length)} · Movements:{" "}
                {String(childCount)}
              </p>
            ) : null}
            <MusicDeleteControls
              busy={busy}
              childCount={childCount}
              deleteConfirm={deleteConfirm}
              editingId={editingId}
              unlinkChildren={unlinkChildren}
              onAddMovement={() => {
                beginNew(editingId);
              }}
              onCancel={() => {
                setDeleteConfirm(false);
              }}
              onConfirm={() => void remove()}
              onRequest={() => {
                setDeleteConfirm(true);
              }}
              onUnlinkChildren={(selected) => {
                setUnlinkChildren(selected);
              }}
            />
          </form>
        </div>
      )}
    </section>
  );
}
