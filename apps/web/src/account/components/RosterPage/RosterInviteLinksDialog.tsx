import type { RosterInviteExpirationDays, RosterInviteLinkSummary } from "@choir/contracts";
import { DataTable, Dialog, DialogClose, useConfirmation } from "@choir/ui";
import { useCallback, useEffect, useState } from "react";

import {
  createRosterInviteLink,
  listRosterInviteLinks,
  revokeRosterInviteLink,
  shareRosterInviteLink,
} from "../../../api";

export function RosterInviteLinksDialog({
  onClose,
  open,
}: {
  readonly onClose: () => void;
  readonly open: boolean;
}) {
  const [links, setLinks] = useState<readonly RosterInviteLinkSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [label, setLabel] = useState("Choir Roster Invite");
  const [expiresInDays, setExpiresInDays] = useState<RosterInviteExpirationDays>(7);
  const [maxUsesInput, setMaxUsesInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  const { confirm, confirmationDialog } = useConfirmation();

  const loadLinks = useCallback(async () => {
    setIsLoading(true);
    setListError(null);
    try {
      const response = await listRosterInviteLinks();
      setLinks(response.links);
    } catch {
      setListError("Failed to load roster invite links.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    void listRosterInviteLinks()
      .then((response) => {
        if (!ignore) setLinks(response.links);
      })
      .catch(() => {
        if (!ignore) setListError("Failed to load roster invite links.");
      });
    return () => {
      ignore = true;
    };
  }, [open]);

  async function handleCreate(event: React.SyntheticEvent): Promise<void> {
    event.preventDefault();
    setActionError(null);
    setActionSuccess(null);

    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setActionError("Label is required.");
      return;
    }

    let parsedMaxUses: number | null = null;
    if (maxUsesInput.trim()) {
      const num = parseInt(maxUsesInput.trim(), 10);
      if (Number.isNaN(num) || num <= 0) {
        setActionError("Max uses must be a positive number.");
        return;
      }
      parsedMaxUses = num;
    }

    setIsCreating(true);
    try {
      const response = await createRosterInviteLink({
        expiresInDays,
        label: trimmedLabel,
        maxUses: parsedMaxUses,
      });

      setActionSuccess("Invite link created and copied to clipboard!");
      void navigator.clipboard.writeText(response.shareUrl);
      setLabel("Choir Roster Invite");
      setMaxUsesInput("");
      await loadLinks();
    } catch {
      setActionError("Could not create roster invite link. Please try again.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCopy(linkId: string): Promise<void> {
    setActionError(null);
    try {
      const result = await shareRosterInviteLink(linkId);
      await navigator.clipboard.writeText(result.shareUrl);
      setCopiedLinkId(linkId);
      setActionSuccess("Share link copied to clipboard!");
      setTimeout(() => {
        setCopiedLinkId(null);
      }, 3000);
    } catch {
      setActionError("Could not retrieve share link URL.");
    }
  }

  async function handleRevoke(link: RosterInviteLinkSummary): Promise<void> {
    if (link.status !== "active") return;
    const confirmed = await confirm({
      confirmLabel: "Revoke link",
      description: `Are you sure you want to revoke "${link.label}"? Anyone attempting to use it in the future will be rejected.`,
      title: "Revoke invite link",
    });

    if (!confirmed) return;

    setActionError(null);
    try {
      await revokeRosterInviteLink(link.id);
      setActionSuccess(`"${link.label}" was revoked.`);
      await loadLinks();
    } catch {
      setActionError("Could not revoke link. Please try again.");
    }
  }

  return (
    <>
      <Dialog
        description="Create and manage reusable links that allow new members to join this roster."
        onClose={onClose}
        open={open}
        title="Roster invite links"
      >
        <div className="form-stack">
          <form
            autoComplete="off"
            noValidate
            onSubmit={(e) => {
              void handleCreate(e);
            }}
          >
            <div className="form-grid">
              <div className="field">
                <label htmlFor="invite-link-label">Link label</label>
                <input
                  id="invite-link-label"
                  maxLength={100}
                  onChange={(e) => {
                    setLabel(e.target.value);
                  }}
                  placeholder="e.g. Spring 2026 Roster"
                  required
                  value={label}
                />
              </div>

              <div className="field">
                <label htmlFor="invite-link-expiry">Expiration</label>
                <select
                  id="invite-link-expiry"
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    if (parsed === 1 || parsed === 7 || parsed === 30) {
                      setExpiresInDays(parsed);
                    }
                  }}
                  value={expiresInDays}
                >
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="invite-link-max-uses">Max uses (optional)</label>
                <input
                  id="invite-link-max-uses"
                  min="1"
                  onChange={(e) => {
                    setMaxUsesInput(e.target.value);
                  }}
                  placeholder="Unlimited"
                  type="number"
                  value={maxUsesInput}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="button button--primary" disabled={isCreating} type="submit">
                {isCreating ? "Creating…" : "Create invite link"}
              </button>
            </div>
          </form>

          {actionError ? (
            <p className="notice notice--error" role="alert">
              {actionError}
            </p>
          ) : null}

          {actionSuccess ? (
            <p className="notice notice--success" role="status">
              {actionSuccess}
            </p>
          ) : null}

          {listError ? (
            <p className="notice notice--error" role="alert">
              {listError}
            </p>
          ) : null}

          <div style={{ marginTop: "1rem" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Existing invite links
            </h3>
            {isLoading ? (
              <p role="status">Loading links…</p>
            ) : links.length === 0 ? (
              <p className="notice notice--info">No invite links have been created yet.</p>
            ) : (
              <DataTable
                columns={[
                  {
                    header: "Label",
                    id: "label",
                    render: (link) => <strong>{link.label}</strong>,
                    sortValue: (link) => link.label,
                  },
                  {
                    header: "Status",
                    id: "status",
                    render: (link) => {
                      const className =
                        link.status === "active"
                          ? "badge badge--success"
                          : link.status === "expired"
                            ? "badge badge--warning"
                            : "badge badge--muted";
                      return (
                        <span className={className}>
                          {link.status.charAt(0).toUpperCase() + link.status.slice(1)}
                        </span>
                      );
                    },
                    sortValue: (link) => link.status,
                  },
                  {
                    header: "Uses",
                    id: "uses",
                    render: (link) => (
                      <span>
                        {link.committedUses} / {link.maxUses ?? "Unlimited"}
                      </span>
                    ),
                    sortValue: (link) => link.committedUses,
                  },
                  {
                    header: "Expires",
                    id: "expires",
                    render: (link) => new Date(link.expiresAt).toLocaleDateString(),
                    sortValue: (link) => link.expiresAt,
                  },
                  {
                    header: "Actions",
                    id: "actions",
                    render: (link) => (
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button
                          className="button button--secondary button--small"
                          onClick={() => void handleCopy(link.id)}
                          type="button"
                        >
                          {copiedLinkId === link.id ? "Copied!" : "Copy link"}
                        </button>
                        {link.status === "active" ? (
                          <button
                            className="button button--danger button--small"
                            onClick={() => void handleRevoke(link)}
                            type="button"
                          >
                            Revoke
                          </button>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
                initialSort={{ columnId: "expires", direction: "desc" }}
                keySelector={(link) => link.id}
                rows={links}
              />
            )}
          </div>

          <div className="dialog__actions">
            <DialogClose asChild>
              <button className="button button--secondary" type="button">
                Done
              </button>
            </DialogClose>
          </div>
        </div>
      </Dialog>
      {confirmationDialog}
    </>
  );
}
