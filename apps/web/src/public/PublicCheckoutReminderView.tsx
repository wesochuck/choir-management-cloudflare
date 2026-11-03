import { useEffect, useState } from "react";
import { checkoutRecoveryChoicesSchema, type CheckoutRecoveryChoices } from "@choir/contracts";
import { request, requestJson } from "../api/client";
import { PublicDonationView } from "./PublicDonationView";
import { PublicTickets } from "./PublicTickets";

export function PublicCheckoutReminderView({ stop = false }: { readonly stop?: boolean }) {
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token"));
  const [choices, setChoices] = useState<CheckoutRecoveryChoices | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "busy" | "success" | "error">(
    stop ? "ready" : "loading",
  );
  useEffect(() => {
    if (stop) return;
    const controller = new AbortController();
    requestJson(
      `/api/public/checkout-reminders/recovery?token=${encodeURIComponent(token ?? "")}`,
      checkoutRecoveryChoicesSchema,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setChoices(value);
          setState("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => {
      controller.abort();
    };
  }, [stop, token]);
  async function unsubscribe() {
    setState("busy");
    try {
      await request("/api/public/checkout-reminders/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setState("success");
    } catch {
      setState("error");
    }
  }
  if (stop)
    return (
      <main className="auth-layout">
        <section className="auth-card">
          <h1>Stop checkout reminders</h1>
          {state === "success" ? (
            <p role="status">
              You will no longer receive incomplete ticket or donation checkout reminders from this
              Organization. Receipts, ticket confirmations, and newsletter preferences stay
              separate.
            </p>
          ) : (
            <>
              <p>
                Stop future incomplete ticket and donation checkout reminders from this Organization
                for this email address.
              </p>
              {state === "error" ? (
                <p role="alert">
                  This link is unavailable or expired. Please contact the Organization for help.
                </p>
              ) : null}
              <button
                className="button button--primary"
                type="button"
                disabled={!token || state === "busy"}
                onClick={() => {
                  void unsubscribe();
                }}
              >
                Stop these reminders
              </button>
            </>
          )}
          <a href="/">Return to the Organization site</a>
        </section>
      </main>
    );
  return (
    <main className="public-main">
      <section className="public-section">
        <h1>Review your unfinished checkout</h1>
        <p>
          Review current prices, availability, and terms before continuing. Nothing has been charged
          by opening this page.
        </p>
        {state === "loading" ? <p role="status">Loading your choices…</p> : null}
        {state === "error" ? (
          <>
            <p role="alert">
              This return link is unavailable or expired. You can start again using the current
              options.
            </p>
            <p>
              <a href="/tickets">View tickets</a> · <a href="/donate">Make a donation</a>
            </p>
          </>
        ) : null}
        {choices ? <RecoveredCheckout choices={choices} /> : null}
      </section>
    </main>
  );
}

function RecoveredCheckout({ choices }: { readonly choices: CheckoutRecoveryChoices }) {
  if (choices.kind === "donation") return <PublicDonationView recovery={choices} />;
  const pathname = choices.bundleId
    ? `/tickets/bundles/${choices.bundleId}`
    : `/tickets/${choices.eventIds[0] ?? ""}`;
  return (
    <>
      <p>
        <a href="/tickets">Choose other tickets</a>
      </p>
      <PublicTickets embedded recovery={choices} pathname={pathname} />
    </>
  );
}
