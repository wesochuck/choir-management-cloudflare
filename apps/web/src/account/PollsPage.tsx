import {
  organizationPollRequestSchema,
  organizationPollSchema,
  organizationPollSummariesResponseSchema,
  type OrganizationPollSummary,
} from "@choir/contracts";
import { DataTable, Dialog } from "@choir/ui";
import { useEffect, useState, type SyntheticEvent } from "react";

import { saveOrganizationCommunicationDraft } from "../auth/api";
type Poll = OrganizationPollSummary;
type PollState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly polls: readonly Poll[]; readonly status: "ready" };

export function PollsPage({ enabled }: { readonly enabled: boolean }) {
  const [state, setState] = useState<PollState>({ status: "loading" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState(["Yes", "No"]);
  const [saving, setSaving] = useState(false);
  const [sharingPollId, setSharingPollId] = useState<string | null>(null);
  const [communicationsDraftId, setCommunicationsDraftId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/organization/polls", {
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
  }, [enabled]);

  async function createPoll(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const id = crypto.randomUUID();
    const request = organizationPollRequestSchema.safeParse({
      description,
      options: options
        .map((label) => ({ id: crypto.randomUUID(), label: label.trim(), sortOrder: 0 }))
        .filter((option) => option.label),
      title,
    });
    if (!request.success) {
      setSaving(false);
      setMessage("Add a title and at least two poll options.");
      return;
    }
    try {
      const response = await fetch("/api/organization/polls", {
        body: JSON.stringify({ ...request.data, id }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Poll could not be created");
      const created = organizationPollSchema.parse(await response.json());
      setState((current) =>
        current.status === "ready"
          ? {
              polls: [
                {
                  archivedAt: created.archivedAt,
                  createdAt: created.createdAt,
                  expiresAt: created.expiresAt,
                  id: created.id,
                  responseCount: 0,
                  title: created.title,
                },
                ...current.polls,
              ],
              status: "ready",
            }
          : current,
      );
      setTitle("");
      setDescription("");
      setOptions(["Yes", "No"]);
      setDialogOpen(false);
      setMessage("Poll created.");
    } catch {
      setMessage("The poll could not be created. Try again.");
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
      <div className="page-toolbar page-toolbar--end">
        <button
          className="button button--primary"
          onClick={() => {
            setDialogOpen(true);
          }}
          type="button"
        >
          Create poll
        </button>
      </div>
      {message ? (
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
            render: (poll: Poll) => poll.expiresAt || "No expiry",
          },
          {
            header: "Sharing",
            id: "sharing",
            render: (poll: Poll) => (
              <button
                disabled={sharingPollId === poll.id}
                onClick={() => {
                  void sharePoll(poll);
                }}
                type="button"
              >
                {sharingPollId === poll.id ? "Preparing…" : "Share with members"}
              </button>
            ),
          },
        ]}
        emptyMessage="No polls yet. Create the first poll for your Organization."
        keySelector={(poll) => poll.id}
        rows={state.polls}
      />
      <Dialog
        description="Ask a focused question with two or more response options."
        onClose={() => {
          setDialogOpen(false);
        }}
        open={dialogOpen}
        title="Create poll"
      >
        <form
          className="stack-form"
          onSubmit={(event) => {
            void createPoll(event);
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
            <button
              className="button button--secondary"
              onClick={() => {
                setDialogOpen(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button className="button button--primary" disabled={saving} type="submit">
              {saving ? "Creating…" : "Create poll"}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
