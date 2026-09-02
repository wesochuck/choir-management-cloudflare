import type { OrganizationMusicPiece, OrganizationRosterConfiguration } from "@choir/contracts";
import { useState, type ChangeEvent, type DragEvent } from "react";
import {
  AuthApiError,
  deletePrivateOrganizationFile,
  updateOrganizationMusicPiece,
  uploadPrivateOrganizationFile,
} from "../../../auth/api";
import { extractAudioDuration } from "../../audioDuration";
import { learningTrackFileName } from "../../learningTrackFilename";
import { requestFrom } from "./utils";
import { validateAudioFile } from "./tableUtils";

const fallbackRosterConfiguration: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [{ code: "all", color: "#000000", name: "All", trackOnly: false }],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [{ fullName: "All", label: "all", sectionCode: "all" }],
};

export function MusicTableTuttiDropTarget({
  configuration,
  onError,
  onSaved,
  piece,
}: {
  readonly configuration?: OrganizationRosterConfiguration | null | undefined;
  readonly onError?: ((error: string) => void) | undefined;
  readonly onSaved?: ((piece: OrganizationMusicPiece, message: string) => void) | undefined;
  readonly piece: OrganizationMusicPiece;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFile(file: File): Promise<void> {
    const validationError = validateAudioFile(file);
    if (validationError) {
      onError?.(validationError);
      return;
    }

    setIsUploading(true);
    let uploadedFileId: string | null = null;
    try {
      const activeConfig = configuration ?? fallbackRosterConfiguration;
      const uploaded = await uploadPrivateOrganizationFile(
        file,
        learningTrackFileName(piece.title, "tutti", activeConfig),
      );
      uploadedFileId = uploaded.id;

      let detectedDurationSeconds: number | null = null;
      try {
        detectedDurationSeconds = await Promise.race([
          extractAudioDuration(file),
          new Promise<null>((resolve) => {
            setTimeout(() => {
              resolve(null);
            }, 1500);
          }),
        ]);
      } catch {
        // Duration detection is best-effort.
      }

      const previousTuttiFileId = piece.trackFileIds.tutti;
      const saved = await updateOrganizationMusicPiece(piece.id, {
        ...requestFrom(piece),
        durationSeconds:
          piece.durationSeconds ??
          (detectedDurationSeconds ? Math.round(detectedDurationSeconds) : null),
        trackFileIds: {
          ...piece.trackFileIds,
          tutti: uploaded.id,
        },
      });

      if (previousTuttiFileId && previousTuttiFileId !== uploaded.id) {
        void deletePrivateOrganizationFile(previousTuttiFileId).catch(() => undefined);
      }

      onSaved?.(saved, `Tutti practice track attached for “${piece.title}”.`);
    } catch (caught: unknown) {
      if (uploadedFileId) {
        void deletePrivateOrganizationFile(uploadedFileId).catch(() => undefined);
      }
      const message =
        caught instanceof AuthApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "The Tutti practice track could not be uploaded.";
      onError?.(message);
    } finally {
      setIsUploading(false);
    }
  }

  function onDragEnter(event: DragEvent<HTMLLabelElement>): void {
    if (isUploading) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }

  function onDragOver(event: DragEvent<HTMLLabelElement>): void {
    if (isUploading) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLLabelElement>): void {
    if (isUploading) return;
    event.preventDefault();
    event.stopPropagation();
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    setIsDragging(false);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>): void {
    if (isUploading) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const droppedFile = event.dataTransfer.files.item(0);
    if (droppedFile) {
      void handleFile(droppedFile);
    }
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const selectedFile = event.target.files?.item(0);
    if (selectedFile) {
      void handleFile(selectedFile);
    }
    event.target.value = "";
  }

  return (
    <label
      className={`music-table-tutti-dropzone${isDragging ? " is-dragging" : ""}${
        isUploading ? " is-uploading" : ""
      }`}
      title={`Drop audio file or click to upload Tutti track for ${piece.title}`}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <input
        accept="audio/*"
        aria-label={`Upload Tutti practice track for ${piece.title}`}
        className="sr-only"
        disabled={isUploading}
        type="file"
        onChange={onFileInputChange}
        onClick={(event) => {
          event.stopPropagation();
        }}
      />
      {isUploading ? (
        <span aria-live="polite" className="music-table-tutti-dropzone__loading">
          <span aria-hidden="true" className="music-table-tutti-dropzone__spinner" />
          <span className="sr-only">Uploading Tutti track…</span>
        </span>
      ) : (
        <span aria-hidden="true" className="music-table-tutti-dropzone__icon">
          <svg
            aria-hidden="true"
            fill="none"
            height="14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
            viewBox="0 0 16 16"
            width="14"
          >
            <path d="M8 10.5V2M4.5 5.5L8 2l3.5 3.5" />
            <path d="M2.5 10v2.5a1.5 1.5 0 001.5 1.5h8a1.5 1.5 0 001.5-1.5V10" />
          </svg>
        </span>
      )}
    </label>
  );
}
