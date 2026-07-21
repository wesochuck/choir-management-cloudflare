import { useState } from "react";

import {
  requestSignInCode,
  signInWithCode,
  signInWithPassword,
  verifyPasswordSignInSecondFactor,
} from "./api";

interface SignInViewProps {
  readonly onSignedIn: () => void;
}

type PasswordSecondFactor = "recovery_code" | "totp";
type SignInMethod = "email_code" | "password";
type SignInStep = "code" | "credentials" | "password_mfa";

interface SecondFactorFieldSettings {
  readonly inputMode: "numeric" | "text";
  readonly label: string;
  readonly maxLength: number;
  readonly normalize: (value: string) => string;
}

function parseSecondFactorMethod(value: string): PasswordSecondFactor {
  return value === "recovery_code" ? "recovery_code" : "totp";
}

function secondFactorValidationError(method: PasswordSecondFactor, code: string): string | null {
  if (method === "totp" && !/^\d{6}$/.test(code)) {
    return "Enter the 6-digit code from your authenticator app.";
  }
  if (method === "recovery_code" && !code) {
    return "Enter one of your recovery codes.";
  }
  return null;
}

function secondFactorFieldSettings(method: PasswordSecondFactor): SecondFactorFieldSettings {
  if (method === "recovery_code") {
    return {
      inputMode: "text",
      label: "Recovery code",
      maxLength: 128,
      normalize: (value: string) => value,
    };
  }
  return {
    inputMode: "numeric",
    label: "6-digit authenticator code",
    maxLength: 6,
    normalize: (value: string) => value.replace(/\D/g, "").slice(0, 6),
  };
}

export function SignInView({ onSignedIn }: SignInViewProps) {
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [method, setMethod] = useState<SignInMethod>("email_code");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [secondFactor, setSecondFactor] = useState("");
  const [secondFactorMethod, setSecondFactorMethod] = useState<PasswordSecondFactor>("totp");
  const [step, setStep] = useState<SignInStep>("credentials");
  const secondFactorField = secondFactorFieldSettings(secondFactorMethod);

  function selectMethod(nextMethod: SignInMethod) {
    setErrorMessage(null);
    setMethod(nextMethod);
    setOtp("");
    setPassword("");
    setSecondFactor("");
    setStep("credentials");
  }

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

  async function submitPassword() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setErrorMessage("Enter your invited email address and password.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const result = await signInWithPassword(normalizedEmail, password);
      setEmail(normalizedEmail);
      setPassword("");
      if (result === "two_factor_required") {
        setSecondFactor("");
        setStep("password_mfa");
      } else {
        onSignedIn();
      }
    } catch {
      setErrorMessage("The email address or password is incorrect.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifySecondFactor() {
    const normalizedCode = secondFactor.trim();
    const validationError = secondFactorValidationError(secondFactorMethod, normalizedCode);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await verifyPasswordSignInSecondFactor(secondFactorMethod, normalizedCode);
      setSecondFactor("");
      onSignedIn();
    } catch {
      setErrorMessage("That verification code is invalid or expired. Try again.");
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
          Use the email address connected to your Organization Membership. Email code is the primary
          sign-in method.
        </p>

        {step === "credentials" ? (
          <div className="auth-methods" aria-label="Sign-in method" role="group">
            <button
              aria-pressed={method === "email_code"}
              className="text-button"
              onClick={() => {
                selectMethod("email_code");
              }}
              type="button"
            >
              Email code
            </button>
            <button
              aria-pressed={method === "password"}
              className="text-button"
              onClick={() => {
                selectMethod("password");
              }}
              type="button"
            >
              Password
            </button>
          </div>
        ) : null}

        {errorMessage ? (
          <p className="notice notice--error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {step === "credentials" && method === "email_code" ? (
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
        ) : null}

        {step === "credentials" && method === "password" ? (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void submitPassword();
            }}
          >
            <div className="field">
              <label htmlFor="password-sign-in-email">Email address</label>
              <input
                autoComplete="email"
                id="password-sign-in-email"
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
            <div className="field">
              <label htmlFor="sign-in-password">Password</label>
              <input
                autoComplete="current-password"
                id="sign-in-password"
                maxLength={128}
                name="password"
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                required
                type="password"
                value={password}
              />
            </div>
            <button className="button button--primary" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Signing in…" : "Sign in with password"}
            </button>
            <a className="text-link" href="/forgot-password">
              Forgot your password?
            </a>
          </form>
        ) : null}

        {step === "code" ? (
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
                  setStep("credentials");
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
                  setStep("credentials");
                }}
                type="button"
              >
                Request a new code
              </button>
            </div>
          </form>
        ) : null}

        {step === "password_mfa" ? (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void verifySecondFactor();
            }}
          >
            <p className="notice notice--info" role="status">
              Complete two-factor sign-in for {email}.
            </p>
            <div className="field">
              <label htmlFor="password-second-factor-method">Verification method</label>
              <select
                id="password-second-factor-method"
                onChange={(event) => {
                  setErrorMessage(null);
                  setSecondFactor("");
                  setSecondFactorMethod(parseSecondFactorMethod(event.target.value));
                }}
                value={secondFactorMethod}
              >
                <option value="totp">Authenticator code</option>
                <option value="recovery_code">Recovery code</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="password-second-factor">{secondFactorField.label}</label>
              <input
                autoComplete="one-time-code"
                id="password-second-factor"
                inputMode={secondFactorField.inputMode}
                maxLength={secondFactorField.maxLength}
                onChange={(event) => {
                  setSecondFactor(secondFactorField.normalize(event.target.value));
                }}
                required
                value={secondFactor}
              />
            </div>
            <button className="button button--primary" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Verifying…" : "Verify and sign in"}
            </button>
            <button
              className="text-button"
              disabled={isSubmitting}
              onClick={() => {
                selectMethod("password");
              }}
              type="button"
            >
              Cancel password sign-in
            </button>
          </form>
        ) : null}

        <p className="auth-card__help">
          No invitation yet? Ask an Organization Owner or Administrator to add your access.
        </p>
      </section>
    </main>
  );
}
