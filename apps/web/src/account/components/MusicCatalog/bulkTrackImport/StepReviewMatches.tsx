import type { OrganizationMusicPiece, OrganizationRosterConfiguration } from "@choir/contracts";
import { useMemo, useState } from "react";
import { TrackFileAudioPlayer } from "./TrackFileAudioPlayer";
import type { GroupReviewItem } from "./types";

function formatDuration(seconds: number | null): string {
  if (typeof seconds !== "number" || seconds <= 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  const remSecs = String(seconds % 60).padStart(2, "0");
  return `${String(mins)}:${remSecs}`;
}

function missingMatchExplanation(pieceId: string | null): string {
  return pieceId
    ? "Selected manually; no matching evidence for this piece."
    : "No clear match. Choose a music piece to include these files.";
}

export function StepReviewMatches({
  groups,
  onBack,
  onGroupPieceChanged,
  onNext,
  onPartChanged,
  onSplitFile,
  performancePieceIds,
  pieces,
  roster,
}: {
  readonly groups: readonly GroupReviewItem[];
  readonly onBack: () => void;
  readonly onGroupPieceChanged: (groupId: string, pieceId: string | null) => void;
  readonly onNext: () => void;
  readonly onPartChanged: (groupId: string, clientFileId: string, partKey: string | null) => void;
  readonly onSplitFile: (clientFileId: string) => void;
  readonly performancePieceIds: readonly string[];
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly roster: OrganizationRosterConfiguration | null;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>(groups[0]?.groupId ?? "");

  const activeGroup = groups.find((g) => g.groupId === selectedGroupId) ?? groups[0];

  const pieceMap = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);

  // Voice part options
  const partOptions = useMemo(() => {
    const list: { key: string; label: string }[] = [{ key: "tutti", label: "Tutti" }];
    for (const vp of roster?.voiceParts ?? []) {
      list.push({ key: vp.label, label: vp.fullName });
    }
    list.push({ key: "accompaniment", label: "Accompaniment" });
    return list;
  }, [roster]);

  const activeEvidence =
    activeGroup?.candidates.find((candidate) => candidate.piece.id === activeGroup.selectedPieceId)
      ?.evidence ?? [];

  const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0);
  const isStrongSuggestion = (group: GroupReviewItem) =>
    !group.hasDuplicatePart &&
    group.candidates.some(
      (candidate) =>
        candidate.piece.id === group.selectedPieceId && candidate.confidence === "high",
    );
  const strongCount = groups.filter(isStrongSuggestion).length;
  const reviewCount = groups.length - strongCount;

  return (
    <div className="track-import-wizard-step">
      <div className="track-import-summary-pills">
        <span className="badge badge--neutral">{String(totalFiles)} files</span>
        <span className="badge badge--neutral">{String(groups.length)} song sets</span>
        <span className="badge badge--success">{String(strongCount)} strong suggestions</span>
        {reviewCount > 0 ? (
          <span className="badge badge--warning">{String(reviewCount)} need review</span>
        ) : null}
      </div>

      <p>
        Files in each song set share one destination piece. Check the piece and voice part before
        uploading. Files without an assigned part are excluded.
      </p>
      <div className="track-import-grid">
        <div className="track-import-main">
          {groups.map((group) => {
            const selectedPiece = group.selectedPieceId
              ? pieceMap.get(group.selectedPieceId)
              : undefined;
            const selectedCandidate = group.candidates.find(
              (candidate) => candidate.piece.id === group.selectedPieceId,
            );
            const evidence = selectedCandidate?.evidence ?? [];
            const existingTrackCount = Object.keys(selectedPiece?.trackFileIds ?? {}).length;

            return (
              <div
                key={group.groupId}
                className={`track-import-group-card ${
                  !isStrongSuggestion(group)
                    ? "track-import-group-card--warning"
                    : "track-import-group-card--success"
                }`}
                onClick={() => {
                  setSelectedGroupId(group.groupId);
                }}
                onFocus={() => {
                  setSelectedGroupId(group.groupId);
                }}
              >
                <div className="track-import-group-card__header">
                  <div className="track-import-group-card__badges">
                    <h3>{group.inferredTitle}</h3>
                    <span className="badge badge--neutral">
                      {String(group.files.length)} {group.files.length === 1 ? "file" : "files"}
                    </span>
                    {group.hasDuplicatePart ? (
                      <span className="badge badge--warning">Needs review</span>
                    ) : isStrongSuggestion(group) ? (
                      <span className="badge badge--success">Strong suggestion</span>
                    ) : group.selectedPieceId ? (
                      <span className="badge badge--warning">Review selection</span>
                    ) : (
                      <span className="badge badge--neutral">No piece selected</span>
                    )}
                  </div>
                </div>

                <div className="track-import-group-piece-select field">
                  <label htmlFor={`group-piece-${group.groupId}`}>
                    Destination music piece
                    <div className="track-import-piece-select-row">
                      <select
                        id={`group-piece-${group.groupId}`}
                        value={group.selectedPieceId ?? ""}
                        onChange={(e) => {
                          onGroupPieceChanged(group.groupId, e.target.value || null);
                        }}
                      >
                        <option value="">-- Choose a music library piece --</option>
                        {performancePieceIds.length > 0 ? (
                          <optgroup label="Performance Set List">
                            {performancePieceIds.map((pid) => {
                              const p = pieceMap.get(pid);
                              if (!p) return null;
                              return (
                                <option key={p.id} value={p.id}>
                                  {p.title} ({p.composer || "Unknown"})
                                </option>
                              );
                            })}
                          </optgroup>
                        ) : null}
                        <optgroup label="Entire Music Library">
                          {pieces.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title} ({p.composer || "Unknown"})
                            </option>
                          ))}
                        </optgroup>
                      </select>

                      {selectedPiece ? (
                        <span className="badge badge--neutral">
                          {String(existingTrackCount)} existing tracks
                        </span>
                      ) : null}
                    </div>
                  </label>
                </div>

                {evidence.length > 0 ? (
                  <p className="track-import-group-evidence">Evidence: {evidence.join(" + ")}</p>
                ) : (
                  <p className="track-import-group-evidence">
                    {missingMatchExplanation(group.selectedPieceId)}
                  </p>
                )}

                <div className="track-import-group-files-table-container">
                  <table className="track-import-group-files-table">
                    <thead>
                      <tr>
                        <th scope="col">File</th>
                        <th scope="col">Assigned part</th>
                        <th scope="col">Duration</th>
                        <th scope="col">Status</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.files.map((file) => {
                        const isDuplicate =
                          file.partKey && group.duplicatePartKeys.includes(file.partKey);
                        const isSlotOccupied =
                          file.partKey && Boolean(selectedPiece?.trackFileIds[file.partKey]);

                        return (
                          <tr key={file.clientFileId}>
                            <td className="track-import-filename-cell">
                              <div className="track-import-filename-row">
                                <span aria-hidden="true" className="track-import-audio-icon">
                                  ♪
                                </span>
                                <span className="track-import-filename-text">{file.fileName}</span>
                              </div>
                              <TrackFileAudioPlayer
                                key={file.clientFileId}
                                durationSeconds={file.durationSeconds}
                                file={file.file}
                                fileName={file.fileName}
                              />
                            </td>
                            <td className="track-import-part-cell">
                              <select
                                aria-label={`Voice part for ${file.fileName}`}
                                value={file.partKey ?? ""}
                                onChange={(e) => {
                                  onPartChanged(
                                    group.groupId,
                                    file.clientFileId,
                                    e.target.value || null,
                                  );
                                }}
                              >
                                <option value="">-- Choose part (or exclude file) --</option>
                                {partOptions.map((opt) => (
                                  <option key={opt.key} value={opt.key}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="track-import-duration-cell">
                              {formatDuration(file.durationSeconds)}
                            </td>
                            <td className="track-import-status-cell">
                              {isDuplicate ? (
                                <span className="badge badge--warning">Duplicate part</span>
                              ) : isSlotOccupied ? (
                                <span className="badge badge--warning">Slot occupied</span>
                              ) : file.partKey ? (
                                <span className="badge badge--success">✓ Ready</span>
                              ) : (
                                <span className="badge badge--neutral">Part needed</span>
                              )}
                            </td>
                            <td className="track-import-actions-cell">
                              {group.files.length > 1 ? (
                                <button
                                  className="button button--ghost"
                                  title="Split file to its own group"
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSplitFile(file.clientFileId);
                                  }}
                                >
                                  Split
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="track-import-sidebar" aria-label="Group evidence">
          <div className="track-import-sidebar__card">
            <h3 className="track-import-sidebar__title">Why this suggestion?</h3>
            <ul className="track-import-sidebar__evidence-list">
              {activeEvidence.length > 0 ? (
                activeEvidence.map((ev) => (
                  <li key={ev} className="track-import-sidebar__evidence-item">
                    <span aria-hidden="true">✓</span>
                    <span>{ev}</span>
                  </li>
                ))
              ) : (
                <li className="track-import-sidebar__evidence-item">
                  <span>No matching evidence for the current selection.</span>
                </li>
              )}
            </ul>

            <div className="track-import-sidebar__divider" />

            <div className="track-import-safety-rule-card">
              <span className="track-import-safety-rule-card__title">SAFETY RULE</span>
              <p className="track-import-safety-rule-card__body">
                Never silently replace a preexisting recording. Existing recordings remain
                protected.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <div className="dialog__actions track-import-actions">
        <span className="track-import-actions__note">
          Staff must approve resolved mappings before any file is uploaded.
        </span>
        <div className="track-import-actions__buttons">
          <button className="button button--secondary" type="button" onClick={onBack}>
            Back
          </button>
          <button className="button button--primary" type="button" onClick={onNext}>
            Confirm selections
          </button>
        </div>
      </div>
    </div>
  );
}
