import type { DuesRecord, OrganizationProfileFolderNumber, Season } from "@choir/contracts";
import { useConfirmation } from "@choir/ui";
import { useState } from "react";
import { AuthApiError, markOrganizationDuesPaidInCash } from "../../../auth/api";

import { duesStatusLabel, formatDuesAmount, formatPerformanceDate } from "./utils";
import type { ProfileDeliveriesState, ProfileDuesState, ProfileFolderNumbersState } from "./types";

export function ProfileFolderNumbers({
  onFolderNumberChanged,
  state,
}: {
  readonly onFolderNumberChanged: (folderNumber: OrganizationProfileFolderNumber) => void;
  readonly profileId?: string | null | undefined;
  readonly state: ProfileFolderNumbersState;
}) {
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
          <h3>Folder numbers by event</h3>
        </div>
        <span className="field-help">Folder details are stored separately for each event.</span>
      </div>
      <div className="profile-folder-numbers__list" role="list">
        {state.folderNumbers.map((folder) => {
          const formatted = formatPerformanceDate(folder.startsAt);
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
                    onFolderNumberChanged({
                      ...folder,
                      folderNumber: event.target.value,
                    });
                  }}
                  value={folder.folderNumber}
                />
              </label>
              <label className="checkbox-row profile-folder-row__returned">
                <input
                  checked={folder.folderReturned}
                  onChange={(event) => {
                    onFolderNumberChanged({
                      ...folder,
                      folderReturned: event.target.checked,
                    });
                  }}
                  type="checkbox"
                />
                Folder returned
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function cashPaymentConfirmation(isOnlinePending: boolean, seasonName: string) {
  return {
    confirmLabel: isOnlinePending ? "Switch to cash" : "Mark paid",
    description: isOnlinePending
      ? `This will cancel the pending online checkout session and mark ${seasonName} dues as Paid · Cash.`
      : `This will record ${seasonName} dues as paid without a checkout payment.`,
    title: isOnlinePending ? "Switch to cash payment?" : "Mark dues paid in cash?",
  };
}

function ProfileDuesAction({
  isPendingOperation,
  onMarkCash,
  record,
}: {
  readonly isPendingOperation: boolean;
  readonly onMarkCash: () => void;
  readonly record: DuesRecord | undefined;
}) {
  if (record?.status === "paid" || record?.status === "refunded") return null;
  if (record?.status === "pending" && record.paymentMethod === "online" && record.sharedCheckout) {
    return (
      <span className="field-help profile-dues-row__help">
        Shared group checkout cannot be converted individually.
      </span>
    );
  }
  const isOnline = record?.status === "pending" && record.paymentMethod === "online";
  const buttonLabel = isPendingOperation
    ? isOnline
      ? "Switching…"
      : "Recording…"
    : isOnline
      ? "Switch to cash payment"
      : "Mark cash paid";

  return (
    <button
      className="button button--secondary button--small"
      disabled={isPendingOperation}
      onClick={onMarkCash}
      type="button"
    >
      {buttonLabel}
    </button>
  );
}

function cannotMarkCashPayment(record: DuesRecord | undefined): boolean {
  if (record?.status === "paid" || record?.status === "refunded") return true;
  if (!record) return false;
  return record.status === "pending" && record.paymentMethod === "online" && record.sharedCheckout;
}

export function ProfileDues({
  onCashPaymentMarked,
  profileId,
  state,
}: {
  readonly onCashPaymentMarked: (dues: DuesRecord) => void;
  readonly profileId: string;
  readonly state: ProfileDuesState;
}) {
  const [cashPaymentSeasonId, setCashPaymentSeasonId] = useState<string | null>(null);
  const [cashPaymentError, setCashPaymentError] = useState<string | null>(null);
  const [cashPaymentSuccess, setCashPaymentSuccess] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmation();

  async function markCashPayment(season: Season, record: DuesRecord | undefined): Promise<void> {
    if (cannotMarkCashPayment(record)) return;
    const isOnlinePending = record?.status === "pending" && record.paymentMethod === "online";
    const confirmed = await confirm(cashPaymentConfirmation(isOnlinePending, season.name));
    if (!confirmed) return;

    setCashPaymentSeasonId(season.id);
    setCashPaymentError(null);
    setCashPaymentSuccess(null);
    try {
      const updated = await markOrganizationDuesPaidInCash(profileId, season.id, {
        cancelPendingOnlineCheckout: isOnlinePending,
        expectedDuesId: record?.id,
      });
      onCashPaymentMarked(updated);
      setCashPaymentSuccess(
        isOnlinePending
          ? `${season.name} dues were switched to cash payment.`
          : `${season.name} dues were marked as paid in cash.`,
      );
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
                <ProfileDuesAction
                  isPendingOperation={cashPaymentSeasonId !== null}
                  onMarkCash={() => {
                    void markCashPayment(season, record);
                  }}
                  record={record}
                />
              </div>
            </div>
          );
        })}
      </div>
      {confirmationDialog}
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
            <div>
              <span className={`status-pill status-pill--${delivery.status}`}>
                Queue: {delivery.status}
              </span>
              {delivery.providerStatus ? (
                <span className="status-pill">Provider: {delivery.providerStatus}</span>
              ) : null}
            </div>
          </div>
          {delivery.failureDetail || delivery.providerReason ? (
            <p className="field-help">{delivery.failureDetail || delivery.providerReason}</p>
          ) : null}
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
