import type { DuesRecord, OrganizationProfileFolderNumber, Season } from "@choir/contracts";
import { useState } from "react";
import {
  AuthApiError,
  markOrganizationDuesPaidInCash,
  updateOrganizationProfileFolderNumber,
} from "../../../auth/api";

import { duesStatusLabel, formatDuesAmount, formatPerformanceDate } from "./utils";
import type { ProfileDeliveriesState, ProfileDuesState, ProfileFolderNumbersState } from "./types";

export function ProfileFolderNumbers({
  onFolderNumberChanged,
  profileId,
  state,
}: {
  readonly onFolderNumberChanged: (folderNumber: OrganizationProfileFolderNumber) => void;
  readonly profileId: string;
  readonly state: ProfileFolderNumbersState;
}) {
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [returnedDrafts, setReturnedDrafts] = useState<Readonly<Record<string, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingEventId, setSavingEventId] = useState<string | null>(null);

  async function saveFolderNumber(folder: OrganizationProfileFolderNumber): Promise<void> {
    const folderNumber = (drafts[folder.eventId] ?? folder.folderNumber).trim();
    const folderReturned = returnedDrafts[folder.eventId] ?? folder.folderReturned;
    setSavingEventId(folder.eventId);
    setError(null);
    setSuccess(null);
    try {
      const updated = await updateOrganizationProfileFolderNumber(profileId, folder.eventId, {
        folderNumber,
        folderReturned,
      });
      onFolderNumberChanged(updated);
      setSuccess(`${folder.eventTitle} folder details saved.`);
    } catch (saveError: unknown) {
      setError(
        saveError instanceof AuthApiError
          ? saveError.message
          : "The folder number could not be saved.",
      );
    } finally {
      setSavingEventId(null);
    }
  }

  if (state.status === "loading") {
    return <p className="notice notice--info">Loading folder numbers…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Folder numbers could not be loaded. Try again later.
      </p>
    );
  }
  if (state.status !== "ready") return null;
  if (state.folderNumbers.length === 0) {
    return <p className="profile-folder-numbers__empty">No events have been configured yet.</p>;
  }

  return (
    <div className="profile-folder-numbers">
      <div className="profile-folder-numbers__heading">
        <div>
          <p className="eyebrow">Music folders</p>
          <h3>Folder numbers by event</h3>
        </div>
        <span className="field-help">Folder details are stored separately for each event.</span>
      </div>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      <div className="profile-folder-numbers__list" role="list">
        {state.folderNumbers.map((folder) => {
          const formatted = formatPerformanceDate(folder.startsAt);
          const isSaving = savingEventId === folder.eventId;
          return (
            <div className="profile-folder-row" key={folder.eventId} role="listitem">
              <div className="profile-folder-row__event">
                <strong>{folder.eventTitle}</strong>
                <span>
                  {folder.eventType} · {formatted.date} {formatted.time}
                </span>
              </div>
              <label className="profile-folder-row__number">
                <span>Folder number</span>
                <input
                  maxLength={50}
                  onChange={(event) => {
                    setDrafts((current) => ({
                      ...current,
                      [folder.eventId]: event.target.value,
                    }));
                  }}
                  value={drafts[folder.eventId] ?? folder.folderNumber}
                />
              </label>
              <label className="checkbox-row profile-folder-row__returned">
                <input
                  checked={returnedDrafts[folder.eventId] ?? folder.folderReturned}
                  onChange={(event) => {
                    setReturnedDrafts((current) => ({
                      ...current,
                      [folder.eventId]: event.target.checked,
                    }));
                  }}
                  type="checkbox"
                />
                Folder returned
              </label>
              <div className="profile-folder-row__action">
                <button
                  className="button button--secondary button--small"
                  disabled={savingEventId !== null}
                  onClick={() => {
                    void saveFolderNumber(folder);
                  }}
                  type="button"
                >
                  {isSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProfileDues({
  onCashPaymentMarked,
  profileId,
  state,
}: {
  readonly onCashPaymentMarked: (record: DuesRecord) => void;
  readonly profileId: string;
  readonly state: ProfileDuesState;
}) {
  const [cashPaymentSeasonId, setCashPaymentSeasonId] = useState<string | null>(null);
  const [cashPaymentError, setCashPaymentError] = useState<string | null>(null);
  const [cashPaymentSuccess, setCashPaymentSuccess] = useState<string | null>(null);

  async function markCashPayment(season: Season, record: DuesRecord | undefined): Promise<void> {
    if (record?.status === "paid" || record?.status === "refunded") return;
    if (!window.confirm(`Mark ${season.name} dues as paid in cash?`)) return;
    setCashPaymentSeasonId(season.id);
    setCashPaymentError(null);
    setCashPaymentSuccess(null);
    try {
      const updated = await markOrganizationDuesPaidInCash(profileId, season.id);
      onCashPaymentMarked(updated);
      setCashPaymentSuccess(`${season.name} dues were marked as paid in cash.`);
    } catch (error: unknown) {
      setCashPaymentError(
        error instanceof AuthApiError
          ? error.message
          : "The cash dues payment could not be recorded.",
      );
    } finally {
      setCashPaymentSeasonId(null);
    }
  }

  if (state.status === "loading") {
    return <p className="notice notice--info">Loading dues history…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Dues history could not be loaded. Try again later.
      </p>
    );
  }
  if (state.status !== "ready") return null;
  if (state.seasons.length === 0) {
    return <p className="profile-dues-history__empty">No seasons have been configured yet.</p>;
  }

  return (
    <div className="profile-dues-history">
      <div className="profile-dues-history__heading">
        <div>
          <p className="eyebrow">Membership</p>
          <h3>Dues by season</h3>
        </div>
        <span className="field-help">
          Payment status comes from checkout records or an administrator&apos;s cash entry.
        </span>
      </div>
      {cashPaymentError ? (
        <p className="notice notice--error" role="alert">
          {cashPaymentError}
        </p>
      ) : null}
      {cashPaymentSuccess ? (
        <p className="notice notice--success" role="status">
          {cashPaymentSuccess}
        </p>
      ) : null}
      <div className="profile-dues-history__list" role="list">
        {state.seasons.map((season) => {
          const record = state.dues.find(({ seasonId }) => seasonId === season.id);
          return (
            <div className="profile-dues-row" key={season.id} role="listitem">
              <div className="profile-dues-row__season">
                <strong>{season.name}</strong>
                <span>
                  {new Date(season.startsAt).toLocaleDateString()} –{" "}
                  {new Date(season.endsAt).toLocaleDateString()}
                </span>
              </div>
              <div className="profile-dues-row__amount">
                <span className="profile-performance-card__label">Amount</span>
                <strong>{formatDuesAmount(record?.amountCents ?? season.duesAmountCents)}</strong>
              </div>
              <div className="profile-dues-row__status">
                <span className="profile-performance-card__label">Status</span>
                <span className="status-pill">{duesStatusLabel(record)}</span>
              </div>
              <div className="profile-dues-row__paid">
                <span className="profile-performance-card__label">Paid at</span>
                <span>{record?.paidAt ? new Date(record.paidAt).toLocaleDateString() : "—"}</span>
              </div>
              <div className="profile-dues-row__action">
                {!record || record.status === "pending" ? (
                  <button
                    className="button button--secondary button--small"
                    disabled={cashPaymentSeasonId !== null}
                    onClick={() => {
                      void markCashPayment(season, record);
                    }}
                    type="button"
                  >
                    {cashPaymentSeasonId === season.id ? "Recording…" : "Mark cash paid"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProfileMessages({ state }: { readonly state: ProfileDeliveriesState }) {
  if (state.status === "loading") {
    return <p className="notice notice--info">Loading message history…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Message history could not be loaded. Try again later.
      </p>
    );
  }
  if (state.status !== "ready") return null;
  if (state.data.deliveries.length === 0) {
    return <p className="empty-state">No messages have been delivered to this profile yet.</p>;
  }
  return (
    <ul className="account-list">
      {state.data.deliveries.map((delivery) => (
        <li key={delivery.messageId}>
          <div className="profile-delivery-row">
            <div className="profile-delivery-row__meta">
              <strong>{delivery.subject}</strong>
              <small className="table-secondary">
                {formatDeliveryDate(delivery.lastAttemptAt)} · {delivery.channel.toUpperCase()} ·{" "}
                {maskDestination(delivery.destination)}
              </small>
            </div>
            <span className={`status-pill status-pill--${delivery.status}`}>
              {delivery.status.charAt(0).toUpperCase() + delivery.status.slice(1)}
            </span>
          </div>
          {delivery.failureDetail ? <p className="field-help">{delivery.failureDetail}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function maskDestination(destination: string): string {
  if (destination.includes("@")) {
    const [local, domain] = destination.split("@");
    if (local !== undefined && domain !== undefined) {
      const visible = local.slice(0, 2);
      return `${visible}…@${domain}`;
    }
  }
  return destination.slice(0, 4) + "…";
}

function formatDeliveryDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
}
