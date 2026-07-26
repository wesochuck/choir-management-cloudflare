import type { OrganizationVenue } from "@choir/contracts";
import { DataTable, Dialog } from "@choir/ui";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  createOrganizationVenue,
  deleteOrganizationVenue,
  listOrganizationVenues,
} from "../auth/api";

type VenueState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly venues: readonly OrganizationVenue[] };

export function VenuesPage({ enabled }: { readonly enabled: boolean }) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmVenue, setConfirmVenue] = useState<OrganizationVenue | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
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

  async function createVenue() {
    setBusy(true);
    setError(null);
    try {
      const venue = await createOrganizationVenue(name, address);
      setState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              venues: [...current.venues, venue].toSorted((left, right) =>
                left.name.localeCompare(right.name),
              ),
            }
          : current,
      );
      setName("");
      setAddress("");
      setCreateOpen(false);
      setSuccess("Venue created.");
    } catch (createError: unknown) {
      setError(
        createError instanceof AuthApiError
          ? createError.message
          : "The venue could not be created.",
      );
    } finally {
      setBusy(false);
    }
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
    return <p className="notice notice--warning">Verify Organization MFA to manage venues.</p>;
  }

  return (
    <>
      <div className="page-toolbar page-toolbar--end">
        <button
          className="button button--primary"
          onClick={() => {
            setError(null);
            setSuccess(null);
            setCreateOpen(true);
          }}
          type="button"
        >
          Add venue
        </button>
      </div>
      {error && !createOpen && !confirmVenue ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
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
            },
            {
              header: "Address",
              id: "address",
              render: (venue) => venue.address || "No address",
            },
            {
              header: "Actions",
              id: "actions",
              mobileLabel: "Manage",
              render: (venue) => (
                <button
                  className="text-button text-button--danger"
                  onClick={() => {
                    setError(null);
                    setSuccess(null);
                    setConfirmVenue(venue);
                  }}
                  type="button"
                >
                  Delete
                </button>
              ),
            },
          ]}
          emptyMessage="No venues have been created yet."
          keySelector={(venue) => venue.id}
          rows={state.venues}
        />
      ) : null}

      <Dialog
        description="Save an address once and reuse it when scheduling events."
        onClose={() => {
          if (!busy) setCreateOpen(false);
        }}
        open={createOpen}
        title="Add venue"
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void createVenue();
          }}
        >
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="field">
            <label htmlFor="venue-page-name">Name</label>
            <input
              autoFocus
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
            <button
              className="button button--secondary"
              onClick={() => {
                setCreateOpen(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button className="button button--primary" disabled={busy} type="submit">
              {busy ? "Creating…" : "Create venue"}
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
