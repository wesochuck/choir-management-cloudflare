import { useEffect, useState } from "react";

import { confirmMemberEmailChange } from "./api";

type ConfirmationState = "error" | "invalid" | "processing" | "success";

function validEmailChangeToken(value: string | null): value is string {
  return (
    value !== null && value.length >= 16 && value.length <= 4096 && /^[A-Za-z0-9._-]+$/.test(value)
  );
}

export function EmailChangeConfirmationView({ token }: { readonly token: string | null }) {
  const [email, setEmail] = useState<string | null>(null);
  const [state, setState] = useState<ConfirmationState>(
    validEmailChangeToken(token) ? "processing" : "invalid",
  );

  useEffect(() => {
    window.history.replaceState(null, "", "/confirm-email-change");
    if (!validEmailChangeToken(token)) return;
    const currentToken = token;
    confirmMemberEmailChange(currentToken)
      .then(({ email: confirmedEmail }) => {
        setEmail(confirmedEmail);
        setState("success");
      })
      .catch(() => {
        setState("error");
      });
  }, [token]);

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="confirm-email-change-title">
        <h1 id="confirm-email-change-title">Confirm your email address</h1>
        {state === "processing" ? (
          <p className="notice notice--info" role="status">
            Confirming your new sign-in email…
          </p>
        ) : null}
        {state === "success" ? (
          <>
            <p className="notice notice--success" role="status">
              Your sign-in email is now {email}. We sent confirmation notices to both addresses.
            </p>
            <a className="button button--primary" href="/profile">
              Return to your Profile
            </a>
          </>
        ) : null}
        {state === "invalid" || state === "error" ? (
          <>
            <p className="notice notice--error" role="alert">
              This email change link is invalid, expired, or has already been used. Request a new
              link from your Profile if you still need to change your email.
            </p>
            <a className="button button--secondary" href="/profile">
              Return to your Profile
            </a>
          </>
        ) : null}
      </section>
    </main>
  );
}
