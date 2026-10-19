import { ConfirmDialog } from "@choir/ui";
import type { CalendarFeedUrlsResponse } from "@choir/contracts";
import { useEffect, useState } from "react";

import { getCalendarFeedUrls, resetCalendarFeedUrls } from "../auth/api";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";

type CalendarState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "ready"; readonly urls: CalendarFeedUrlsResponse };

interface ReadyContentProps {
  readonly busy: boolean;
  readonly confirmReset: boolean;
  readonly copyState: "idle" | "copied" | "error";
  readonly onCancelReset: () => void;
  readonly onConfirmReset: () => void;
  readonly onCopy: () => void;
  readonly onRequestReset: () => void;
  readonly resetNotice: string | null;
  readonly urls: CalendarFeedUrlsResponse;
}

function CalendarFeedReadyContent({
  busy,
  confirmReset,
  copyState,
  onCancelReset,
  onConfirmReset,
  onCopy,
  onRequestReset,
  resetNotice,
  urls,
}: ReadyContentProps) {
  const googleCalendarUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(urls.webcalUrl)}`;

  return (
    <>
      <p>
        Subscribe from a calendar app or copy the HTTPS address. Resetting immediately revokes the
        current address on every device.
      </p>
      <div className="form-stack">
        <div className="button-row">
          <a className="button button--primary" href={urls.webcalUrl}>
            Subscribe in calendar app
          </a>
          <a
            className="button button--secondary"
            href={googleCalendarUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Subscribe in Google Calendar
          </a>
        </div>
        <label htmlFor="calendar-feed-url">HTTPS calendar address</label>
        <div className="calendar-feed-url-row">
          <input id="calendar-feed-url" readOnly type="text" value={urls.httpsUrl} />
          <button className="button button--secondary" onClick={onCopy} type="button">
            {copyState === "copied" ? "✓ Copied!" : "Copy link"}
          </button>
        </div>
        {copyState === "copied" ? (
          <span className="sr-only" role="status">
            Calendar link copied to clipboard.
          </span>
        ) : null}
        <p className="field-help">Anyone with this link can view your calendar. Do not share it.</p>
        <p className="field-help">
          In Google Calendar, choose <strong>Other calendars</strong> → <strong>From URL</strong>{" "}
          and paste this address, or click <strong>Subscribe in Google Calendar</strong>. Use the
          Subscribe in calendar app button for Apple Calendar and other apps that support webcal.
        </p>
        {copyState === "error" ? (
          <p className="notice notice--warning" role="status">
            Copy was blocked by the browser. Select the address and copy it manually.
          </p>
        ) : null}
        {resetNotice ? (
          <p className="notice notice--success" role="status">
            {resetNotice}
          </p>
        ) : null}
      </div>
      <button className="button button--secondary" onClick={onRequestReset} type="button">
        Reset calendar address
      </button>
      <ConfirmDialog
        confirmLabel={busy ? "Resetting…" : "Reset address"}
        description="Existing calendar subscriptions on all your devices will stop updating immediately until updated with the new address."
        destructive
        onCancel={onCancelReset}
        onConfirm={onConfirmReset}
        open={confirmReset}
        title="Reset calendar address?"
      />
    </>
  );
}

export function CalendarSubscription({ enabled }: { readonly enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [state, setState] = useState<CalendarState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const abortController = new AbortController();
    getCalendarFeedUrls(abortController.signal)
      .then((urls) => {
        setState({ status: "ready", urls });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        const missing =
          typeof error === "object" && error !== null && "status" in error && error.status === 404;
        setState({ status: missing ? "missing" : "error" });
      });
    return () => {
      abortController.abort();
    };
  }, [enabled]);

  async function resetCredential() {
    setBusy(true);
    try {
      const urls = await resetCalendarFeedUrls();
      setState({ status: "ready", urls });
      setConfirmReset(false);
      setResetNotice("Calendar subscription address reset. New link is ready.");
      window.setTimeout(() => {
        setResetNotice(null);
      }, 5_000);
    } catch {
      setState({ status: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function copyCalendarAddress(): Promise<void> {
    if (state.status !== "ready") return;
    try {
      await navigator.clipboard.writeText(state.urls.httpsUrl);
      setCopyState("copied");
      window.setTimeout(() => {
        setCopyState("idle");
      }, 2_000);
    } catch {
      setCopyState("error");
    }
  }

  return (
    <fieldset className="calendar-subscription-card">
      <legend className="calendar-subscription-card__legend">Calendar subscription</legend>
      {!enabled ? (
        <OrganizationMfaPrompt message="Verify Organization MFA to manage this feed." />
      ) : null}
      {enabled && state.status === "loading" ? <p>Loading calendar subscription…</p> : null}
      {enabled && state.status === "missing" ? (
        <p className="empty-state">
          Link this Organization Membership to a Profile before creating a calendar subscription.
        </p>
      ) : null}
      {enabled && state.status === "error" ? (
        <p className="notice notice--error" role="alert">
          The calendar subscription could not be loaded. Refresh and try again.
        </p>
      ) : null}
      {enabled && state.status === "ready" ? (
        <CalendarFeedReadyContent
          busy={busy}
          confirmReset={confirmReset}
          copyState={copyState}
          onCancelReset={() => {
            setConfirmReset(false);
          }}
          onConfirmReset={() => {
            void resetCredential();
          }}
          onCopy={() => {
            void copyCalendarAddress();
          }}
          onRequestReset={() => {
            setConfirmReset(true);
          }}
          resetNotice={resetNotice}
          urls={state.urls}
        />
      ) : null}
    </fieldset>
  );
}
