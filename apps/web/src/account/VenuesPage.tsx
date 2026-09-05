import type { OrganizationVenue } from "@choir/contracts";
import { DataTable, Dialog, DialogClose } from "@choir/ui";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  createOrganizationVenue,
  deleteOrganizationVenue,
  listOrganizationVenues,
  updateOrganizationVenue,
} from "../auth/api";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";

type VenueState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly venues: readonly OrganizationVenue[] };

// eslint-disable-next-line complexity -- this page coordinates loading, editing, and deletion dialogs.
export function VenuesPage({ enabled }: { readonly enabled: boolean }) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmVenue, setConfirmVenue] = useState<OrganizationVenue | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingVenue, setEditingVenue] = useState<OrganizationVenue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [state, setState] = useState<VenueState>({ status: "loading" });
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    listOrganizationVenues(controller.signal)
      .then((venues) => {
        setState({ status: "ready", venues });
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  async function saveVenue() {
    setBusy(true);
    setError(null);
    try {
      const venue = editingVenue
        ? await updateOrganizationVenue(editingVenue.id, name, address)
        : await createOrganizationVenue(name, address);
      setState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              venues: [...current.venues.filter(({ id }) => id !== venue.id), venue].toSorted(
                (left, right) => left.name.localeCompare(right.name),
              ),
            }
          : current,
      );
      setName("");
      setAddress("");
      setCreateOpen(false);
      setEditingVenue(null);
      setSuccess(editingVenue ? "Venue updated." : "Venue created.");
    } catch (createError: unknown) {
      setError(
        createError instanceof AuthApiError
          ? createError.message
          : editingVenue
            ? "The venue could not be updated."
            : "The venue could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  function openCreateDialog(): void {
    setError(null);
    setSuccess(null);
    setEditingVenue(null);
    setName("");
    setAddress("");
    setCreateOpen(true);
  }

  function openEditDialog(venue: OrganizationVenue): void {
    setError(null);
    setSuccess(null);
    setEditingVenue(venue);
    setName(venue.name);
    setAddress(venue.address);
    setCreateOpen(true);
  }

  async function removeVenue() {
    if (!confirmVenue) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganizationVenue(confirmVenue.id);
      setState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              venues: current.venues.filter((candidate) => candidate.id !== confirmVenue.id),
            }
          : current,
      );
      setConfirmVenue(null);
      setSuccess("Venue deleted.");
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof AuthApiError
          ? deleteError.message
          : "The venue could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return <OrganizationMfaPrompt message="Verify Organization MFA to manage venues." />;
  }

  return (
    <>
      <div className="page-toolbar page-toolbar--end">
        <button className="button button--primary" onClick={openCreateDialog} type="button">
          Add venue
        </button>
      </div>
      {error && !createOpen && !confirmVenue ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {success && !createOpen && !confirmVenue ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      {state.status === "loading" ? <p role="status">Loading venues…</p> : null}
      {state.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Venues could not be loaded.
        </p>
      ) : null}
      {state.status === "ready" ? (
        <DataTable
          columns={[
            {
              header: "Venue",
              id: "name",
              render: (venue) => <strong>{venue.name}</strong>,
              sortValue: (venue) => venue.name,
            },
            {
              header: "Address",
              id: "address",
              render: (venue) => venue.address || "No address",
              sortValue: (venue) => venue.address,
            },
            {
              header: "Actions",
              id: "actions",
              mobileLabel: "Manage",
              render: (venue) => (
                <div className="table-actions">
                  <button
                    className="button button--secondary button--small"
                    onClick={() => {
                      openEditDialog(venue);
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="button button--danger button--small"
                    onClick={() => {
                      setError(null);
                      setSuccess(null);
                      setConfirmVenue(venue);
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ),
            },
          ]}
          emptyMessage="No venues have been created yet."
          initialSort={{ columnId: "name", direction: "asc" }}
          keySelector={(venue) => venue.id}
          onRowClick={openEditDialog}
          rowLabel={(venue) => `Edit ${venue.name}`}
          rows={state.venues}
        />
      ) : null}

      <Dialog
        description="Save an address once and reuse it when scheduling events."
        onClose={() => {
          if (!busy) {
            setCreateOpen(false);
            setEditingVenue(null);
          }
        }}
        open={createOpen}
        title={editingVenue ? "Edit venue" : "Add venue"}
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void saveVenue();
          }}
        >
          {error ? (
            <p className="notice notice--error" id="venue-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="field">
            <label htmlFor="venue-page-name">Name</label>
            <input
              aria-describedby={error ? "venue-form-error" : undefined}
              aria-invalid={Boolean(error)}
              id="venue-page-name"
              maxLength={500}
              onChange={(event) => {
                setName(event.target.value);
              }}
              required
              value={name}
            />
          </div>
          <div className="field">
            <label htmlFor="venue-page-address">Address</label>
            <textarea
              id="venue-page-address"
              maxLength={2000}
              onChange={(event) => {
                setAddress(event.target.value);
              }}
              rows={3}
              value={address}
            />
          </div>
          <div className="dialog__actions">
            <DialogClose asChild>
              <button className="button button--secondary" disabled={busy} type="button">
                Cancel
              </button>
            </DialogClose>
            <button
              aria-busy={busy}
              className="button button--primary"
              disabled={busy}
              type="submit"
            >
              {busy ? "Saving…" : editingVenue ? "Save changes" : "Create venue"}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        description="Events using this venue may prevent deletion."
        onClose={() => {
          if (!busy) setConfirmVenue(null);
        }}
        open={confirmVenue !== null}
        title="Delete venue?"
      >
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <p>
          {confirmVenue
            ? `Delete ${confirmVenue.name}? This action cannot be undone.`
            : "Delete this venue?"}
        </p>
        <div className="dialog__actions">
          <button
            className="button button--secondary"
            onClick={() => {
              setConfirmVenue(null);
            }}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--danger"
            disabled={busy}
            onClick={() => void removeVenue()}
            type="button"
          >
            {busy ? "Deleting…" : "Delete venue"}
          </button>
        </div>
      </Dialog>
    </>
  );
}
