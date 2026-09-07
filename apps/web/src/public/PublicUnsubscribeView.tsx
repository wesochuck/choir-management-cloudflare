import { useEffect, useState } from "react";

import { unsubscribeOrganizationEmail } from "../auth/api";

type UnsubscribeState = "invalid" | "processing" | "success" | "error";

export function PublicUnsubscribeView({ token }: { readonly token: string | null | undefined }) {
  // Never strip or clear the `token` query parameter (no replaceState):
  // reloads, background-tab restores, and bookmarks must keep working.
  const currentToken = typeof token === "string" && token.length > 0 ? token : null;
  const [state, setState] = useState<UnsubscribeState>(currentToken ? "processing" : "invalid");

  useEffect(() => {
    if (!currentToken) return;
    unsubscribeOrganizationEmail(currentToken)
      .then(() => {
        setState("success");
      })
      .catch(() => {
        setState("error");
      });
  }, [currentToken]);

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="unsubscribe-title">
        <h1 id="unsubscribe-title">Unsubscribe from Organization email</h1>
        {state === "processing" ? (
          <p className="notice notice--info" role="status">
            Updating your email preference…
          </p>
        ) : null}
        {state === "success" ? (
          <p className="notice notice--success" role="status">
            You have been unsubscribed from future Organization campaign email. Essential account
            and security messages are managed separately.
          </p>
        ) : null}
        {state === "invalid" || state === "error" ? (
          <p className="notice notice--error" role="alert">
            This unsubscribe link is invalid or expired. Contact an Organization manager if you need
            help updating your email preference.
          </p>
        ) : null}
        <a className="button button--secondary" href="/">
          Return to the Organization site
        </a>
      </section>
    </main>
  );
}
