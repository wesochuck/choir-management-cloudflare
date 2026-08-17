import {
  organizationPollRequestSchema,
  organizationPollSchema,
  organizationPollSummariesResponseSchema,
  type OrganizationPoll,
  type OrganizationPollSummary,
} from "@choir/contracts";
import { defaultPollExpirationAt } from "@choir/domain";
import { DataTable, Dialog, DialogClose } from "@choir/ui";
import { useEffect, useState, type SyntheticEvent } from "react";

import { saveOrganizationCommunicationDraft } from "../auth/api";
type Poll = OrganizationPollSummary;
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

export function PollsPage({ enabled }: { readonly enabled: boolean }) {
  const [state, setState] = useState<PollState>({ status: "loading" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPollId, setEditingPollId] = useState<string | null>(null);
  const [loadingPollId, setLoadingPollId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [archivedAt, setArchivedAt] = useState("");
  const [multipleChoice, setMultipleChoice] = useState(false);
  const [options, setOptions] = useState(["Yes", "No"]);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [sharingPollId, setSharingPollId] = useState<string | null>(null);
  const [communicationsDraftId, setCommunicationsDraftId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const endpoint = showArchived
      ? "/api/organization/polls?archived=true"
      : "/api/organization/polls";
    fetch(endpoint, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Polls unavailable");
        const parsed = organizationPollSummariesResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Poll response invalid");
        setState({ polls: parsed.data.polls, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => {
      controller.abort();
    };
  }, [enabled, showArchived]);

  function openCreateDialog(): void {
    setEditingPollId(null);
    setTitle("");
    setDescription("");
    setExpiresAt(defaultExpirationDateTimeLocal());
    setArchivedAt("");
    setMultipleChoice(false);
    setOptions(["Yes", "No"]);
    setOptionIds([crypto.randomUUID(), crypto.randomUUID()]);
    setMessage(null);
    setDialogError(null);
    setDialogOpen(true);
  }

  async function openEditDialog(poll: Poll): Promise<void> {
    setLoadingPollId(poll.id);
    setMessage(null);
    setDialogError(null);
    try {
      const response = await fetch(`/api/organization/polls/${encodeURIComponent(poll.id)}`, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Poll details unavailable");
      const details: OrganizationPoll = organizationPollSchema.parse(await response.json());
      setEditingPollId(details.id);
      setTitle(details.title);
      setDescription(details.description);
      setExpiresAt(toDateTimeLocal(details.expiresAt));
      setArchivedAt(details.archivedAt);
      setMultipleChoice(details.multipleChoice);
      setOptionIds(details.options.map(({ id }) => id));
      setOptions(
        details.options
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(({ label }) => label),
      );
      setDialogOpen(true);
    } catch {
      setMessage("The poll could not be loaded for editing. Try again.");
    } finally {
      setLoadingPollId(null);
    }
  }

  async function savePoll(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setDialogError(null);
    const request = organizationPollRequestSchema.safeParse({
      archivedAt,
      description,
      expiresAt: toIsoDateTime(expiresAt),
      multipleChoice,
      options: options
        .map((label, index) => ({
          id: optionIds[index] ?? crypto.randomUUID(),
          label: label.trim(),
          sortOrder: index,
        }))
        .filter((option) => option.label),
      title,
    });
    if (!request.success) {
      setSaving(false);
      setDialogError("Add a title, expiration date, and at least two poll options.");
      return;
    }
    try {
      const editing = editingPollId !== null;
      const response = await fetch(
        editing
          ? `/api/organization/polls/${encodeURIComponent(editingPollId)}`
          : "/api/organization/polls",
        {
          body: JSON.stringify(
            editing ? request.data : { ...request.data, id: crypto.randomUUID() },
          ),
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: editing ? "PUT" : "POST",
        },
      );
      if (!response.ok)
        throw new Error(editing ? "Poll could not be updated" : "Poll could not be created");
      const saved = organizationPollSchema.parse(await response.json());
      setState((current) =>
        current.status === "ready"
          ? {
              polls: editing
                ? current.polls.map((poll) =>
                    poll.id === saved.id
                      ? {
                          ...poll,
                          archivedAt: saved.archivedAt,
                          expiresAt: saved.expiresAt,
                          title: saved.title,
                        }
                      : poll,
                  )
                : showArchived
                  ? current.polls
                  : [
                      {
                        archivedAt: saved.archivedAt,
                        createdAt: saved.createdAt,
                        expiresAt: saved.expiresAt,
                        id: saved.id,
                        responseCount: 0,
                        title: saved.title,
                      },
                      ...current.polls,
                    ],
              status: "ready",
            }
          : current,
      );
      setTitle("");
      setDescription("");
      setExpiresAt("");
      setArchivedAt("");
      setMultipleChoice(false);
      setOptions(["Yes", "No"]);
      setOptionIds([]);
      setDialogOpen(false);
      setMessage(editingPollId ? "Poll updated." : "Poll created.");
      setEditingPollId(null);
    } catch {
      setDialogError(
        editingPollId
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
          eventId: null,
          globalStatuses: ["Active", "Idle"],
          profileIds: [],
          rsvp: "All",
          targetAudiences: ["Members"],
          voiceParts: [],
        },
        channel: "Email",
        contentMarkdown: `Hi {singerName},\n\nPlease share your response:\n{{POLL_LINK:${poll.id}}}\n\nThank you!`,
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
              setState({ status: "loading" });
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
          { header: "Responses", id: "responses", render: (poll: Poll) => poll.responseCount },
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
          void openEditDialog(poll);
        }}
        rowLabel={(poll) => `Edit poll ${poll.title}`}
        rows={state.polls}
      />
      <Dialog
        description="Ask a focused question with two or more response options."
        onClose={() => {
          if (!saving) setDialogOpen(false);
        }}
        open={dialogOpen}
        title={editingPollId ? "Edit poll" : "Create poll"}
      >
        {dialogError ? (
          <p className="notice notice--error" role="alert">
            {dialogError}
          </p>
        ) : null}
        <form
          className="stack-form"
          onSubmit={(event) => {
            void savePoll(event);
          }}
        >
          <label>
            Title
            <input
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              required
              value={title}
            />
          </label>
          <label>
            Description
            <textarea
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              value={description}
            />
          </label>
          <label>
            Expiration date and time
            <input
              onChange={(event) => {
                setExpiresAt(event.target.value);
              }}
              required
              type="datetime-local"
              value={expiresAt}
            />
            <span className="field-help">
              Responses will no longer be accepted after this time.
            </span>
          </label>
          <fieldset>
            <legend>Options</legend>
            {options.map((option, index) => (
              <label key={index}>
                Option {index + 1}
                <input
                  onChange={(event) => {
                    setOptions((current) =>
                      current.map((value, optionIndex) =>
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
              <button className="button button--secondary" type="button">
                Cancel
              </button>
            </DialogClose>
            <button className="button button--primary" disabled={saving} type="submit">
              {saving ? "Saving…" : editingPollId ? "Save changes" : "Create poll"}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
