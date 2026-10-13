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

function TicketReceiptPanel({
  graphicUrl,
  purchase,
  settings,
}: {
  readonly graphicUrl?: string | null | undefined;
  readonly purchase: PublicTicketReceipt;
  readonly settings: TicketConfirmationSettings;
}) {
  if (purchase.status === "refunded") {
    return (
      <div className="ticket-refund-content">
        <TicketRefundSummary purchase={purchase} />
        <TicketRefundOrderDetails graphicUrl={graphicUrl} purchase={purchase} />
      </div>
    );
  }

  return (
    <div className="ticket-receipt-container">
      {purchase.bundleId ? (
        <BundlePassCredentialCard purchase={purchase} settings={settings} />
      ) : purchase.status === "paid" && purchase.scanToken ? (
        <SingleTicketCredentialCard purchase={purchase} settings={settings} />
      ) : null}
      {purchase.bundleId ? (
        <BundlePurchaseSummary graphicUrl={graphicUrl} purchase={purchase} settings={settings} />
      ) : (
        <SingleTicketOrderSummary graphicUrl={graphicUrl} purchase={purchase} settings={settings} />
      )}
    </div>
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

  return (
    <section
      className={
        purchase.status === "refunded"
          ? "public-section ticket-refund-receipt"
          : "public-section public-section--narrow"
      }
    >
      <TicketReceiptStatus purchase={purchase} settings={settings} />
      <TicketReceiptStatusNotice
        isTimedOut={isTimedOut}
        onRefresh={onRefresh}
        purchase={purchase}
      />
      <TicketReceiptPanel graphicUrl={graphicUrl} purchase={purchase} settings={settings} />
      <div className="ticket-receipt-actions">
        <a className="button button--secondary" href="/tickets">
          Return to tickets
        </a>
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
