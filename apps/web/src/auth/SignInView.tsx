import { useEffect, useState } from "react";

import {
  requestSignInCode,
  signInWithCode,
  signInWithPassword,
  verifyPasswordSignInSecondFactor,
} from "./api";
import { isConditionalMediationSupported, signInWithPasskey } from "./passkeyClient";

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

// eslint-disable-next-line complexity -- SignInView coordinates multi-step authentication (passkeys, credentials, code, password, and two-factor MFA).
export function SignInView({ onSignedIn }: SignInViewProps) {
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [method, setMethod] = useState<SignInMethod>("email_code");
  const [otp, setOtp] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyNotice, setPasskeyNotice] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [secondFactor, setSecondFactor] = useState("");
  const [secondFactorMethod, setSecondFactorMethod] = useState<PasswordSecondFactor>("totp");
  const [step, setStep] = useState<SignInStep>("credentials");
  const [resendCountdown, setResendCountdown] = useState(0);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const secondFactorField = secondFactorFieldSettings(secondFactorMethod);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown((prev) => prev - 1);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [resendCountdown]);

  useEffect(() => {
    let active = true;
    void isConditionalMediationSupported().then((supported) => {
      if (supported && active && step === "credentials") {
        void signInWithPasskey({ autoFill: true }).then((result) => {
          if (result.success && active) {
            onSignedIn();
          }
        });
      }
    });
    return () => {
      active = false;
    };
  }, [onSignedIn, step]);

  function selectMethod(nextMethod: SignInMethod) {
    setErrorMessage(null);
    setPasskeyNotice(null);
    setResendStatus(null);
    setMethod(nextMethod);
    setOtp("");
    setPassword("");
    setSecondFactor("");
    setStep("credentials");
  }

  async function handlePasskeySignIn() {
    setErrorMessage(null);
    setPasskeyNotice(null);
    setPasskeyBusy(true);
    try {
      const result = await signInWithPasskey();
      if (result.success) {
        onSignedIn();
        return;
      }
      if (result.canceled) {
        return;
      }
      if (result.error) {
        const lower = result.error.toLowerCase();
        if (
          lower.includes("not found") ||
          lower.includes("no passkey") ||
          lower.includes("unrecognized") ||
          lower.includes("no credentials")
        ) {
          setPasskeyNotice(
            "No passkey was found for this device. Sign in with an email code below.",
          );
        } else {
          setErrorMessage(result.error);
        }
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function sendCode() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMessage("Enter the email address on your invitation.");
      return;
    }

    setErrorMessage(null);
    setResendStatus(null);
    setIsSubmitting(true);
    try {
      await requestSignInCode(normalizedEmail);
      setEmail(normalizedEmail);
      setOtp("");
      setResendCountdown(30);
      setStep("code");
    } catch {
      setErrorMessage("A sign-in code could not be requested. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resendCode() {
    if (resendCountdown > 0 || isSubmitting) return;
    setErrorMessage(null);
    setResendStatus(null);
    setIsSubmitting(true);
    try {
      await requestSignInCode(email);
      setResendCountdown(30);
      setResendStatus("A new 6-digit code has been dispatched to your email.");
    } catch {
      setErrorMessage("A new code could not be requested. Please try again.");
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
        <h1 id="sign-in-title">Sign in to Choir Management.</h1>
        <p className="auth-card__intro">
          This site is invitation-only. Passkey is the preferred sign-in method. You can also sign
          in with an email code, or use an optional password.
        </p>

        {step === "credentials" ? (
          <div className="auth-hero-action">
            <button
              className="button button--primary auth-passkey-button"
              disabled={isSubmitting || passkeyBusy}
              onClick={() => {
                void handlePasskeySignIn();
              }}
              type="button"
            >
              {passkeyBusy ? "Verifying passkey…" : "Sign in with a passkey"}
            </button>
          </div>
        ) : null}

        {step === "credentials" ? (
          <div className="auth-divider" role="separator" aria-label="Alternative sign-in options">
            <span>or sign in with email</span>
          </div>
        ) : null}

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

        {passkeyNotice ? (
          <p className="notice notice--info" role="status">
            {passkeyNotice}
          </p>
        ) : null}

        {errorMessage ? (
          <p className="notice notice--error" id="sign-in-error" role="alert">
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
                aria-describedby={errorMessage ? "sign-in-error" : undefined}
                aria-invalid={Boolean(errorMessage)}
                autoComplete="username webauthn"
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
                aria-describedby={errorMessage ? "sign-in-error" : undefined}
                aria-invalid={Boolean(errorMessage)}
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
                aria-describedby={errorMessage ? "sign-in-error" : undefined}
                aria-invalid={Boolean(errorMessage)}
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
                aria-describedby={errorMessage ? "sign-in-error" : undefined}
                aria-invalid={Boolean(errorMessage)}
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
            {resendStatus ? (
              <p className="notice notice--info" role="status">
                {resendStatus}
              </p>
            ) : null}
            <div className="form-actions">
              <button
                className="text-button"
                disabled={isSubmitting}
                onClick={() => {
                  setErrorMessage(null);
                  setResendStatus(null);
                  setStep("credentials");
                }}
                type="button"
              >
                Use a different email
              </button>
              <button
                className="text-button"
                disabled={isSubmitting || resendCountdown > 0}
                onClick={() => {
                  void resendCode();
                }}
                type="button"
              >
                {resendCountdown > 0
                  ? `Request new code (${String(resendCountdown)}s)`
                  : "Request a new code"}
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
                aria-describedby={errorMessage ? "sign-in-error" : undefined}
                aria-invalid={Boolean(errorMessage)}
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
