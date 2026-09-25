import { useEffect, useState } from "react";

import {
  requestSignInCode,
  signInWithCode,
  signInWithPassword,
  verifyPasswordSignInSecondFactor,
} from "./api";
import { mapOAuthErrorMessage, signInWithGoogle } from "./googleAuth";
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
  const [errorMessage, setErrorMessage] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const searchParams = new URLSearchParams(window.location.search);
    const oauthError = searchParams.get("error");
    return mapOAuthErrorMessage(oauthError);
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [method, setMethod] = useState<SignInMethod>("email_code");
  const [otp, setOtp] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyNotice, setPasskeyNotice] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [secondFactor, setSecondFactor] = useState("");
  const [secondFactorMethod, setSecondFactorMethod] = useState<PasswordSecondFactor>("totp");
  const [step, setStep] = useState<SignInStep>("credentials");
  const [resendCountdown, setResendCountdown] = useState(0);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const secondFactorField = secondFactorFieldSettings(secondFactorMethod);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const searchParams = new URLSearchParams(window.location.search);
    if (!searchParams.has("error") && !searchParams.has("oauth")) return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("error");
    nextUrl.searchParams.delete("error_description");
    nextUrl.searchParams.delete("oauth");
    const remainder = nextUrl.search ? nextUrl.search : "";
    window.history.replaceState(null, "", `${nextUrl.pathname}${remainder}${nextUrl.hash}`);
  }, []);

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

  async function handleGoogleSignIn() {
    setErrorMessage(null);
    setPasskeyNotice(null);
    setGoogleBusy(true);
    try {
      const result = await signInWithGoogle();
      if (!result.success && result.error) {
        setErrorMessage(result.error);
      }
    } finally {
      setGoogleBusy(false);
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
          in with Google or an email code, or use an optional password.
        </p>

        {step === "credentials" ? (
          <div className="auth-hero-action">
            <button
              className="button button--primary auth-passkey-button"
              disabled={isSubmitting || passkeyBusy || googleBusy}
              onClick={() => {
                void handlePasskeySignIn();
              }}
              type="button"
            >
              {passkeyBusy ? "Verifying passkey…" : "Sign in with a passkey"}
            </button>
            <button
              className="button button--secondary auth-google-button"
              disabled={isSubmitting || passkeyBusy || googleBusy}
              onClick={() => {
                void handleGoogleSignIn();
              }}
              type="button"
            >
              <span className="auth-google-button__icon" aria-hidden="true">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="#4285F4"
                    d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616Z"
                  />
                  <path
                    fill="#34A853"
                    d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58Z"
                  />
                </svg>
              </span>
              <span>{googleBusy ? "Connecting to Google…" : "Continue with Google"}</span>
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
