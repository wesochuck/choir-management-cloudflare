import { DialogClose } from "@choir/ui";
import type { OrganizationEvent, OrganizationRosterConfiguration } from "@choir/contracts";
import { parsePracticeTrackFilename } from "@choir/domain";
import { useCallback, useId, useState } from "react";
import { extractAudioDuration } from "../../../audioDuration";
import type { InspectedTrackFile, TrackImportScope } from "./types";

function formatDuration(seconds: number | null): string {
  if (typeof seconds !== "number" || seconds <= 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  const remSecs = String(seconds % 60).padStart(2, "0");
  return `${String(mins)}:${remSecs}`;
}

export function StepScopeAndFiles({
  events,
  files,
  inspecting,
  onFilesChanged,
  onNext,
  onScopeChanged,
  onSelectedEventChanged,
  roster,
  scope,
  selectedEventId,
}: {
  readonly events: readonly OrganizationEvent[];
  readonly files: readonly InspectedTrackFile[];
  readonly inspecting: boolean;
  readonly onFilesChanged: (files: readonly InspectedTrackFile[]) => void;
  readonly onNext: () => void;
  readonly onScopeChanged: (scope: TrackImportScope) => void;
  readonly onSelectedEventChanged: (eventId: string | null) => void;
  readonly roster: OrganizationRosterConfiguration | null;
  readonly scope: TrackImportScope;
  readonly selectedEventId: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputId = useId();

  const performances = events.filter((e) => e.type === "Performance" || e.setList.length > 0);

  const configuredParts = (roster?.voiceParts ?? []).map((vp) => ({
    key: vp.label,
    label: vp.fullName,
  }));

  const handleProcessRawFiles = useCallback(
    async (rawFiles: FileList | readonly File[]) => {
      const fileArray = Array.from(rawFiles).filter(
        (f) => f.name.toLowerCase().endsWith(".mp3") || f.type.startsWith("audio/"),
      );
      if (fileArray.length === 0) return;

      const inspectedPromises = fileArray.map(async (file, index) => {
        const clientFileId = `file-${String(Date.now())}-${String(index)}-${file.name}`;
        let durationSeconds: number | null;
        try {
          durationSeconds = await extractAudioDuration(file);
        } catch {
          durationSeconds = null;
        }

        const parsed = parsePracticeTrackFilename(
          file.name,
          configuredParts,
          clientFileId,
          durationSeconds,
        );

        return {
          clientFileId,
          detectedPartKey: parsed.detectedPartKey,
          detectedPartLabel: parsed.detectedPartLabel,
          durationSeconds: parsed.durationSeconds,
          file,
          fileName: file.name,
          inferredTitle: parsed.inferredTitle,
          sequenceNumber: parsed.sequenceNumber,
        } satisfies InspectedTrackFile;
      });

      const newInspected = await Promise.all(inspectedPromises);
      onFilesChanged([...files, ...newInspected]);
    },
    [configuredParts, files, onFilesChanged],
  );

  return (
    <div className="track-import-wizard-step">
      <div className="track-import-grid">
        <div className="track-import-main">
          <fieldset className="track-import-scope-fieldset">
            <legend className="track-import-legend">Match recordings against</legend>
            <div className="track-import-scope-options">
              <label
                className={`track-import-scope-card ${
                  scope === "set_list" ? "track-import-scope-card--active" : ""
                }`}
              >
                <input
                  checked={scope === "set_list"}
                  name="track-import-scope"
                  type="radio"
                  value="set_list"
                  onChange={() => {
                    onScopeChanged("set_list");
                    if (!selectedEventId && performances[0]) {
                      onSelectedEventChanged(performances[0].id);
                    }
                  }}
                />
                <div className="track-import-scope-card__content">
                  <span className="track-import-scope-card__title">
                    Specific performance set list
                  </span>
                  <span className="track-import-scope-card__desc">
                    Match against linked pieces first
                  </span>
                </div>
              </label>

              <label
                className={`track-import-scope-card ${
                  scope === "entire_library" ? "track-import-scope-card--active" : ""
                }`}
              >
                <input
                  checked={scope === "entire_library"}
                  name="track-import-scope"
                  type="radio"
                  value="entire_library"
                  onChange={() => {
                    onScopeChanged("entire_library");
                  }}
                />
                <div className="track-import-scope-card__content">
                  <span className="track-import-scope-card__title">Entire Music Library</span>
                  <span className="track-import-scope-card__desc">Search every catalog piece</span>
                </div>
              </label>
            </div>
          </fieldset>

          {scope === "set_list" ? (
            <div className="track-import-performance-select field">
              <label htmlFor="track-import-selected-event">
                Selected performance
                <select
                  id="track-import-selected-event"
                  value={selectedEventId ?? ""}
                  onChange={(e) => {
                    onSelectedEventChanged(e.target.value || null);
                  }}
                >
                  {performances.length === 0 ? (
                    <option value="">No performances found</option>
                  ) : (
                    performances.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.title} · {String(event.setList.length)} pieces
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>
          ) : null}

          <div
            className={`track-import-dropzone ${
              dragOver ? "track-import-dropzone--drag-over" : ""
            }`}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleProcessRawFiles(e.dataTransfer.files);
            }}
          >
            <input
              multiple
              accept="audio/mpeg,audio/mp3,.mp3,audio/*"
              className="track-import-file-input"
              id={fileInputId}
              type="file"
              onChange={(e) => {
                if (e.target.files) {
                  void handleProcessRawFiles(e.target.files);
                }
              }}
            />
            <label className="track-import-dropzone__label" htmlFor={fileInputId}>
              <span className="track-import-dropzone__icon" aria-hidden="true">
                🎧
              </span>
              <span className="track-import-dropzone__heading">Drop MP3s here or browse files</span>
              <span className="track-import-dropzone__hint">
                Multiple files or a folder, where supported
              </span>
            </label>
          </div>

          <div className="track-import-file-list-section">
            <div className="track-import-file-list-header">
              <span className="track-import-file-list-header__count">
                {String(files.length)} files selected
              </span>
              {inspecting ? (
                <span className="badge badge--warning">Inspecting audio…</span>
              ) : files.length > 0 ? (
                <span className="badge badge--success">Inspection complete</span>
              ) : null}
            </div>

            {files.length > 0 ? (
              <div className="track-import-files-table-container">
                <table className="track-import-files-table">
                  <thead>
                    <tr>
                      <th scope="col">Local filename</th>
                      <th scope="col">Duration</th>
                      <th scope="col">Detected part</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file) => (
                      <tr key={file.clientFileId}>
                        <td className="track-import-filename-cell">
                          <span aria-hidden="true" className="track-import-audio-icon">
                            ♪
                          </span>
                          <span className="track-import-filename-text">{file.fileName}</span>
                        </td>
                        <td className="track-import-duration-cell">
                          {formatDuration(file.durationSeconds)}
                        </td>
                        <td className="track-import-part-cell">
                          {file.detectedPartLabel ? (
                            <span className="badge badge--accent">{file.detectedPartLabel}</span>
                          ) : (
                            <span className="badge badge--neutral">Unassigned</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="track-import-sidebar" aria-label="Matching overview">
          <div className="track-import-sidebar__card">
            <h3 className="track-import-sidebar__title">How matching begins</h3>
            <p className="track-import-sidebar__subtitle">
              Independent signals, not duration alone
            </p>
            <ol className="track-import-sidebar__steps">
              <li>
                <strong>Recording duration</strong>
                <span>Close timing strongly supports a group.</span>
              </li>
              <li>
                <strong>Filename clues</strong>
                <span>Track numbers and title fragments.</span>
              </li>
              <li>
                <strong>Configured voice parts</strong>
                <span>Recognize aliases, sections and Tutti.</span>
              </li>
              <li>
                <strong>Selected set-list pieces</strong>
                <span>Narrow title candidates when available.</span>
              </li>
              <li>
                <strong>CLEF Flash for uncertainty</strong>
                <span>Text metadata only. No MP3 sent to AI.</span>
              </li>
            </ol>
          </div>
        </aside>
      </div>

      <div className="dialog__actions track-import-actions">
        <span className="track-import-actions__note">
          Preview only: no R2 files, music attachments or AI audio calls.
        </span>
        <div className="track-import-actions__buttons">
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Cancel
            </button>
          </DialogClose>
          <button
            className="button button--primary"
            disabled={inspecting || files.length === 0}
            type="button"
            onClick={onNext}
          >
            Review groups
          </button>
        </div>
      </div>
    </div>
  );
}
