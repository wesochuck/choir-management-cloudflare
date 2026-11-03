import {
  organizationPollRequestSchema,
  type OrganizationPollResultsResponse,
  type OrganizationPollSummary,
} from "@choir/contracts";
import { defaultPollExpirationAt } from "@choir/domain";
import { DataTable } from "@choir/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";

import {
  archiveOrganizationPoll,
  createOrganizationPoll,
  getOrganizationPoll,
  getOrganizationPollResults,
  listOrganizationPolls,
  queryKeys,
  saveOrganizationCommunicationDraft,
  updateOrganizationPoll,
} from "../api";
import { PollEditDialog } from "./components/PollsPage/PollEditDialog";
import { PollResultsDialog } from "./components/PollsPage/PollResultsDialog";

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

function PollArchiveConfirmation({
  archiving,
  onCancel,
  onConfirm,
}: {
  readonly archiving: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div className="danger-confirmation" role="group" aria-label="Confirm archiving poll">
      <p>Archive this poll? Voting will close immediately while preserving all responses.</p>
      <div className="form-actions">
        <button
          className="button button--secondary button--small"
          disabled={archiving}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="button button--danger button--small"
          disabled={archiving}
          onClick={onConfirm}
          type="button"
        >
          {archiving ? "Archiving…" : "Confirm archive"}
        </button>
      </div>
    </div>
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
  const [archivingPollId, setArchivingPollId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
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
      setDialogError("Add a title, expiration date, and exactly two poll options.");
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
        contentMarkdown: `Hi {recipientName},\n\nPlease respond to this poll:\n\nPoll: ${poll.title}\n\n{{POLL_LINK:${poll.id}}}\n\nThank you!`,
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

  async function handleArchivePoll(pollId: string): Promise<void> {
    setArchiving(true);
    setMessage(null);
    try {
      const result = await archiveOrganizationPoll(pollId);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.organization.polls(showArchived),
      });
      setArchivingPollId(null);
      setMessage("Poll archived.");
      if (resultsData?.pollId === pollId) {
        setResultsData({ ...resultsData, archivedAt: result.archivedAt });
      }
    } catch {
      setMessage("The poll could not be archived. Try again.");
    } finally {
      setArchiving(false);
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
            render: (poll: Poll) =>
              archivingPollId === poll.id ? (
                <div
                  className="danger-confirmation"
                  role="group"
                  aria-label={`Confirm archiving ${poll.title}`}
                >
                  <p>Archive this poll?</p>
                  <div className="form-actions">
                    <button
                      className="button button--secondary button--small"
                      disabled={archiving}
                      onClick={(event) => {
                        event.stopPropagation();
                        setArchivingPollId(null);
                      }}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      className="button button--danger button--small"
                      disabled={archiving}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleArchivePoll(poll.id);
                      }}
                      type="button"
                    >
                      {archiving ? "Archiving…" : "Confirm archive"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="table-actions">
                  <button
                    className="button button--secondary button--small"
                    onClick={(event) => {
                      event.stopPropagation();
                      void openResultsDialog(poll);
                    }}
                    type="button"
                  >
                    View results
                  </button>
                  {!poll.archivedAt ? (
                    <>
                      <button
                        className="button button--secondary button--small"
                        disabled={sharingPollId === poll.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void sharePoll(poll);
                        }}
                        type="button"
                      >
                        {sharingPollId === poll.id ? "Preparing…" : "Share with members"}
                      </button>
                      <button
                        className="button button--secondary button--small"
                        disabled={loadingPollId === poll.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void openEditDialog(poll);
                        }}
                        type="button"
                      >
                        {loadingPollId === poll.id ? "Loading…" : "Edit"}
                      </button>
                      <button
                        className="button button--secondary button--small"
                        onClick={(event) => {
                          event.stopPropagation();
                          setArchivingPollId(poll.id);
                        }}
                        type="button"
                      >
                        Archive
                      </button>
                    </>
                  ) : (
                    <span className="badge badge--warning">Archived</span>
                  )}
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
        archiving={archiving}
        copyFeedback={copyFeedback}
        onArchive={handleArchivePoll}
        onClose={() => {
          setResultsDialogOpen(false);
        }}
        onCopyFeedback={(msg) => {
          setCopyFeedback(msg);
        }}
        open={resultsDialogOpen}
        renderArchiveConfirmation={({ onCancel, onConfirm }) => (
          <PollArchiveConfirmation
            archiving={archiving}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        )}
        resultsData={resultsData}
        resultsError={resultsError}
        resultsLoading={resultsLoading}
      />

      <PollEditDialog
        archivedAt={formData.archivedAt}
        archiving={archiving}
        description={formData.description}
        editingPollHasResponses={formData.editingPollHasResponses}
        editingPollId={formData.editingPollId}
        error={dialogError}
        expiresAt={formData.expiresAt}
        onArchive={handleArchivePoll}
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
        renderArchiveConfirmation={({ onCancel, onConfirm }) => (
          <PollArchiveConfirmation
            archiving={archiving}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        )}
        saving={saving}
        title={formData.title}
      />
    </section>
  );
}
