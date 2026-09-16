import type {
  OrganizationMusicBulkUpdateRequest,
  OrganizationMusicPiece,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  AuthApiError,
  deletePrivateOrganizationFile,
  uploadPrivateOrganizationFile,
  updateOrganizationMusicPiece,
} from "../../../auth/api";
import { extractAudioDuration } from "../../audioDuration";
import { learningTrackFileName } from "../../learningTrackFilename";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";

import { requestFrom, uniqueLabels } from "./utils";

import { trackKeys, trackDescription, validateAudioFile } from "./tableUtils";

import { MusicInlineAudioPlayer } from "./performances";

export function MusicAudioTracks({
  configuration,
  onSaved,
  onTrackDurationDetected,
  piece,
}: {
  readonly configuration: OrganizationRosterConfiguration;
  readonly onSaved: (piece: OrganizationMusicPiece, message: string) => void;
  readonly onTrackDurationDetected: (trackKey: string, durationSeconds: number | null) => void;
  readonly piece: OrganizationMusicPiece;
}) {
  const { partLabel } = useOrganizationTerminology();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [addedVoicePartLabels, setAddedVoicePartLabels] = useState<readonly string[]>([]);

  async function saveMapping(
    key: string,
    fileId: string | null,
    detectedDurationSeconds?: number | null,
  ): Promise<void> {
    const previousFileId = piece.trackFileIds[key];
    const mapping = fileId
      ? { ...piece.trackFileIds, [key]: fileId }
      : Object.fromEntries(Object.entries(piece.trackFileIds).filter(([label]) => label !== key));
    const nextDurationSeconds =
      piece.durationSeconds ??
      (detectedDurationSeconds &&
      Number.isFinite(detectedDurationSeconds) &&
      detectedDurationSeconds > 0
        ? Math.round(detectedDurationSeconds)
        : null);
    const saved = await updateOrganizationMusicPiece(piece.id, {
      ...requestFrom(piece),
      durationSeconds: nextDurationSeconds,
      trackFileIds: mapping,
    });
    let message = fileId ? `${key} learning track attached.` : `${key} learning track removed.`;
    if (previousFileId && previousFileId !== fileId) {
      try {
        await deletePrivateOrganizationFile(previousFileId);
      } catch (caught: unknown) {
        if (!(caught instanceof AuthApiError && caught.status === 409)) {
          message += " The old file could not be reclaimed automatically.";
        }
      }
    }
    onSaved(saved, message);
  }

  async function upload(key: string, file: File): Promise<void> {
    const validationError = validateAudioFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setActiveKey(key);
    setError(null);
    try {
      const uploaded = await uploadPrivateOrganizationFile(
        file,
        learningTrackFileName(piece.title, key, configuration),
      );
      try {
        const durationSeconds = await extractAudioDuration(file);
        await saveMapping(key, uploaded.id, durationSeconds);
        onTrackDurationDetected(key, durationSeconds);
      } catch (caught: unknown) {
        await deletePrivateOrganizationFile(uploaded.id).catch(() => undefined);
        throw caught;
      }
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The learning track could not be uploaded and attached.",
      );
    } finally {
      setActiveKey(null);
    }
  }

  function handleDrop(key: string, event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setDraggedKey(null);
    const file = event.dataTransfer.files.item(0);
    if (file) void upload(key, file);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setDraggedKey(null);
  }

  function handleFileSelection(key: string, event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.item(0);
    if (file) void upload(key, file);
    event.target.value = "";
  }

  async function remove(key: string): Promise<void> {
    setActiveKey(key);
    setError(null);
    try {
      await saveMapping(key, null);
      onTrackDurationDetected(key, null);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The learning track could not be removed.",
      );
    } finally {
      setActiveKey(null);
    }
  }

  const visibleKeys = trackKeys(piece, configuration, addedVoicePartLabels);
  const addableVoiceParts = configuration.voiceParts.filter(
    ({ label }) => !visibleKeys.includes(label),
  );

  return (
    <fieldset className="music-audio-tracks">
      <legend>Learning tracks{piece.title ? `: ${piece.title}` : ""}</legend>
      <p className="field-help">
        Attach a full mix, section, or {partLabel.toLowerCase()} track
        {piece.title ? ` for “${piece.title}”` : ""}. Organization members can play or download
        these files after signing in.
      </p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="music-audio-track-list">
        {visibleKeys.map((key) => {
          const fileId = piece.trackFileIds[key];
          const busy = activeKey === key;
          return (
            <div
              className={`music-audio-track${draggedKey === key ? " is-dragging" : ""}`}
              key={key}
              onDragEnter={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDraggedKey(key);
              }}
              onDragLeave={handleDragLeave}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "copy";
                setDraggedKey(key);
              }}
              onDrop={(event) => {
                handleDrop(key, event);
              }}
            >
              <span>
                <strong>{key === "tutti" ? "Tutti" : key}</strong>
                <small>{trackDescription(key, configuration)}</small>
              </span>
              {fileId ? (
                <div className="music-audio-track__controls">
                  <MusicInlineAudioPlayer
                    label={key === "tutti" ? "Tutti" : key}
                    src={`/api/organization/files/${fileId}`}
                  />
                  <a download href={`/api/organization/files/${fileId}`}>
                    Download
                  </a>
                  <button
                    className="button button--danger"
                    disabled={busy}
                    type="button"
                    onClick={() => void remove(key)}
                  >
                    {busy ? "Removing…" : "Remove"}
                  </button>
                </div>
              ) : (
                <label className="button button--secondary">
                  {busy ? "Uploading…" : "Upload audio"}
                  <input
                    accept="audio/*"
                    disabled={busy}
                    type="file"
                    onChange={(event) => {
                      handleFileSelection(key, event);
                    }}
                  />
                </label>
              )}
              {!fileId && !busy ? (
                <small className="music-audio-track__drop-hint">
                  Drop an audio file anywhere on this row
                </small>
              ) : null}
            </div>
          );
        })}
      </div>
      {addableVoiceParts.length > 0 ? (
        <div className="music-audio-track-add">
          <label htmlFor="music-add-voice-part">
            Add {partLabel.toLowerCase()} track slot
            <select
              id="music-add-voice-part"
              value=""
              onChange={(event) => {
                const label = event.target.value;
                if (!label) return;
                setAddedVoicePartLabels((current) => [...current, label]);
              }}
            >
              <option value="">Select {partLabel.toLowerCase()}…</option>
              {addableVoiceParts.map(({ fullName, label }) => (
                <option key={label} value={label}>
                  {label} ({fullName})
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}

export function MusicDeleteControls({
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
  const confirmRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (deleteConfirm) {
      confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [deleteConfirm]);

  return (
    <>
      <div className="dialog__actions music-piece-form__actions">
        {editingId && !deleteConfirm ? (
          <button className="button button--danger" type="button" onClick={onRequest}>
            Delete music piece
          </button>
        ) : null}
        {editingId ? (
          <button className="button button--secondary" type="button" onClick={onAddMovement}>
            Add movement
          </button>
        ) : null}
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Saving music…" : "Save music piece"}
        </button>
        {!deleteConfirm ? (
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Cancel
            </button>
          </DialogClose>
        ) : null}
      </div>
      {deleteConfirm ? (
        <div
          ref={confirmRef}
          tabIndex={-1}
          className="danger-confirmation"
          role="group"
          aria-label="Confirm music deletion"
        >
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

// eslint-disable-next-line complexity -- bulk edit layout with delete/cancel/update and confirm states
export function MusicBulkEditDialog({
  busy,
  configuration,
  error,
  onApply,
  onBulkDelete,
  onClose,
  open,
  personNameOptions,
  pieces,
  selectedCount,
  selectedPieceIds,
}: {
  readonly busy: boolean;
  readonly configuration: OrganizationRosterConfiguration;
  readonly error: string | null;
  readonly onApply: (changes: OrganizationMusicBulkUpdateRequest["changes"]) => void;
  readonly onBulkDelete?: (unlinkChildren: boolean) => void;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly personNameOptions: readonly string[];
  readonly pieces?: readonly OrganizationMusicPiece[];
  readonly selectedCount: number;
  readonly selectedPieceIds?: readonly string[];
}) {
  const [changeComposer, setChangeComposer] = useState(false);
  const [changeArranger, setChangeArranger] = useState(false);
  const [changeGenres, setChangeGenres] = useState(false);
  const [changeSections, setChangeSections] = useState(false);
  const [composer, setComposer] = useState("");
  const [arranger, setArranger] = useState("");
  const [genres, setGenres] = useState("");
  const [sections, setSections] = useState<readonly string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [unlinkChildren, setUnlinkChildren] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const availableSections = configuration.sections.filter(({ trackOnly }) => !trackOnly);

  const selectedSet = new Set(selectedPieceIds ?? []);
  const externalChildCount =
    pieces && selectedPieceIds
      ? pieces.filter(
          (piece) =>
            piece.parentId !== null &&
            selectedSet.has(piece.parentId) &&
            !selectedSet.has(piece.id),
        ).length
      : 0;

  useEffect(() => {
    if (deleteConfirm) {
      confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [deleteConfirm]);

  function submit(): void {
    const changes: OrganizationMusicBulkUpdateRequest["changes"] = {};
    if (changeComposer) changes.composer = composer.trim();
    if (changeArranger) changes.arranger = arranger.trim();
    if (changeGenres) changes.genres = uniqueLabels(genres);
    if (changeSections) changes.sectionBuckets = [...sections];
    if (Object.keys(changes).length === 0) {
      setFormError("Choose at least one field to change.");
      return;
    }
    setFormError(null);
    onApply(changes);
  }

  const canBulkDelete = typeof onBulkDelete === "function" && selectedCount > 0;

  return (
    <Dialog
      description={`Apply shared metadata to ${String(selectedCount)} selected music pieces.`}
      onClose={onClose}
      open={open}
      title="Bulk edit music pieces"
    >
      <form
        className="form-stack music-bulk-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <datalist id="music-bulk-composer-arranger-options">
          {personNameOptions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <p className="field-help">
          Only the fields you select will change. Leave a selected text field blank to clear it.
        </p>
        {error || formError ? (
          <p className="notice notice--error" role="alert">
            {error ?? formError}
          </p>
        ) : null}
        <fieldset className="music-bulk-edit-fields">
          <legend>Fields to change</legend>
          <div className="music-bulk-edit-field">
            <label className="checkbox-row">
              <input
                checked={changeComposer}
                type="checkbox"
                onChange={(event) => {
                  setChangeComposer(event.target.checked);
                }}
              />
              Composer
            </label>
            <input
              aria-label="Bulk composer"
              disabled={!changeComposer}
              list="music-bulk-composer-arranger-options"
              placeholder="Leave blank to clear"
              value={composer}
              onChange={(event) => {
                setComposer(event.target.value);
              }}
            />
          </div>
          <div className="music-bulk-edit-field">
            <label className="checkbox-row">
              <input
                checked={changeArranger}
                type="checkbox"
                onChange={(event) => {
                  setChangeArranger(event.target.checked);
                }}
              />
              Arranger
            </label>
            <input
              aria-label="Bulk arranger"
              disabled={!changeArranger}
              list="music-bulk-composer-arranger-options"
              placeholder="Leave blank to clear"
              value={arranger}
              onChange={(event) => {
                setArranger(event.target.value);
              }}
            />
          </div>
          <div className="music-bulk-edit-field">
            <label className="checkbox-row">
              <input
                checked={changeGenres}
                type="checkbox"
                onChange={(event) => {
                  setChangeGenres(event.target.checked);
                }}
              />
              Genres
            </label>
            <input
              aria-label="Bulk genres"
              disabled={!changeGenres}
              placeholder="Comma separated; blank clears genres"
              value={genres}
              onChange={(event) => {
                setGenres(event.target.value);
              }}
            />
          </div>
          <div className="music-bulk-edit-field">
            <label className="checkbox-row">
              <input
                checked={changeSections}
                type="checkbox"
                onChange={(event) => {
                  setChangeSections(event.target.checked);
                }}
              />
              Sections using this music
            </label>
            <div className="music-bulk-edit-section-options">
              {availableSections.map((section) => (
                <label className="checkbox-row" key={section.code}>
                  <input
                    checked={sections.includes(section.code)}
                    disabled={!changeSections}
                    type="checkbox"
                    onChange={(event) => {
                      setSections((current) =>
                        event.target.checked
                          ? [...current, section.code]
                          : current.filter((code) => code !== section.code),
                      );
                    }}
                  />
                  {section.name} ({section.code})
                </label>
              ))}
            </div>
          </div>
        </fieldset>
        <div
          className="dialog__actions"
          style={{ justifyContent: canBulkDelete && !deleteConfirm ? "space-between" : "flex-end" }}
        >
          {canBulkDelete && !deleteConfirm ? (
            <button
              className="button button--danger"
              disabled={busy}
              type="button"
              onClick={() => {
                setDeleteConfirm(true);
              }}
            >
              Delete {String(selectedCount)} pieces
            </button>
          ) : null}
          <div style={{ display: "flex", gap: "var(--spacing-sm)" }}>
            <DialogClose asChild>
              <button className="button button--secondary" disabled={busy} type="button">
                Cancel
              </button>
            </DialogClose>
            <button className="button button--primary" disabled={busy} type="submit">
              {busy ? "Updating…" : `Update ${String(selectedCount)} pieces`}
            </button>
          </div>
        </div>
      </form>
      {canBulkDelete && deleteConfirm ? (
        <div
          ref={confirmRef}
          tabIndex={-1}
          className="danger-confirmation"
          role="group"
          aria-label="Confirm bulk music deletion"
        >
          <p>
            This cannot be undone. Delete {String(selectedCount)} selected piece(s)? Referenced
            set-list pieces cannot be deleted.
          </p>
          {externalChildCount > 0 ? (
            <label className="checkbox-row">
              <input
                checked={unlinkChildren}
                type="checkbox"
                onChange={(event) => {
                  setUnlinkChildren(event.target.checked);
                }}
              />
              Keep {String(externalChildCount)} movement(s) as top-level works
            </label>
          ) : null}
          <div className="form-actions">
            <button
              className="button button--danger"
              disabled={busy || (externalChildCount > 0 && !unlinkChildren)}
              type="button"
              onClick={() => {
                onBulkDelete(unlinkChildren);
              }}
            >
              Confirm delete {String(selectedCount)} pieces
            </button>
            <button
              className="button button--secondary"
              disabled={busy}
              type="button"
              onClick={() => {
                setDeleteConfirm(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
