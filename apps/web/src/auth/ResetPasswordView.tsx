import { useState } from "react";

import { resetPassword } from "./api";

function validResetToken(value: string | null): value is string {
  return (
    value !== null && value.length >= 16 && value.length <= 256 && /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

interface ResetPasswordViewProps {
  readonly error: string | null;
  readonly token: string | null;
}

export function ResetPasswordView({ error, token }: ResetPasswordViewProps) {
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState("");
  const [succeeded, setSucceeded] = useState(false);
  const canReset = error === null && validResetToken(token);

  async function submitReset() {
    if (!canReset) {
      return;
    }
    if (password.length < 12 || password.length > 128) {
      setErrorMessage("Use a password between 12 and 128 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("The passwords do not match.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await resetPassword(token, password);
      setConfirmPassword("");
      setPassword("");
      setSucceeded(true);
    } catch {
      setErrorMessage("This reset link is invalid, expired, or has already been used.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="reset-password-title">
        <h1 id="reset-password-title">Choose a new password.</h1>

        {!canReset ? (
          <>
            <p className="notice notice--error" role="alert">
              This reset link is invalid or expired. Request a new link to continue.
            </p>
            <a className="button button--primary" href="/forgot-password">
              Request a new link
            </a>
          </>
        ) : succeeded ? (
          <>
            <p className="notice notice--success" role="status">
              Your password was reset. Other signed-in sessions have been ended.
            </p>
            <a className="button button--primary" href="/login">
              Sign in
            </a>
          </>
        ) : (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void submitReset();
            }}
          >
            <p className="auth-card__intro">
              Use 12 to 128 characters. This single-use link expires after 30 minutes.
            </p>
            {errorMessage ? (
              <p className="notice notice--error" role="alert">
                {errorMessage}
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="reset-password">New password</label>
              <input
                autoComplete="new-password"
                id="reset-password"
                maxLength={128}
                minLength={12}
                name="password"
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                required
                type="password"
                value={password}
              />
            </div>
            <div className="field">
              <label htmlFor="reset-password-confirmation">Confirm new password</label>
              <input
                autoComplete="new-password"
                id="reset-password-confirmation"
                maxLength={128}
                minLength={12}
                name="passwordConfirmation"
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                }}
                required
                type="password"
                value={confirmPassword}
              />
            </div>
            <button className="button button--primary" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Resetting password…" : "Reset password"}
            </button>
            <a className="text-link" href="/login">
              Cancel and return to sign in
            </a>
          </form>
        )}
      </section>
    </main>
  );
}
