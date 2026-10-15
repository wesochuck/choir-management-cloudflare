import type { OrganizationMusicPiece, OrganizationRosterConfiguration } from "@choir/contracts";
import { useMemo, useState } from "react";
import type { GroupReviewItem } from "./types";

function formatDuration(seconds: number | null): string {
  if (typeof seconds !== "number" || seconds <= 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  const remSecs = String(seconds % 60).padStart(2, "0");
  return `${String(mins)}:${remSecs}`;
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

  const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0);
  const strongCount = groups.filter((g) => g.selectedPieceId && !g.hasDuplicatePart).length;
  const reviewCount = groups.length - strongCount;

  return (
    <div className="track-import-wizard-step">
      <div className="track-import-summary-pills">
        <span className="badge badge--neutral">{String(totalFiles)} files</span>
        <span className="badge badge--neutral">{String(groups.length)} groups</span>
        <span className="badge badge--success">{String(strongCount)} strong suggestions</span>
        {reviewCount > 0 ? (
          <span className="badge badge--warning">{String(reviewCount)} need review</span>
        ) : null}
      </div>

      <div className="track-import-grid">
        <div className="track-import-main">
          {groups.map((group, groupIdx) => {
            const selectedPiece = group.selectedPieceId
              ? pieceMap.get(group.selectedPieceId)
              : undefined;
            const existingTrackCount = Object.keys(selectedPiece?.trackFileIds ?? {}).length;

            return (
              <div
                key={group.groupId}
                className={`track-import-group-card ${
                  group.hasDuplicatePart
                    ? "track-import-group-card--warning"
                    : "track-import-group-card--success"
                }`}
                onClick={() => {
                  setSelectedGroupId(group.groupId);
                }}
              >
                <div className="track-import-group-card__header">
                  <div className="track-import-group-card__badges">
                    <span className="badge badge--accent">
                      GROUP {String.fromCharCode(65 + (groupIdx % 26))}
                    </span>
                    {group.hasDuplicatePart ? (
                      <span className="badge badge--warning">Needs review</span>
                    ) : group.selectedPieceId ? (
                      <span className="badge badge--success">Strong suggestion</span>
                    ) : (
                      <span className="badge badge--neutral">No piece selected</span>
                    )}
                  </div>
                </div>

                <div className="track-import-group-piece-select field">
                  <label htmlFor={`group-piece-${group.groupId}`}>
                    Matched music piece
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

                {group.evidence.length > 0 ? (
                  <p className="track-import-group-evidence">
                    Evidence: {group.evidence.join(" + ")}
                  </p>
                ) : null}

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
                          file.partKey &&
                          selectedPiece?.trackFileIds &&
                          Boolean(selectedPiece.trackFileIds[file.partKey]);

                        return (
                          <tr key={file.clientFileId}>
                            <td className="track-import-filename-cell">
                              <span className="track-import-filename-text">{file.fileName}</span>
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
                                <option value="">-- Skip file --</option>
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
                                <span className="badge badge--neutral">Skipped</span>
                              )}
                            </td>
                            <td className="track-import-actions-cell">
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
              {(activeGroup?.evidence ?? []).length > 0 ? (
                activeGroup?.evidence.map((ev) => (
                  <li key={ev} className="track-import-sidebar__evidence-item">
                    <span aria-hidden="true">✓</span>
                    <span>{ev}</span>
                  </li>
                ))
              ) : (
                <li className="track-import-sidebar__evidence-item">
                  <span>Select a group on the left to see matching signals.</span>
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
