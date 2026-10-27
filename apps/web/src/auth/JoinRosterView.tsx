import type {
  RosterInviteConfiguredPart,
  RosterInviteConfiguredSection,
  RosterInvitePreviewResponse,
} from "@choir/contracts";
import { useCallback, useEffect, useId, useMemo, useState, type SyntheticEvent } from "react";

import {
  AuthApiError,
  getCurrentSession,
  getRosterInviteEnrollmentStatus,
  getRosterInviteOptions,
  previewRosterInvite,
  redeemRosterInvite,
  signInWithCode,
  startRosterInvite,
} from "../api";

type JoinStep =
  | "checking"
  | "invalid_link"
  | "enter_email"
  | "enter_otp"
  | "fill_profile"
  | "review_required"
  | "already_enrolled"
  | "submitting"
  | "success";

function extractInviteToken(): string | null {
  const hash = window.location.hash;
  if (hash.includes("token=")) {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const token = params.get("token");
    if (token) return token;
  }
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get("token");
}

// eslint-disable-next-line complexity -- multi-step self-service invite onboarding
export function JoinRosterView() {
  const token = useMemo(() => extractInviteToken(), []);

  const [step, setStep] = useState<JoinStep>(() => (token ? "checking" : "invalid_link"));
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    token ? null : "No invite link token was provided. Please check the link from your choir.",
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [preview, setPreview] = useState<RosterInvitePreviewResponse | null>(null);

  // Auth bootstrap state
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  // Profile selection state
  const [sections, setSections] = useState<readonly RosterInviteConfiguredSection[]>([]);
  const [voiceParts, setVoiceParts] = useState<readonly RosterInviteConfiguredPart[]>([]);
  const [performerLabel, setPerformerLabel] = useState("Voice Part");
  const [displayName, setDisplayName] = useState("");
  const [matchingProfile, setMatchingProfile] = useState<{
    readonly displayName: string;
    readonly voicePart: string;
  } | null>(null);
  const [selectedVoicePart, setSelectedVoicePart] = useState("");
  const [phone, setPhone] = useState("");
  const [showInDirectory, setShowInDirectory] = useState(true);
  const [isRedeeming, setIsRedeeming] = useState(false);

  // Accessibility IDs
  const emailInputId = useId();
  const otpInputId = useId();
  const nameInputId = useId();
  const voicePartSelectId = useId();
  const phoneInputId = useId();
  const directoryCheckboxId = useId();

  // OTP resend countdown
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown((prev) => prev - 1);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [resendCountdown]);

  const loadOptionsAndProceed = useCallback(async (activeToken: string): Promise<void> => {
    setErrorMessage(null);
    try {
      const options = await getRosterInviteOptions(activeToken);
      setSections(options.sections);
      setVoiceParts(options.voiceParts);
      setPerformerLabel(
        options.rosterStructure === "sections_only" ? "Section" : options.performerLabel || "Part",
      );

      if (options.alreadyEnrolled) {
        setStep("already_enrolled");
        return;
      }

      if (options.profileMatchStatus === "review_required") {
        setStep("review_required");
        return;
      }

      setMatchingProfile(options.matchingProfile);
      if (options.matchingProfile) {
        setDisplayName(options.matchingProfile.displayName);
        setSelectedVoicePart(options.matchingProfile.voicePart || "Existing Profile");
        setStep("fill_profile");
        return;
      }

      const existingName = options.existingProfile?.displayName;
      if (existingName) {
        setDisplayName((current) => (current ? current : existingName));
      }
      const firstPart = options.voiceParts[0]?.label;
      if (firstPart) {
        setSelectedVoicePart((current) => (current ? current : firstPart));
      }
      setStep("fill_profile");
    } catch (err: unknown) {
      if (err instanceof AuthApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Could not load choir registration options.");
      }
    }
  }, []);

  // Initial load: validate token and check preview
  useEffect(() => {
    if (!token) return;
    const activeToken = token;
    const controller = new AbortController();

    void (async () => {
      try {
        const [previewResult, session] = await Promise.all([
          previewRosterInvite(activeToken),
          getCurrentSession().catch(() => null),
        ]);
        if (controller.signal.aborted) return;
        setPreview(previewResult);

        if (session?.user) {
          if (session.user.name) {
            setDisplayName(session.user.name);
          }
          await loadOptionsAndProceed(activeToken);
        } else {
          setStep("enter_email");
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setStep("invalid_link");
        if (err instanceof AuthApiError) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage("This invite link is invalid, expired, or unavailable.");
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [token, loadOptionsAndProceed]);

  async function handleSendEmail(e: SyntheticEvent): Promise<void> {
    e.preventDefault();
    if (!token) return;
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setErrorMessage("Please enter your email address.");
      return;
    }

    setIsSendingCode(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await startRosterInvite(trimmedEmail, token);
      setEmail(trimmedEmail);
      setStep("enter_otp");
      setResendCountdown(30);
      setStatusMessage(`Verification code sent to ${trimmedEmail}. Check your inbox.`);
    } catch (err: unknown) {
      if (err instanceof AuthApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Could not send verification code. Please check your email address.");
      }
    } finally {
      setIsSendingCode(false);
    }
  }

  async function handleResendCode(): Promise<void> {
    if (!token || resendCountdown > 0 || isSendingCode) return;
    setIsSendingCode(true);
    setErrorMessage(null);
    try {
      await startRosterInvite(email, token);
      setResendCountdown(30);
      setStatusMessage(`A new verification code was sent to ${email}.`);
    } catch {
      setErrorMessage("Could not resend verification code. Please try again later.");
    } finally {
      setIsSendingCode(false);
    }
  }

  async function handleVerifyOtp(e: SyntheticEvent): Promise<void> {
    e.preventDefault();
    if (!token) return;
    const trimmedOtp = otp.trim();
    if (!trimmedOtp) {
      setErrorMessage("Please enter the verification code.");
      return;
    }

    setIsVerifyingCode(true);
    setErrorMessage(null);
    try {
      await signInWithCode(email, trimmedOtp);
      await loadOptionsAndProceed(token);
    } catch (err: unknown) {
      if (err instanceof AuthApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Invalid or expired verification code. Please try again.");
      }
    } finally {
      setIsVerifyingCode(false);
    }
  }

  async function pollEnrollmentStatus(enrollmentId: string): Promise<boolean> {
    const maxAttempts = 10;
    const delayMs = 1500;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });
      try {
        const check = await getRosterInviteEnrollmentStatus(enrollmentId);
        if (check.status === "completed") {
          return true;
        }
        if (check.status === "canceled") {
          return false;
        }
      } catch {
        // Retry polling on transient failure
      }
    }
    return false;
  }

  // eslint-disable-next-line complexity -- handles validation and pending, retry, and completion states
  async function handleRedeem(e: SyntheticEvent): Promise<void> {
    e.preventDefault();
    if (!token) return;

    const trimmedName = displayName.trim();
    if (!matchingProfile && !trimmedName) {
      setErrorMessage("Please enter your display name.");
      return;
    }
    if (!matchingProfile && !selectedVoicePart) {
      setErrorMessage(`Please select your ${performerLabel.toLowerCase()}.`);
      return;
    }

    setIsRedeeming(true);
    setErrorMessage(null);
    setStep("submitting");

    const idempotencyKey = `roster-join-${crypto.randomUUID()}`;

    try {
      const result = await redeemRosterInvite({
        displayName: matchingProfile?.displayName ?? trimmedName,
        idempotencyKey,
        phone: matchingProfile ? "" : phone.trim(),
        showInDirectory: matchingProfile ? true : showInDirectory,
        token,
        // Empty stored voice parts need the non-empty request placeholder.
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        voicePart: matchingProfile?.voicePart || selectedVoicePart,
      });

      if (result.status === "completed") {
        setStep("success");
      } else if (result.status === "already_enrolled") {
        setStep("already_enrolled");
      } else {
        // Pending state: poll enrollment status
        const completed = await pollEnrollmentStatus(result.enrollmentId);
        if (completed) {
          setStep("success");
        } else {
          setStep("fill_profile");
          setErrorMessage(
            "Registration is taking longer than usual. Please refresh to check your membership.",
          );
        }
      }
    } catch (err: unknown) {
      if (err instanceof AuthApiError) {
        if (err.code === "profile_match_requires_review") {
          setErrorMessage(null);
          setStep("review_required");
        } else {
          setStep("fill_profile");
          setErrorMessage(err.message);
        }
      } else {
        setStep("fill_profile");
        setErrorMessage("Could not complete roster enrollment. Please try again.");
      }
    } finally {
      setIsRedeeming(false);
    }
  }

  if (step === "checking") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="join-loading-title" className="auth-card">
          <h1 id="join-loading-title">Verifying invite link…</h1>
          <p role="status">Checking organization invite details…</p>
        </section>
      </main>
    );
  }

  if (step === "invalid_link") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="join-invalid-title" className="auth-card">
          <h1 id="join-invalid-title">Invite link unavailable</h1>
          {errorMessage ? (
            <p className="notice notice--error" role="alert">
              {errorMessage}
            </p>
          ) : (
            <p className="notice notice--error" role="alert">
              This invite link is invalid, expired, or has reached its capacity limit.
            </p>
          )}
          <a className="button button--secondary" href="/">
            Return home
          </a>
        </section>
      </main>
    );
  }

  if (step === "already_enrolled") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="already-enrolled-title" className="auth-card">
          <h1 id="already-enrolled-title">You are already a member</h1>
          <p className="notice notice--success" role="status">
            You are already registered on the roster for {preview?.organizationName ?? "this choir"}
            .
          </p>
          <a className="button button--primary" href="/account">
            Go to choir dashboard
          </a>
        </section>
      </main>
    );
  }

  if (step === "review_required") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="profile-review-title" className="auth-card">
          <h1 id="profile-review-title">Ask an Organization administrator for help</h1>
          <p className="notice notice--warning" role="status">
            We found a roster record that needs review before this invitation can be completed. Your
            account and the roster record have not been linked.
          </p>
          {errorMessage ? (
            <p className="notice notice--error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <button
            className="button button--secondary"
            onClick={() => {
              if (token) void loadOptionsAndProceed(token);
            }}
            type="button"
          >
            Check again
          </button>
          <a className="button button--secondary" href="/">
            Return home
          </a>
        </section>
      </main>
    );
  }

  if (step === "success") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="join-success-title" className="auth-card">
          <h1 id="join-success-title">Welcome to {preview?.organizationName}!</h1>
          <p className="notice notice--success" role="status">
            {matchingProfile
              ? "You have successfully joined. Your existing roster Profile and history were preserved."
              : "You have successfully joined the roster. Your profile is active and your voice part is set."}
          </p>
          <a className="button button--primary" href="/account">
            Go to choir dashboard
          </a>
        </section>
      </main>
    );
  }

  if (step === "submitting") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="join-submitting-title" className="auth-card">
          <h1 id="join-submitting-title">Joining {preview?.organizationName}…</h1>
          <p role="status">Finalizing your roster membership and choir profile…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-layout">
      <section aria-labelledby="join-roster-title" className="auth-card">
        <h1 id="join-roster-title">Join {preview?.organizationName}</h1>

        {errorMessage ? (
          <p className="notice notice--error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {statusMessage ? (
          <p className="notice notice--success" role="status">
            {statusMessage}
          </p>
        ) : null}

        {step === "enter_email" ? (
          <form
            autoComplete="on"
            noValidate
            onSubmit={(e) => {
              void handleSendEmail(e);
            }}
          >
            <p style={{ marginBottom: "1rem" }}>
              Enter your email address to get started and receive a one-time verification code.
            </p>
            <div className="field">
              <label htmlFor={emailInputId}>Email address</label>
              <input
                autoComplete="email"
                id={emailInputId}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
            </div>
            <div className="form-actions form-actions--end">
              <button className="button button--primary" disabled={isSendingCode} type="submit">
                {isSendingCode ? "Sending code…" : "Continue with email"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "enter_otp" ? (
          <form
            autoComplete="off"
            noValidate
            onSubmit={(e) => {
              void handleVerifyOtp(e);
            }}
          >
            <p style={{ marginBottom: "1rem" }}>
              We sent a verification code to <strong>{email}</strong>. Enter the code below to
              continue.
            </p>
            <div className="field">
              <label htmlFor={otpInputId}>Verification code</label>
              <input
                autoComplete="one-time-code"
                id={otpInputId}
                inputMode="numeric"
                maxLength={8}
                onChange={(e) => {
                  setOtp(e.target.value);
                }}
                placeholder="e.g. 123456"
                required
                value={otp}
              />
            </div>
            <div
              style={{
                alignItems: "center",
                display: "flex",
                justifyContent: "space-between",
                marginTop: "1.5rem",
              }}
            >
              <button
                className="button button--secondary"
                disabled={resendCountdown > 0 || isSendingCode}
                onClick={() => {
                  void handleResendCode();
                }}
                type="button"
              >
                {resendCountdown > 0 ? `Resend code (${String(resendCountdown)}s)` : "Resend code"}
              </button>
              <button className="button button--primary" disabled={isVerifyingCode} type="submit">
                {isVerifyingCode ? "Verifying…" : "Confirm code"}
              </button>
            </div>
          </form>
        ) : null}

        {step === "fill_profile" ? (
          <form
            autoComplete="off"
            noValidate
            onSubmit={(e) => {
              void handleRedeem(e);
            }}
          >
            {matchingProfile ? (
              <p className="notice notice--info" role="status">
                Joining will connect your account to your existing roster profile for{" "}
                <strong>{matchingProfile.displayName}</strong>. Your saved Profile information and
                history will be preserved.
              </p>
            ) : (
              <p style={{ marginBottom: "1rem" }}>
                Choose your {performerLabel.toLowerCase()} and set your roster preferences to
                complete registration.
              </p>
            )}

            {!matchingProfile ? (
              <div className="form-stack">
                <div className="field">
                  <label htmlFor={nameInputId}>Your name</label>
                  <input
                    id={nameInputId}
                    maxLength={100}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                    }}
                    placeholder="e.g. Alice Singer"
                    required
                    value={displayName}
                  />
                </div>

                <div className="field">
                  <label htmlFor={voicePartSelectId}>{performerLabel}</label>
                  <select
                    id={voicePartSelectId}
                    onChange={(e) => {
                      setSelectedVoicePart(e.target.value);
                    }}
                    required
                    value={selectedVoicePart}
                  >
                    {sections.length > 0
                      ? sections.map((sec) => {
                          const secParts = voiceParts.filter((p) => p.sectionCode === sec.code);
                          if (secParts.length === 0) return null;
                          return (
                            <optgroup key={sec.code} label={sec.name}>
                              {secParts.map((p) => (
                                <option key={p.label} value={p.label}>
                                  {p.fullName || p.label}
                                </option>
                              ))}
                            </optgroup>
                          );
                        })
                      : voiceParts.map((p) => (
                          <option key={p.label} value={p.label}>
                            {p.fullName || p.label}
                          </option>
                        ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor={phoneInputId}>Phone number (optional)</label>
                  <input
                    autoComplete="tel"
                    id={phoneInputId}
                    maxLength={50}
                    onChange={(e) => {
                      setPhone(e.target.value);
                    }}
                    placeholder="e.g. (555) 123-4567"
                    type="tel"
                    value={phone}
                  />
                </div>

                <label className="choice-field">
                  <input
                    checked={showInDirectory}
                    id={directoryCheckboxId}
                    onChange={(e) => {
                      setShowInDirectory(e.target.checked);
                    }}
                    type="checkbox"
                  />
                  <span className="choice-field__content">
                    Show my contact info in member directory
                  </span>
                </label>
              </div>
            ) : null}

            <div className="form-actions form-actions--end">
              <button className="button button--primary" disabled={isRedeeming} type="submit">
                {isRedeeming
                  ? "Joining…"
                  : matchingProfile
                    ? "Join with existing profile"
                    : "Join roster"}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </main>
  );
}
