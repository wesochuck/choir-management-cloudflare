import type {
  OrganizationPollResultOption,
  OrganizationPollResultsResponse,
} from "@choir/contracts";
import { timestampedExportFilename } from "@choir/domain";
import { Dialog } from "@choir/ui";
import { useState, type ReactNode } from "react";

import { buildPollResultsCsvRows } from "../../pollResultsCsv";

function formatExpiry(value: string): string {
  if (!value) return "No expiry";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "No expiry"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatSubmissionDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function exportResultsCsv(results: OrganizationPollResultsResponse): void {
  const rows = buildPollResultsCsvRows(results);
  const csvContent = rows
    .map((row) => row.map((field) => `"${field.replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeTitle = results.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  link.setAttribute("href", url);
  link.setAttribute(
    "download",
    timestampedExportFilename(`poll-results-${safeTitle || "export"}.csv`, new Date()),
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function copyRespondentSummary(
  results: OrganizationPollResultsResponse,
  onCopied: (msg: string) => void,
): void {
  const lines: string[] = [
    `${results.title} — Results (${String(results.totalResponses)} total respondents)`,
    "",
  ];
  for (const opt of results.options) {
    lines.push(`${opt.label}: ${String(opt.count)} votes (${String(opt.percentage)}%)`);
    if (opt.respondents.length > 0) {
      for (const resp of opt.respondents) {
        const vp = resp.voicePart ? ` (${resp.voicePart})` : "";
        lines.push(`  • ${resp.profileName}${vp}`);
      }
    } else {
      lines.push("  • (No respondents)");
    }
    lines.push("");
  }
  void navigator.clipboard.writeText(lines.join("\n")).then(() => {
    onCopied("Summary copied to clipboard!");
  });
}

function PollOptionResultsList({
  options,
}: {
  readonly options: readonly OrganizationPollResultOption[];
}) {
  return (
    <div className="poll-options-results-list">
      {options.map((opt) => (
        <div key={opt.id} className="poll-option-result-card">
          <div className="poll-option-result-header">
            <span className="poll-option-result-title">{opt.label}</span>
            <span className="poll-option-result-stats">
              {String(opt.count)} {opt.count === 1 ? "vote" : "votes"} ({String(opt.percentage)}%)
            </span>
          </div>
          <div className="poll-progress-track">
            <div
              className="poll-progress-fill"
              style={{ width: `${String(Math.max(0, Math.min(100, opt.percentage)))}%` }}
            />
          </div>

          <div className="poll-respondents-section">
            <div className="poll-respondents-heading">
              Respondents ({String(opt.respondents.length)})
            </div>
            {opt.respondents.length === 0 ? (
              <p className="poll-respondents-empty">No respondents selected this option.</p>
            ) : (
              <ul className="poll-respondents-list">
                {opt.respondents.map((resp) => (
                  <li key={resp.profileId} className="poll-respondent-item">
                    <div className="poll-respondent-identity">
                      <span className="poll-respondent-name">{resp.profileName}</span>
                      {resp.voicePart ? (
                        <span className="poll-respondent-voice-part">{resp.voicePart}</span>
                      ) : null}
                    </div>
                    <time className="poll-respondent-time" title={resp.respondedAt}>
                      {formatSubmissionDate(resp.respondedAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PollResultsBody({
  archiving,
  confirmingArchive,
  copyFeedback,
  onArchive,
  onClose,
  onCopyFeedback,
  onRequestArchive,
  renderArchiveConfirmation,
  resultsData,
}: {
  readonly archiving: boolean;
  readonly confirmingArchive: boolean;
  readonly copyFeedback: string | null;
  readonly onArchive?: ((pollId: string) => Promise<void>) | undefined;
  readonly onClose: () => void;
  readonly onCopyFeedback: (msg: string | null) => void;
  readonly onRequestArchive: () => void;
  readonly renderArchiveConfirmation: () => ReactNode;
  readonly resultsData: OrganizationPollResultsResponse;
}) {
  const canArchive = Boolean(!resultsData.archivedAt && onArchive && !confirmingArchive);
  return (
    <div className="poll-results-container">
      {resultsData.description ? (
        <p className="notice notice--info">{resultsData.description}</p>
      ) : null}

      <div className="poll-results-header">
        <div className="poll-results-meta">
          <span>{resultsData.multipleChoice ? "Multiple choice" : "Single choice"}</span>
          {resultsData.archivedAt ? <span className="badge badge--warning">Archived</span> : null}
        </div>
        <div className="poll-results-actions">
          <button
            className="button button--secondary button--small"
            onClick={() => {
              copyRespondentSummary(resultsData, (msg) => {
                onCopyFeedback(msg);
                setTimeout(() => {
                  onCopyFeedback(null);
                }, 3000);
              });
            }}
            type="button"
          >
            {copyFeedback ?? "Copy summary"}
          </button>
          <button
            className="button button--secondary button--small"
            onClick={() => {
              exportResultsCsv(resultsData);
            }}
            type="button"
          >
            Export CSV
          </button>
          {canArchive ? (
            <button
              className="button button--secondary button--small"
              disabled={archiving}
              onClick={onRequestArchive}
              type="button"
            >
              Archive poll
            </button>
          ) : null}
        </div>
      </div>

      {confirmingArchive && onArchive ? renderArchiveConfirmation() : null}

      {resultsData.totalResponses === 0 ? (
        <p className="notice">
          No responses have been submitted yet. Use <strong>Share with members</strong> to
          distribute voting links.
        </p>
      ) : (
        <PollOptionResultsList options={resultsData.options} />
      )}

      <div className="dialog__actions">
        <button className="button button--secondary" onClick={onClose} type="button">
          Close
        </button>
      </div>
    </div>
  );
}

export function PollResultsDialog({
  archiving = false,
  copyFeedback,
  onArchive,
  onClose,
  onCopyFeedback,
  open,
  renderArchiveConfirmation,
  resultsData,
  resultsError,
  resultsLoading,
}: {
  readonly archiving?: boolean | undefined;
  readonly copyFeedback: string | null;
  readonly onArchive?: ((pollId: string) => Promise<void>) | undefined;
  readonly onClose: () => void;
  readonly onCopyFeedback: (msg: string | null) => void;
  readonly open: boolean;
  readonly renderArchiveConfirmation: (callbacks: {
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
  }) => ReactNode;
  readonly resultsData: OrganizationPollResultsResponse | null;
  readonly resultsError: string | null;
  readonly resultsLoading: boolean;
}) {
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const descriptionText = resultsData
    ? `${String(resultsData.totalResponses)} ${resultsData.totalResponses === 1 ? "response" : "responses"} recorded • Expires: ${formatExpiry(resultsData.expiresAt)}`
    : "Review voter responses and option totals.";

  function handleClose(): void {
    setConfirmingArchive(false);
    onClose();
  }

  return (
    <Dialog
      description={descriptionText}
      onClose={handleClose}
      open={open}
      title={resultsData ? `Results: ${resultsData.title}` : "Poll results"}
    >
      {resultsLoading ? (
        <p className="notice">Loading results…</p>
      ) : resultsError ? (
        <p className="notice notice--error" role="alert">
          {resultsError}
        </p>
      ) : resultsData ? (
        <PollResultsBody
          archiving={archiving}
          confirmingArchive={confirmingArchive}
          copyFeedback={copyFeedback}
          onArchive={onArchive}
          onClose={onClose}
          onCopyFeedback={onCopyFeedback}
          onRequestArchive={() => {
            setConfirmingArchive(true);
          }}
          renderArchiveConfirmation={() =>
            renderArchiveConfirmation({
              onCancel: () => {
                setConfirmingArchive(false);
              },
              onConfirm: () => {
                void onArchive?.(resultsData.pollId).then(() => {
                  setConfirmingArchive(false);
                });
              },
            })
          }
          resultsData={resultsData}
        />
      ) : null}
    </Dialog>
  );
}
