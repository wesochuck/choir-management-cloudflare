import type { OrganizationMusicPiece, OrganizationRosterConfiguration } from "@choir/contracts";
import { digitalScoreFileName, scoreDescription, STANDARD_SCORE_KEYS } from "@choir/domain";
import { useState, type ChangeEvent, type DragEvent } from "react";
import {
  AuthApiError,
  deletePrivateOrganizationFile,
  updateOrganizationMusicPiece,
  uploadPrivateOrganizationFile,
} from "../../../auth/api";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";
import { requestFrom } from "./utils";

function validatePdfFile(file: File): string | null {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return "Digital scores must be valid PDF files.";
  }
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
    return "Digital scores must be larger than 0 bytes and no more than 20 MB.";
  }
  return null;
}

function DigitalScoreSlot({
  busy,
  configuration,
  desc,
  dragged,
  fileId,
  isPrimary,
  keyName,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onFileSelected,
  onRemove,
  parentTitle,
  pieceTitle,
}: {
  readonly busy: boolean;
  readonly configuration: OrganizationRosterConfiguration;
  readonly desc: string;
  readonly dragged: boolean;
  readonly fileId?: string | undefined;
  readonly isPrimary: boolean;
  readonly keyName: string;
  readonly onDragEnter: (e: DragEvent<HTMLDivElement>) => void;
  readonly onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  readonly onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  readonly onDrop: (e: DragEvent<HTMLDivElement>) => void;
  readonly onFileSelected: (e: ChangeEvent<HTMLInputElement>) => void;
  readonly onRemove: () => void;
  readonly parentTitle?: string | null | undefined;
  readonly pieceTitle: string;
}) {
  return (
    <div
      className={`music-audio-track${dragged ? " is-dragging" : ""}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span>
        <strong>{isPrimary ? "Primary Score" : keyName}</strong>
        <small>{desc}</small>
      </span>
      {fileId ? (
        <div className="music-audio-track__controls">
          <a
            className="button button--secondary"
            href={`/api/organization/files/${fileId}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            View
          </a>
          <a
            className="button button--secondary"
            download={digitalScoreFileName(pieceTitle, parentTitle, keyName, configuration)}
            href={`/api/organization/files/${fileId}`}
          >
            Download
          </a>
          <button
            className="button button--danger"
            disabled={busy}
            type="button"
            onClick={onRemove}
          >
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      ) : (
        <label className="button button--secondary">
          {busy ? "Uploading…" : "Upload PDF"}
          <input accept="application/pdf" disabled={busy} type="file" onChange={onFileSelected} />
        </label>
      )}
    </div>
  );
}

export function MusicDigitalScores({
  configuration,
  onSaved,
  parentPiece,
  piece,
}: {
  readonly configuration: OrganizationRosterConfiguration;
  readonly onSaved: (piece: OrganizationMusicPiece, message: string) => void;
  readonly parentPiece?: OrganizationMusicPiece | null;
  readonly piece: OrganizationMusicPiece;
}) {
  const { partLabel } = useOrganizationTerminology();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [addedKeys, setAddedKeys] = useState<readonly string[]>([]);
  const [selectedAddKey, setSelectedAddKey] = useState<string>("");

  const scoreFileIds = piece.scoreFileIds;

  // Standard + part keys that are currently assigned or temporarily added to view
  const currentKeys = Array.from(new Set(["primary", ...Object.keys(scoreFileIds), ...addedKeys]));

  // Available keys that can still be added
  const availableOptions: { key: string; label: string }[] = [];
  for (const std of STANDARD_SCORE_KEYS) {
    if (std.key !== "primary" && !currentKeys.includes(std.key)) {
      availableOptions.push(std);
    }
  }
  for (const part of configuration.voiceParts) {
    if (!currentKeys.includes(part.label)) {
      availableOptions.push({
        key: part.label,
        label: `${part.fullName} (${part.label})`,
      });
    }
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    const relatedTarget = event.relatedTarget;
    if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
      setDraggedKey(null);
    }
  }

  async function uploadScoreFile(key: string, file: File): Promise<void> {
    const validationError = validatePdfFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setActiveKey(key);
    setError(null);
    try {
      const description = scoreDescription(key, configuration);
      const safeName = digitalScoreFileName(piece.title, parentPiece?.title, key, configuration);

      const uploaded = await uploadPrivateOrganizationFile(file, safeName);

      const previousFileId = scoreFileIds[key];
      const updatedScoreFileIds = {
        ...scoreFileIds,
        [key]: uploaded.id,
      };

      const requestPayload = requestFrom(piece);
      requestPayload.scoreFileIds = updatedScoreFileIds;

      const savedPiece = await updateOrganizationMusicPiece(piece.id, requestPayload);

      if (previousFileId && previousFileId !== uploaded.id) {
        try {
          await deletePrivateOrganizationFile(previousFileId);
        } catch {
          // Failure to delete orphaned previous file is non-fatal
        }
      }

      onSaved(savedPiece, `Uploaded ${description} score.`);
      setDraggedKey(null);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The digital score could not be uploaded.",
      );
    } finally {
      setActiveKey(null);
    }
  }

  function handleDrop(key: string, event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
    setDraggedKey(null);

    const file = event.dataTransfer.files[0];
    if (!file) return;
    void uploadScoreFile(key, file);
  }

  function handleFileSelection(key: string, event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    void uploadScoreFile(key, file);
  }

  async function remove(key: string): Promise<void> {
    const fileId = scoreFileIds[key];
    if (!fileId) return;

    setActiveKey(key);
    setError(null);
    try {
      const updatedScoreFileIds = Object.fromEntries(
        Object.entries(scoreFileIds).filter(([candidateKey]) => candidateKey !== key),
      );

      const requestPayload = requestFrom(piece);
      requestPayload.scoreFileIds = updatedScoreFileIds;

      const savedPiece = await updateOrganizationMusicPiece(piece.id, requestPayload);

      try {
        await deletePrivateOrganizationFile(fileId);
      } catch {
        // Non-fatal if delete failed on storage
      }

      const description = scoreDescription(key, configuration);
      onSaved(savedPiece, `Removed ${description} score.`);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError ? caught.message : "The digital score could not be removed.",
      );
    } finally {
      setActiveKey(null);
    }
  }

  function handleAddScoreKey(): void {
    if (!selectedAddKey) return;
    setAddedKeys((prev) => Array.from(new Set([...prev, selectedAddKey])));
    setSelectedAddKey("");
  }

  // Parent fallback indicator
  const hasDirectPrimary = Boolean(scoreFileIds.primary);
  const parentPrimaryFileId = parentPiece?.scoreFileIds.primary;
  const showParentFallback = !hasDirectPrimary && Boolean(parentPrimaryFileId);

  return (
    <fieldset className="music-audio-tracks">
      <legend>Digital scores{piece.title ? `: ${piece.title}` : ""}</legend>
      <p className="field-help">
        Attach PDF sheet music for “{piece.title || "this piece"}”. Attending{" "}
        {partLabel.toLowerCase()}s can view or download their scores during active concerts and
        rehearsals.
      </p>

      {showParentFallback ? (
        <div className="notice notice--info" style={{ marginBottom: "1rem" }}>
          This movement currently inherits the parent work’s Primary Score (
          <strong>{parentPiece?.title}</strong>). Uploading a Choral Score here will override the
          parent score for this specific movement.
        </div>
      ) : null}

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="music-audio-track-list">
        {currentKeys.map((key) => {
          const fileId = scoreFileIds[key];
          const busy = activeKey === key;
          const desc = scoreDescription(key, configuration);
          const isPrimary = key === "primary";

          return (
            <DigitalScoreSlot
              busy={busy}
              configuration={configuration}
              desc={desc}
              dragged={draggedKey === key}
              fileId={fileId}
              isPrimary={isPrimary}
              key={key}
              keyName={key}
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
              onFileSelected={(event) => {
                handleFileSelection(key, event);
              }}
              onRemove={() => {
                void remove(key);
              }}
              parentTitle={parentPiece?.title}
              pieceTitle={piece.title}
            />
          );
        })}
      </div>

      {availableOptions.length > 0 ? (
        <div
          style={{
            alignItems: "center",
            borderTop: "1px solid var(--color-border-subtle)",
            display: "flex",
            gap: "0.5rem",
            marginTop: "1rem",
            paddingTop: "0.75rem",
          }}
        >
          <label htmlFor="add-score-select" style={{ fontSize: "var(--font-size-sm)" }}>
            Add score edition:
          </label>
          <select
            id="add-score-select"
            style={{ maxWidth: "16rem" }}
            value={selectedAddKey}
            onChange={(e) => {
              setSelectedAddKey(e.target.value);
            }}
          >
            <option value="">Select edition or voice part…</option>
            {availableOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            className="button button--secondary"
            disabled={!selectedAddKey}
            type="button"
            onClick={handleAddScoreKey}
          >
            Add score slot
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
