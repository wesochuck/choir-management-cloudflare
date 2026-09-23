import {
  organizationPollRequestSchema,
  type OrganizationPollResultsResponse,
  type OrganizationPollSummary,
} from "@choir/contracts";
import { defaultPollExpirationAt } from "@choir/domain";
import { DataTable, Dialog, DialogClose } from "@choir/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";

import {
  createOrganizationPoll,
  getOrganizationPoll,
  getOrganizationPollResults,
  listOrganizationPolls,
  queryKeys,
  saveOrganizationCommunicationDraft,
  updateOrganizationPoll,
} from "../api";

type Poll = OrganizationPollSummary;

interface PollFormData {
  readonly archivedAt: string;
  readonly description: string;
  readonly editingPollHasResponses: boolean;
  readonly editingPollId: string | null;
  readonly expiresAt: string;
  readonly multipleChoice: boolean;
  readonly optionIds: readonly string[];
  readonly options: readonly string[];
  readonly title: string;
}

const defaultInitialPollFormData: PollFormData = {
  archivedAt: "",
  description: "",
  editingPollHasResponses: false,
  editingPollId: null,
  expiresAt: "",
  multipleChoice: false,
  optionIds: [],
  options: ["Yes", "No"],
  title: "",
};
type PollState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly polls: readonly Poll[]; readonly status: "ready" };

function toDateTimeLocal(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function toIsoDateTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function defaultExpirationDateTimeLocal(): string {
  return toDateTimeLocal(defaultPollExpirationAt(new Date()));
}

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
  const rows = [
    [
      "Poll Title",
      "Option",
      "Votes",
      "Percentage",
      "Respondent Name",
      "Voice Part",
      "Responded At",
    ],
  ];
  for (const opt of results.options) {
    if (opt.respondents.length === 0) {
      rows.push([
        results.title,
        opt.label,
        String(opt.count),
        `${String(opt.percentage)}%`,
        "",
        "",
        "",
      ]);
    } else {
      for (const resp of opt.respondents) {
        rows.push([
          results.title,
          opt.label,
          String(opt.count),
          `${String(opt.percentage)}%`,
          resp.profileName,
          resp.voicePart,
          resp.respondedAt,
        ]);
      }
    }
  }
  const csvContent = rows
    .map((row) => row.map((field) => `"${field.replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeTitle = results.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  link.setAttribute("href", url);
  link.setAttribute("download", `poll-results-${safeTitle || "export"}.csv`);
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

function PollResultsDialog({
  copyFeedback,
  onClose,
  onCopyFeedback,
  open,
  resultsData,
  resultsError,
  resultsLoading,
}: {
  readonly copyFeedback: string | null;
  readonly onClose: () => void;
  readonly onCopyFeedback: (msg: string | null) => void;
  readonly open: boolean;
  readonly resultsData: OrganizationPollResultsResponse | null;
  readonly resultsError: string | null;
  readonly resultsLoading: boolean;
}) {
  const descriptionText = resultsData
    ? `${String(resultsData.totalResponses)} ${resultsData.totalResponses === 1 ? "response" : "responses"} recorded • Expires: ${formatExpiry(resultsData.expiresAt)}`
    : "Review voter responses and option totals.";

  return (
    <Dialog
      description={descriptionText}
      onClose={onClose}
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
        <div className="poll-results-container">
          {resultsData.description ? (
            <p className="notice notice--info">{resultsData.description}</p>
          ) : null}

          <div className="poll-results-header">
            <div className="poll-results-meta">
              <span>{resultsData.multipleChoice ? "Multiple choice" : "Single choice"}</span>
              {resultsData.archivedAt ? (
                <span className="badge badge--warning">Archived</span>
              ) : null}
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
            </div>
          </div>

          {resultsData.totalResponses === 0 ? (
            <p className="notice">
              No responses have been submitted yet. Use <strong>Share with members</strong> to
              distribute voting links.
            </p>
          ) : (
            <div className="poll-options-results-list">
              {resultsData.options.map((opt) => (
                <div key={opt.id} className="poll-option-result-card">
                  <div className="poll-option-result-header">
                    <span className="poll-option-result-title">{opt.label}</span>
                    <span className="poll-option-result-stats">
                      {String(opt.count)} {opt.count === 1 ? "vote" : "votes"} (
                      {String(opt.percentage)}%)
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
          )}

          <div className="dialog__actions">
            <button className="button button--secondary" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function PollEditDialog({
  description,
  editingPollHasResponses,
  editingPollId,
  error,
  expiresAt,
  onClose,
  onDescriptionChange,
  onExpiresAtChange,
  onOptionsChange,
  onSave,
  onTitleChange,
  open,
  options,
  saving,
  title,
}: {
  readonly description: string;
  readonly editingPollHasResponses: boolean;
  readonly editingPollId: string | null;
  readonly error?: string | null;
  readonly expiresAt: string;
  readonly onClose: () => void;
  readonly onDescriptionChange: (val: string) => void;
  readonly onExpiresAtChange: (val: string) => void;
  readonly onOptionsChange: (val: string[]) => void;
  readonly onSave: (event: SyntheticEvent<HTMLFormElement>) => void;
  readonly onTitleChange: (val: string) => void;
  readonly open: boolean;
  readonly options: string[];
  readonly saving: boolean;
  readonly title: string;
}) {
  return (
    <Dialog
      description="Ask a focused question with two or more response options."
      onClose={onClose}
      open={open}
      title={editingPollId ? "Edit poll" : "Create poll"}
    >
      <form className="stack-form" onSubmit={onSave}>
        {error ? (
          <p className="notice notice--error" id="poll-dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        {editingPollHasResponses ? (
          <p className="notice notice--info">
            This poll has received responses. Option structure is locked to protect response
            integrity. You can still update the title, description, and expiration date.
          </p>
        ) : null}
        <label>
          Title
          <input
            aria-describedby={error ? "poll-dialog-error" : undefined}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              onTitleChange(event.target.value);
            }}
            required
            value={title}
          />
        </label>
        <label>
          Description
          <textarea
            aria-describedby={error ? "poll-dialog-error" : undefined}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              onDescriptionChange(event.target.value);
            }}
            value={description}
          />
        </label>
        <label>
          Expiration date and time
          <input
            aria-describedby={error ? "poll-dialog-error" : undefined}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              onExpiresAtChange(event.target.value);
            }}
            required
            type="datetime-local"
            value={expiresAt}
          />
          <span className="field-help">Responses will no longer be accepted after this time.</span>
        </label>
        <fieldset>
          <legend>Options</legend>
          {options.map((option, index) => (
            <label key={index}>
              Option {String(index + 1)}
              <input
                aria-describedby={error ? "poll-dialog-error" : undefined}
                aria-invalid={Boolean(error)}
                disabled={editingPollHasResponses}
                onChange={(event) => {
                  onOptionsChange(
                    options.map((value, optionIndex) =>
                      optionIndex === index ? event.target.value : value,
                    ),
                  );
                }}
                required
                value={option}
              />
            </label>
          ))}
        </fieldset>
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" disabled={saving} type="button">
              Cancel
            </button>
          </DialogClose>
          <button
            aria-busy={saving}
            className="button button--primary"
            disabled={saving}
            type="submit"
          >
            {saving ? "Saving…" : editingPollId ? "Save changes" : "Create poll"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function PollsPage({ enabled }: { readonly enabled: boolean }) {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);

  const {
    data: polls = [],
    isLoading,
    isError,
  } = useQuery({
    enabled,
    queryFn: ({ signal }) => listOrganizationPolls(showArchived, signal),
    queryKey: queryKeys.organization.polls(showArchived),
  });

  const state: PollState = isError
    ? { status: "error" }
    : isLoading
      ? { status: "loading" }
      : { polls, status: "ready" };

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [formData, setFormData] = useState<PollFormData>(defaultInitialPollFormData);
  const [loadingPollId, setLoadingPollId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sharingPollId, setSharingPollId] = useState<string | null>(null);
  const [communicationsDraftId, setCommunicationsDraftId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Results state
  const [resultsDialogOpen, setResultsDialogOpen] = useState(false);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsData, setResultsData] = useState<OrganizationPollResultsResponse | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  function openCreateDialog(): void {
    setFormData({
      archivedAt: "",
      description: "",
      editingPollHasResponses: false,
      editingPollId: null,
      expiresAt: defaultExpirationDateTimeLocal(),
      multipleChoice: false,
      optionIds: [crypto.randomUUID(), crypto.randomUUID()],
      options: ["Yes", "No"],
      title: "",
    });
    setDialogError(null);
    setMessage(null);
    setDialogOpen(true);
  }

  async function openEditDialog(poll: Poll): Promise<void> {
    setLoadingPollId(poll.id);
    setDialogError(null);
    setMessage(null);
    try {
      const details = await getOrganizationPoll(poll.id);
      setFormData({
        archivedAt: details.archivedAt,
        description: details.description,
        editingPollHasResponses: poll.responseCount > 0,
        editingPollId: details.id,
        expiresAt: toDateTimeLocal(details.expiresAt),
        multipleChoice: details.multipleChoice,
        optionIds: details.options.map(({ id }) => id),
        options: details.options
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(({ label }) => label),
        title: details.title,
      });
      setDialogOpen(true);
    } catch {
      setMessage("The poll could not be loaded for editing. Try again.");
    } finally {
      setLoadingPollId(null);
    }
  }

  async function openResultsDialog(poll: Poll): Promise<void> {
    setResultsDialogOpen(true);
    setResultsLoading(true);
    setResultsError(null);
    setResultsData(null);
    setCopyFeedback(null);
    try {
      const data = await getOrganizationPollResults(poll.id);
      setResultsData(data);
    } catch {
      setResultsError("The poll results could not be loaded. Try again.");
    } finally {
      setResultsLoading(false);
    }
  }

  async function savePoll(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setDialogError(null);
    setMessage(null);
    const request = organizationPollRequestSchema.safeParse({
      archivedAt: formData.archivedAt || undefined,
      description: formData.description,
      expiresAt: toIsoDateTime(formData.expiresAt),
      multipleChoice: formData.multipleChoice,
      options: formData.options
        .map((label, index) => ({
          id: formData.optionIds[index] ?? crypto.randomUUID(),
          label: label.trim(),
          sortOrder: index,
        }))
        .filter((option) => option.label),
      title: formData.title,
    });
    if (!request.success) {
      setSaving(false);
      setDialogError("Add a title, expiration date, and at least two poll options.");
      return;
    }
    try {
      const editing = formData.editingPollId !== null;
      if (editing) {
        await updateOrganizationPoll(formData.editingPollId, request.data);
      } else {
        await createOrganizationPoll({ ...request.data, id: crypto.randomUUID() });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.organization.polls(showArchived) });
      setFormData(defaultInitialPollFormData);
      setDialogError(null);
      setDialogOpen(false);
      setMessage(editing ? "Poll updated." : "Poll created.");
    } catch {
      setDialogError(
        formData.editingPollId
          ? "The poll could not be updated. Try again."
          : "The poll could not be created. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function sharePoll(poll: Poll) {
    setSharingPollId(poll.id);
    setCommunicationsDraftId(null);
    setMessage(null);
    try {
      const draft = await saveOrganizationCommunicationDraft({
        audience: {
          contactEmailStatus: null,
          contactIds: [],
          contactListIds: [],
          contactSmsStatus: null,
          contactSource: null,
          eventId: null,
          globalStatuses: ["Active", "Idle"],
          profileIds: [],
          rsvp: "All",
          targetAudiences: ["Members"],
          ticketBuyerMode: "marketing",
          voiceParts: [],
        },
        channel: "Email",
        contentMarkdown: `Hi {singerName},\n\nPlease respond to this poll:\n\nPoll: ${poll.title}\n\n{{POLL_LINK:${poll.id}}}\n\nThank you!`,
        subject: `Poll: ${poll.title}`,
      });
      setCommunicationsDraftId(draft.id);
      setMessage(
        "A personalized email draft is ready. Review it in Communications before sending; each member will receive a private poll link.",
      );
    } catch {
      setMessage("The poll could not be prepared for sharing. Try again.");
    } finally {
      setSharingPollId(null);
    }
  }

  if (!enabled) {
    return (
      <p className="notice notice--warning">
        Polls are unavailable until Organization access is verified.
      </p>
    );
  }
  if (state.status === "loading") return <p className="notice">Loading polls…</p>;
  if (state.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Polls could not be loaded. Refresh and try again.
      </p>
    );
  }
  return (
    <section className="manager-page" aria-label="Poll management">
      <div className="page-toolbar">
        <label className="checkbox-row" htmlFor="polls-show-archived">
          <input
            checked={showArchived}
            id="polls-show-archived"
            onChange={(event) => {
              setShowArchived(event.target.checked);
            }}
            type="checkbox"
          />
          Show archived polls
        </label>
        <button className="button button--primary" onClick={openCreateDialog} type="button">
          Create poll
        </button>
      </div>
      {message && !dialogOpen ? (
        <p className="notice notice--success" role="status">
          {message}
          {communicationsDraftId ? (
            <>
              {" "}
              <a
                href={`/admin/communications?draftId=${encodeURIComponent(communicationsDraftId)}`}
              >
                Open the draft in Communications
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <p className="notice notice--info">
        Polls are shared through email. Choose <strong>Share with members</strong> to create a draft
        for active and on-break members. Nothing is sent until you review and queue it in
        Communications; the link is personalized so each member can respond once.
      </p>
      <DataTable
        columns={[
          { header: "Title", id: "title", render: (poll: Poll) => poll.title },
          {
            header: "Responses",
            id: "responses",
            render: (poll: Poll) => (
              <div className="poll-table-responses">
                <strong>
                  {String(poll.responseCount)} {poll.responseCount === 1 ? "response" : "responses"}
                </strong>
                {poll.optionTallies.length > 0 && poll.responseCount > 0 ? (
                  <div className="poll-table-tallies">
                    {poll.optionTallies.map((tally) => (
                      <span key={tally.id} className="poll-table-tally-pill">
                        <span>{tally.label}:</span>
                        <strong>{String(tally.count)}</strong>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ),
          },
          {
            header: "Expires",
            id: "expires",
            render: (poll: Poll) => formatExpiry(poll.expiresAt),
          },
          {
            header: "Actions",
            id: "actions",
            mobileLabel: "Manage",
            render: (poll: Poll) => (
              <div className="table-actions">
                <button
                  className="button button--secondary button--small"
                  onClick={() => {
                    void openResultsDialog(poll);
                  }}
                  type="button"
                >
                  View results
                </button>
                <button
                  className="button button--secondary button--small"
                  disabled={sharingPollId === poll.id}
                  onClick={() => {
                    void sharePoll(poll);
                  }}
                  type="button"
                >
                  {sharingPollId === poll.id ? "Preparing…" : "Share with members"}
                </button>
                <button
                  disabled={loadingPollId === poll.id}
                  onClick={() => {
                    void openEditDialog(poll);
                  }}
                  type="button"
                >
                  {loadingPollId === poll.id ? "Loading…" : "Edit"}
                </button>
              </div>
            ),
          },
        ]}
        emptyMessage={
          showArchived
            ? "No archived polls yet. Polls are archived two days after they expire."
            : "No polls yet. Create the first poll for your Organization."
        }
        keySelector={(poll) => poll.id}
        onRowClick={(poll) => {
          void openResultsDialog(poll);
        }}
        rowLabel={(poll) => `View results for poll ${poll.title}`}
        rows={state.polls}
      />

      <PollResultsDialog
        copyFeedback={copyFeedback}
        onClose={() => {
          setResultsDialogOpen(false);
        }}
        onCopyFeedback={(msg) => {
          setCopyFeedback(msg);
        }}
        open={resultsDialogOpen}
        resultsData={resultsData}
        resultsError={resultsError}
        resultsLoading={resultsLoading}
      />

      <PollEditDialog
        description={formData.description}
        editingPollHasResponses={formData.editingPollHasResponses}
        editingPollId={formData.editingPollId}
        error={dialogError}
        expiresAt={formData.expiresAt}
        onClose={() => {
          setDialogOpen(false);
        }}
        onDescriptionChange={(description) => {
          setFormData((prev) => ({ ...prev, description }));
        }}
        onExpiresAtChange={(expiresAt) => {
          setFormData((prev) => ({ ...prev, expiresAt }));
        }}
        onOptionsChange={(options) => {
          setFormData((prev) => ({ ...prev, options }));
        }}
        onSave={(event) => {
          void savePoll(event);
        }}
        onTitleChange={(title) => {
          setFormData((prev) => ({ ...prev, title }));
        }}
        open={dialogOpen}
        options={[...formData.options]}
        saving={saving}
        title={formData.title}
      />
    </section>
  );
}
