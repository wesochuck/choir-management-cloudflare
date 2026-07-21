import { useState } from "react";

import { requestPasswordReset } from "./api";

export function ForgotPasswordView() {
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requested, setRequested] = useState(false);

  async function submitRequest() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMessage("Enter the email address for your invited account.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await requestPasswordReset(normalizedEmail);
      setEmail("");
      setRequested(true);
    } catch {
      setErrorMessage("A reset link could not be requested. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="forgot-password-title">
        <p className="eyebrow">Account recovery</p>
        <h1 id="forgot-password-title">Reset your password.</h1>
        <p className="auth-card__intro">
          Enter the email address for your invited account. If it is eligible, we will send a
          single-use link that expires in 30 minutes.
        </p>

        {requested ? (
          <>
            <p className="notice notice--success" role="status">
              If that email belongs to an invited account, a password reset link is on its way.
            </p>
            <a className="button button--primary" href="/login">
              Return to sign in
            </a>
          </>
        ) : (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRequest();
            }}
          >
            {errorMessage ? (
              <p className="notice notice--error" role="alert">
                {errorMessage}
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="recovery-email">Email address</label>
              <input
                autoComplete="email"
                id="recovery-email"
                inputMode="email"
                name="email"
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                required
                type="email"
                value={email}
              />
            </div>
            <button className="button button--primary" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Requesting reset link…" : "Send reset link"}
            </button>
            <a className="text-link" href="/login">
              Return to sign in
            </a>
          </form>
        )}
      </section>
    </main>
  );
}
