import { useEffect, useState } from "react";
import type {
  PublicTicketReceipt,
  PublishedOrganizationProjection,
  TicketConfirmationSettings,
} from "@choir/contracts";
import { DEFAULT_TICKET_CONFIRMATION_SETTINGS } from "../shared";
import {
  AuthApiError,
  getPublicTicketConfirmationSettings,
  getPublicTicketPurchase,
  getPublishedOrganizationProjection,
} from "../../../auth/api";
import { mediaUrl } from "../../publicMedia";
import { BundlePassCredentialCard, SingleTicketCredentialCard } from "./TicketCredentialCard";
import { BundlePurchaseSummary, SingleTicketOrderSummary } from "./TicketOrderSummary";
import { TicketReceiptStatus, TicketReceiptStatusNotice } from "./TicketReceiptStatus";
import { TicketRefundOrderDetails, TicketRefundSummary } from "./TicketRefundDetails";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 45000;

function PrinterIcon() {
  return (
    <svg
      aria-hidden="true"
      className="ticket-print-button__icon"
      fill="none"
      focusable="false"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </svg>
  );
}

function resolveReceiptGraphicUrl(
  projection: PublishedOrganizationProjection | null | undefined,
  purchase: PublicTicketReceipt,
): string | null {
  if (!projection) return null;
  const matchingPerformance = projection.payload.performances.find(
    (candidate) => candidate.id === purchase.eventId,
  );
  const matchingBundle = projection.payload.ticketBundles.find(
    (candidate) => candidate.id === purchase.bundleId,
  );
  const graphicFileId = purchase.bundleId
    ? (matchingBundle?.graphicFileId ?? null)
    : (matchingPerformance?.graphicFileId ?? null);
  return graphicFileId ? mediaUrl(projection, graphicFileId) : null;
}

function TicketReceiptContent({
  onRefresh,
  projection,
  settings,
  token,
}: {
  readonly onRefresh: () => void;
  readonly projection?: PublishedOrganizationProjection | null | undefined;
  readonly settings: TicketConfirmationSettings;
  readonly token: string;
}) {
  const [purchase, setPurchase] = useState<PublicTicketReceipt | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let latestPurchase: PublicTicketReceipt | null = null;
    const startTime = Date.now();

    function schedulePoll() {
      if (controller.signal.aborted) {
        return;
      }

      getPublicTicketPurchase(token, controller.signal)
        .then((nextPurchase) => {
          if (controller.signal.aborted) {
            return;
          }
          latestPurchase = nextPurchase;
          setPurchase(nextPurchase);
          setLoadError(null);

          if (nextPurchase.status === "pending") {
            const elapsed = Date.now() - startTime;
            if (elapsed >= POLL_TIMEOUT_MS) {
              setIsTimedOut(true);
            } else {
              timerId = setTimeout(schedulePoll, POLL_INTERVAL_MS);
            }
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }

          if (error instanceof AuthApiError && error.status === 404) {
            setIsUnavailable(true);
            return;
          }

          const elapsed = Date.now() - startTime;
          if (elapsed < POLL_TIMEOUT_MS) {
            timerId = setTimeout(schedulePoll, POLL_INTERVAL_MS);
          } else if (!latestPurchase) {
            setLoadError(
              "Unable to load ticket receipt. Please check your connection and try again.",
            );
          } else {
            setIsTimedOut(true);
          }
        });
    }

    schedulePoll();

    return () => {
      controller.abort();
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [token]);

  if (isUnavailable) {
    return <p className="notice notice--error">This ticket receipt is unavailable.</p>;
  }

  if (loadError && !purchase) {
    return (
      <section className="public-section public-section--narrow">
        <p className="notice notice--error">{loadError}</p>
        <button
          className="button button--secondary"
          onClick={() => {
            onRefresh();
          }}
          type="button"
        >
          Check status again
        </button>
      </section>
    );
  }

  if (!purchase) {
    return <p className="notice notice--info">Loading ticket receipt…</p>;
  }

  const graphicUrl = resolveReceiptGraphicUrl(projection, purchase);

  if (purchase.status === "refunded") {
    return (
      <section className="public-section ticket-refund-receipt">
        <TicketReceiptStatus purchase={purchase} settings={settings} />
        <TicketRefundSummary purchase={purchase} />
        <TicketRefundOrderDetails graphicUrl={graphicUrl} purchase={purchase} />
        <div className="ticket-receipt-actions no-print">
          <a className="button button--secondary" href="/tickets">
            Return to tickets
          </a>
        </div>
      </section>
    );
  }

  const matchedPerformance = projection?.payload.performances.find(
    (p) => p.id === purchase.eventId,
  );
  const doorsOpenTime =
    purchase.doorsOpenTime.trim().length > 0
      ? purchase.doorsOpenTime
      : (matchedPerformance?.doorsOpenTime ?? "");

  return (
    <section className="public-section ticket-confirmation-section">
      <div className="ticket-confirmation-layout">
        {/* Left Column (Desktop) / Header & Secondary Details (Mobile) */}
        <div className="ticket-confirmation-hero">
          <TicketReceiptStatus purchase={purchase} settings={settings} />
          <div className="ticket-confirmation-notices">
            <TicketReceiptStatusNotice
              isTimedOut={isTimedOut}
              onRefresh={onRefresh}
              purchase={purchase}
            />
          </div>

          <div className="ticket-confirmation-actions ticket-confirmation-actions--desktop no-print">
            <button
              className="button button--primary ticket-print-button"
              onClick={() => {
                window.print();
              }}
              type="button"
            >
              <PrinterIcon />
              Print / Save as PDF
            </button>
            <p className="ticket-print-helper">
              Prints a one-page admission ticket, not the whole webpage.
            </p>
          </div>

          {purchase.bundleId ? (
            <BundlePurchaseSummary
              graphicUrl={graphicUrl}
              purchase={purchase}
              settings={settings}
            />
          ) : (
            <SingleTicketOrderSummary
              graphicUrl={graphicUrl}
              purchase={purchase}
              settings={settings}
            />
          )}

          <div className="ticket-receipt-actions no-print">
            <a className="button button--secondary" href="/tickets">
              Return to tickets
            </a>
          </div>
        </div>

        {/* Right Column (Desktop) / Primary Admission Focus (Mobile) / Dedicated Print Target */}
        <div className="ticket-confirmation-ticket">
          {purchase.bundleId ? (
            <BundlePassCredentialCard purchase={purchase} settings={settings} />
          ) : (
            <SingleTicketCredentialCard
              doorsOpenTime={doorsOpenTime}
              purchase={purchase}
              settings={settings}
            />
          )}

          {/* Dedicated mobile print action immediately below the ticket card */}
          <div className="ticket-confirmation-actions ticket-confirmation-actions--mobile no-print">
            <button
              className="button button--primary ticket-print-button"
              onClick={() => {
                window.print();
              }}
              type="button"
            >
              <PrinterIcon />
              Print / Save as PDF
            </button>
            <p className="ticket-print-helper">
              Prints a one-page admission ticket, not the whole webpage.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function TicketReceipt({
  projection: initialProjection,
  token,
}: {
  readonly projection?: PublishedOrganizationProjection | null | undefined;
  readonly token: string;
}) {
  const [confirmationSettings, setConfirmationSettings] = useState(
    DEFAULT_TICKET_CONFIRMATION_SETTINGS,
  );
  const [fetchedProjection, setFetchedProjection] =
    useState<PublishedOrganizationProjection | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const projection = initialProjection ?? fetchedProjection;

  useEffect(() => {
    const controller = new AbortController();
    void getPublicTicketConfirmationSettings(controller.signal)
      .then((nextSettings) => {
        setConfirmationSettings(nextSettings);
      })
      .catch(() => {
        // Keeps default settings
      });
    if (!initialProjection) {
      void getPublishedOrganizationProjection(controller.signal)
        .then((nextProjection) => {
          if (nextProjection) {
            setFetchedProjection(nextProjection);
          }
        })
        .catch(() => {
          // Optional enhancement if projection not available
        });
    }
    return () => {
      controller.abort();
    };
  }, [initialProjection]);

  if (!token) {
    return <p className="notice notice--error">This ticket receipt is unavailable.</p>;
  }

  return (
    <TicketReceiptContent
      key={`${token}:${String(refreshKey)}`}
      onRefresh={() => {
        setRefreshKey((key) => key + 1);
      }}
      projection={projection}
      settings={confirmationSettings}
      token={token}
    />
  );
}
