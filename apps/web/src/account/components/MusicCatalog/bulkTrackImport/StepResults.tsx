import type { MusicTrackAttachmentResult, OrganizationMusicPiece } from "@choir/contracts";

interface PieceActivityResult {
  readonly attachedParts: readonly string[];
  readonly conflictedParts: readonly string[];
  readonly pieceId: string;
  readonly pieceTitle: string;
  readonly skippedParts: readonly string[];
}

export function StepResults({
  onFinish,
  pieces,
  results,
  summary,
}: {
  readonly onFinish: () => void;
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly results: readonly MusicTrackAttachmentResult[];
  readonly summary: {
    readonly attached: number;
    readonly conflict: number;
    readonly failed: number;
    readonly skipped: number;
  };
}) {
  const pieceMap = new Map(pieces.map((p) => [p.id, p]));

  // Build per-piece summary
  const affectedPieceIds = Array.from(new Set(results.map((r) => r.pieceId)));

  const activityList: PieceActivityResult[] = affectedPieceIds.map((pieceId) => {
    const pieceResults = results.filter((r) => r.pieceId === pieceId);
    const piece = pieceMap.get(pieceId);

    const attachedParts = pieceResults.filter((r) => r.status === "attached").map((r) => r.partKey);
    const conflictedParts = pieceResults
      .filter((r) => r.status === "conflict")
      .map((r) => r.partKey);
    const skippedParts = pieceResults
      .filter((r) => r.status === "skipped" || r.status === "failed")
      .map((r) => r.partKey);

    return {
      attachedParts,
      conflictedParts,
      pieceId,
      pieceTitle: piece?.title ?? "Unknown Piece",
      skippedParts,
    };
  });

  const hasConflicts = summary.conflict > 0;

  return (
    <div className="track-import-wizard-step">
      <div className="track-import-results-header">
        <h3 className="track-import-results-title">Import completed</h3>
        {hasConflicts ? (
          <span className="badge badge--warning">Partial success</span>
        ) : (
          <span className="badge badge--success">Completed successfully</span>
        )}
      </div>

      <div className="track-import-stat-cards">
        <div className="track-import-stat-card track-import-stat-card--success">
          <span className="track-import-stat-card__number">{String(summary.attached)}</span>
          <div className="track-import-stat-card__text">
            <span className="track-import-stat-card__label">Tracks attached</span>
            <span className="track-import-stat-card__desc">New practice recordings</span>
          </div>
        </div>

        <div className="track-import-stat-card track-import-stat-card--neutral">
          <span className="track-import-stat-card__number">{String(summary.skipped)}</span>
          <div className="track-import-stat-card__text">
            <span className="track-import-stat-card__label">Files skipped</span>
            <span className="track-import-stat-card__desc">Not sent or attached</span>
          </div>
        </div>

        <div className="track-import-stat-card track-import-stat-card--warning">
          <span className="track-import-stat-card__number">{String(summary.conflict)}</span>
          <div className="track-import-stat-card__text">
            <span className="track-import-stat-card__label">Slots protected</span>
            <span className="track-import-stat-card__desc">Existing files untouched</span>
          </div>
        </div>
      </div>

      <div className="track-import-activity-section">
        <h4 className="track-import-activity-title">Import activity</h4>
        <div className="track-import-activity-table-container">
          <table className="track-import-files-table">
            <thead>
              <tr>
                <th scope="col">Music library piece</th>
                <th scope="col">Track assignments</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {activityList.map((item) => (
                <tr key={item.pieceId}>
                  <td className="track-import-piece-cell">{item.pieceTitle}</td>
                  <td className="track-import-assignments-cell">
                    {[
                      ...item.attachedParts,
                      ...item.conflictedParts.map((p) => `${p} (conflict)`),
                    ].join(", ") || "None"}
                  </td>
                  <td className="track-import-result-badge-cell">
                    {item.conflictedParts.length > 0 ? (
                      <span className="badge badge--warning">
                        {String(item.conflictedParts.length)} slot conflict(s)
                      </span>
                    ) : (
                      <span className="badge badge--success">
                        {String(item.attachedParts.length)} attached
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="notice notice--success track-import-safety-banner" role="status">
        <span aria-hidden="true" className="track-import-check-icon">
          ✓
        </span>
        <span>
          No preexisting practice-track assignments or recordings were replaced or deleted.
        </span>
      </div>

      <div className="dialog__actions track-import-actions">
        <span className="track-import-actions__note">
          Tracks are now accessible in practice players and the Music Library.
        </span>
        <div className="track-import-actions__buttons">
          <button className="button button--primary" type="button" onClick={onFinish}>
            Return to Music Library
          </button>
        </div>
      </div>
    </div>
  );
}
