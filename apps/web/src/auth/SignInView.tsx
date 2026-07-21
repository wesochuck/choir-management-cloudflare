import { useState } from "react";

import { requestSignInCode, signInWithCode } from "./api";

interface SignInViewProps {
  readonly onSignedIn: () => void;
}

type SignInStep = "code" | "email";

export function SignInView({ onSignedIn }: SignInViewProps) {
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<SignInStep>("email");

  async function sendCode() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMessage("Enter the email address on your invitation.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await requestSignInCode(normalizedEmail);
      setEmail(normalizedEmail);
      setOtp("");
      setStep("code");
    } catch {
      setErrorMessage("A sign-in code could not be requested. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyCode() {
    const normalizedCode = otp.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setErrorMessage("Enter the 6-digit code from your email.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await signInWithCode(email, normalizedCode);
      onSignedIn();
    } catch {
      setErrorMessage("That code is invalid or expired. Request a new code and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="sign-in-title">
        <p className="eyebrow">Invitation-only access</p>
        <h1 id="sign-in-title">Sign in to Choir Management.</h1>
        <p className="auth-card__intro">
          Use the email address connected to your Organization Membership. We will send a secure,
          single-use code.
        </p>

        {errorMessage ? (
          <p className="notice notice--error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {step === "email" ? (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void sendCode();
            }}
          >
            <div className="field">
              <label htmlFor="sign-in-email">Email address</label>
              <input
                autoComplete="email"
                id="sign-in-email"
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
              {isSubmitting ? "Sending code…" : "Send sign-in code"}
            </button>
          </form>
        ) : (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void verifyCode();
            }}
          >
            <p className="notice notice--info" role="status">
              If <strong>{email}</strong> has access, a 6-digit code is on its way.
            </p>
            <div className="field">
              <label htmlFor="sign-in-code">6-digit sign-in code</label>
              <input
                autoComplete="one-time-code"
                id="sign-in-code"
                inputMode="numeric"
                maxLength={6}
                name="otp"
                onChange={(event) => {
                  setOtp(event.target.value.replace(/\D/g, "").slice(0, 6));
                }}
                pattern="[0-9]{6}"
                required
                value={otp}
              />
            </div>
            <button className="button button--primary" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Signing in…" : "Sign in"}
            </button>
            <div className="form-actions">
              <button
                className="text-button"
                disabled={isSubmitting}
                onClick={() => {
                  setErrorMessage(null);
                  setStep("email");
                }}
                type="button"
              >
                Use a different email
              </button>
              <button
                className="text-button"
                disabled={isSubmitting}
                onClick={() => {
                  setErrorMessage(null);
                  setStep("email");
                }}
                type="button"
              >
                Request a new code
              </button>
            </div>
          </form>
        )}

        <p className="auth-card__help">
          No invitation yet? Ask an Organization Owner or Administrator to add your access.
        </p>
      </section>
    </main>
  );
}
