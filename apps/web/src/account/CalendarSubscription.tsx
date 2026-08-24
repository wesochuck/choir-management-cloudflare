import type { CalendarFeedUrlsResponse } from "@choir/contracts";
import { useEffect, useState } from "react";

import { getCalendarFeedUrls, resetCalendarFeedUrls } from "../auth/api";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";

type CalendarState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "ready"; readonly urls: CalendarFeedUrlsResponse };

export function CalendarSubscription({ enabled }: { readonly enabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
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
      setState({ status: "ready", urls: await resetCalendarFeedUrls() });
      setConfirmReset(false);
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
        <>
          <p>
            Subscribe from a calendar app or copy the HTTPS address. Resetting immediately revokes
            the current address on every device.
          </p>
          <div className="form-stack">
            <a className="button button--primary" href={state.urls.webcalUrl}>
              Subscribe in calendar app
            </a>
            <label htmlFor="calendar-feed-url">HTTPS calendar address</label>
            <div className="calendar-feed-url-row">
              <input id="calendar-feed-url" readOnly type="url" value={state.urls.httpsUrl} />
              <button
                className="button button--secondary"
                onClick={() => {
                  void copyCalendarAddress();
                }}
                type="button"
              >
                {copyState === "copied" ? "Copied" : "Copy address"}
              </button>
            </div>
            <p className="field-help">
              In Google Calendar, choose <strong>Other calendars</strong> →{" "}
              <strong>From URL</strong> and paste this address. Use the Subscribe button for
              calendar apps that support webcal.
            </p>
            {copyState === "error" ? (
              <p className="notice notice--warning" role="status">
                Copy was blocked by the browser. Select the address and copy it manually.
              </p>
            ) : null}
          </div>
          {!confirmReset ? (
            <button
              className="button button--secondary"
              onClick={() => {
                setConfirmReset(true);
              }}
              type="button"
            >
              Reset calendar address
            </button>
          ) : (
            <div className="confirmation-panel" role="alert">
              <p>Reset now? Existing calendar subscriptions will stop updating immediately.</p>
              <div className="button-row">
                <button
                  className="button button--danger"
                  disabled={busy}
                  onClick={() => {
                    void resetCredential();
                  }}
                  type="button"
                >
                  {busy ? "Resetting…" : "Reset address"}
                </button>
                <button
                  className="button button--secondary"
                  disabled={busy}
                  onClick={() => {
                    setConfirmReset(false);
                  }}
                  type="button"
                >
                  Keep current address
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </fieldset>
  );
}
