import { useEffect, useState } from "react";

import type { AuditionStatus, OrganizationAudition } from "@choir/contracts";
import { auditionStatusSchema } from "@choir/contracts";

import {
  generateAuditionTokens,
  listOrganizationAuditions,
  updateOrganizationAudition,
} from "../auth/api";

interface Props {
  readonly enabled: boolean;
}

type ManagerState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly auditions: readonly OrganizationAudition[] };

const STATUS_LABELS: Record<AuditionStatus, string> = {
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No Show",
  pending: "Pending Review",
  scheduled: "Scheduled",
};

const STATUS_OPTIONS: readonly { readonly label: string; readonly value: AuditionStatus }[] = [
  { label: "Pending Review", value: "pending" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
  { label: "No Show", value: "no_show" },
];

function EditAuditionForm({
  auditionId,
  currentStatus,
  currentNotes,
  onSave,
  onCancel,
  message,
}: {
  readonly auditionId: string;
  readonly currentStatus: AuditionStatus;
  readonly currentNotes: string;
  readonly onSave: (id: string, status: AuditionStatus, notes: string) => void;
  readonly onCancel: () => void;
  readonly message: string | null;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [notes, setNotes] = useState(currentNotes);

  return (
    <article className="compact-card mt-4">
      <h3>Edit Audition</h3>
      {message && (
        <p
          className={`notice ${message.includes("updated") ? "notice--success" : "notice--error"}`}
          role="status"
        >
          {message}
        </p>
      )}
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(auditionId, status, notes);
        }}
      >
        <div>
          <label className="block text-sm font-medium" htmlFor="edit-status">
            Status
          </label>
          <select
            className="mt-1 w-full rounded border p-2"
            id="edit-status"
            onChange={(e) => {
              const parsed = auditionStatusSchema.safeParse(e.target.value);
              if (!parsed.success) return;
              setStatus(parsed.data);
            }}
            value={status}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="edit-notes">
            Admin Notes
          </label>
          <textarea
            className="mt-1 w-full rounded border p-2 text-sm"
            id="edit-notes"
            maxLength={10_000}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
            rows={4}
            value={notes}
          />
        </div>
        <div className="flex gap-2">
          <button className="button" type="submit">
            Save
          </button>
          <button className="button button--secondary" onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </form>
    </article>
  );
}

function AuditionTable({
  auditions,
  generatingIds,
  updatingId,
  onToggle,
  onEdit,
  onCancel,
}: {
  readonly auditions: readonly OrganizationAudition[];
  readonly generatingIds: readonly string[];
  readonly updatingId: string | null;
  readonly onToggle: (id: string) => void;
  readonly onEdit: (a: OrganizationAudition) => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th />
            <th>Name</th>
            <th>Email</th>
            <th>Voice Part</th>
            <th>Status</th>
            <th>Submitted</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {auditions.map((audition) => (
            <tr key={audition.id}>
              <td>
                <input
                  aria-label={`Select ${audition.name} for token generation`}
                  checked={generatingIds.includes(audition.id)}
                  onChange={() => {
                    onToggle(audition.id);
                  }}
                  type="checkbox"
                />
              </td>
              <td className="font-medium">{audition.name}</td>
              <td className="text-sm text-muted-foreground">{audition.email}</td>
              <td className="text-sm">{audition.voicePart ?? "—"}</td>
              <td>
                <span className={`badge badge--${audition.status}`}>
                  {STATUS_LABELS[audition.status]}
                </span>
              </td>
              <td className="text-sm text-muted-foreground">
                {new Date(audition.createdAt).toLocaleDateString()}
              </td>
              <td>
                {updatingId === audition.id ? (
                  <button className="button button--secondary" onClick={onCancel} type="button">
                    Cancel
                  </button>
                ) : (
                  <button
                    className="button button--secondary"
                    onClick={() => {
                      onEdit(audition);
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TokenList({
  tokens,
  auditions,
}: {
  readonly tokens: Record<string, string>;
  readonly auditions: readonly OrganizationAudition[];
}) {
  if (Object.keys(tokens).length === 0) return null;
  return (
    <details className="mt-4">
      <summary>Generated Tokens</summary>
      <ul className="account-list">
        {Object.entries(tokens).map(([auditionId, token]) => {
          const name = auditions.find((a) => a.id === auditionId)?.name ?? auditionId;
          return (
            <li key={auditionId} className="flex items-center gap-2">
              <span className="text-sm font-medium">{name}:</span>
              <code className="text-xs break-all flex-1">{token}</code>
              <button
                className="button button--secondary button--sm"
                onClick={() => {
                  void navigator.clipboard.writeText(token);
                }}
                type="button"
              >
                Copy
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function TokenBar({
  generatingIds,
  onSelectAll,
  onGenerate,
  onClear,
}: {
  readonly generatingIds: readonly string[];
  readonly onSelectAll: () => void;
  readonly onGenerate: () => void;
  readonly onClear: () => void;
}) {
  if (generatingIds.length === 0) {
    return (
      <div className="flex gap-2 mb-4">
        <button className="button button--secondary" onClick={onSelectAll} type="button">
          Select all for tokens
        </button>
      </div>
    );
  }
  return (
    <div className="flex gap-2 mb-4">
      <button className="button" onClick={onGenerate} type="button">
        Generate {String(generatingIds.length)} token(s)
      </button>
      <button className="button button--secondary" onClick={onClear} type="button">
        Clear selection
      </button>
    </div>
  );
}

function StatusNotice({
  message,
}: {
  readonly message: { readonly id: string; readonly text: string } | null;
}) {
  if (!message) return null;
  return (
    <p className="notice notice--success" role="status">
      {message.text}
    </p>
  );
}

export function AuditionManager({ enabled }: Props) {
  const [state, setState] = useState<ManagerState>({ status: "loading" });
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ readonly id: string; readonly text: string } | null>(
    null,
  );
  const [generatingIds, setGeneratingIds] = useState<readonly string[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    listOrganizationAuditions(controller.signal)
      .then((auditions) => {
        setState({ auditions, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  function beginUpdate(audition: OrganizationAudition) {
    setUpdatingId(audition.id);
    setMessage(null);
  }

  function cancelUpdate() {
    setUpdatingId(null);
    setMessage(null);
  }

  function handleSave(auditionId: string, status: AuditionStatus, adminNotes: string) {
    updateOrganizationAudition(auditionId, {
      ...(adminNotes ? { adminNotes } : {}),
      status,
    })
      .then((updated) => {
        setUpdatingId(null);
        setState((prev) =>
          prev.status === "ready"
            ? {
                ...prev,
                auditions: prev.auditions.map((a) => (a.id === auditionId ? { ...updated } : a)),
              }
            : prev,
        );
        setMessage({ id: auditionId, text: "Audition updated." });
      })
      .catch(() => {
        setUpdatingId(null);
        setMessage({ id: auditionId, text: "Could not save. Please try again." });
      });
  }

  function selectAllForTokens() {
    if (state.status !== "ready") return;
    setGeneratingIds(state.auditions.map((a) => a.id));
  }

  function clearTokenSelection() {
    setGeneratingIds([]);
  }

  function toggleTokenSelection(auditionId: string) {
    setGeneratingIds((prev) =>
      prev.includes(auditionId) ? prev.filter((id) => id !== auditionId) : [...prev, auditionId],
    );
  }

  function generateSelectedTokens() {
    const ids = generatingIds;
    if (ids.length === 0) return;
    generateAuditionTokens(ids)
      .then((result) => {
        setTokens((prev) => ({ ...prev, ...result }));
        setMessage({ id: "tokens", text: `${String(ids.length)} token(s) generated.` });
      })
      .catch(() => {
        setMessage({ id: "tokens", text: "Could not generate tokens." });
      });
  }

  if (!enabled) return null;

  if (state.status === "loading") {
    return (
      <section className="panel" aria-labelledby="auditions-title">
        <p className="eyebrow">Auditions</p>
        <h2 id="auditions-title">Audition Management</h2>
        <p>Loading...</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="panel" aria-labelledby="auditions-title">
        <p className="eyebrow">Auditions</p>
        <h2 id="auditions-title">Audition Management</h2>
        <p className="notice notice--error" role="alert">
          Auditions could not be loaded.
        </p>
      </section>
    );
  }

  const editingAudition = updatingId
    ? (state.auditions.find((a) => a.id === updatingId) ?? null)
    : null;

  return (
    <section className="panel" aria-labelledby="auditions-title">
      <p className="eyebrow">Auditions</p>
      <h2 id="auditions-title">Audition Management</h2>

      {state.auditions.length === 0 && <p className="notice">No audition inquiries yet.</p>}

      {state.auditions.length > 0 && (
        <>
          <StatusNotice message={message} />

          <TokenBar
            generatingIds={generatingIds}
            onClear={clearTokenSelection}
            onGenerate={generateSelectedTokens}
            onSelectAll={selectAllForTokens}
          />

          <AuditionTable
            auditions={state.auditions}
            generatingIds={generatingIds}
            updatingId={updatingId}
            onCancel={cancelUpdate}
            onEdit={beginUpdate}
            onToggle={toggleTokenSelection}
          />

          <TokenList auditions={state.auditions} tokens={tokens} />

          {editingAudition && (
            <EditAuditionForm
              auditionId={editingAudition.id}
              currentStatus={editingAudition.status}
              currentNotes={editingAudition.adminNotes ?? ""}
              message={message?.id === editingAudition.id ? message.text : null}
              onCancel={cancelUpdate}
              onSave={handleSave}
            />
          )}
        </>
      )}
    </section>
  );
}
