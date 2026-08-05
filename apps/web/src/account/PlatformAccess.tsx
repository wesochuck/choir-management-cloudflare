import type { PlatformContextResponse } from "@choir/contracts";
import { useEffect, useState, type ReactNode } from "react";

import {
  AuthApiError,
  beginAccountMfaEnrollment,
  confirmPlatformMfaEnrollment,
  getPlatformContext,
  getPlatformMfaStatus,
  regenerateAccountRecoveryCodes,
  verifyPlatformMfa,
  verifyAccountTotpEnrollment,
} from "../auth/api";
import { PlatformOperations } from "./PlatformOperations";

type AccessState =
  | { readonly status: "error" }
  | { readonly status: "hidden" }
  | { readonly status: "loading" }
  | { readonly status: "needs_enrollment"; readonly twoFactorEnabled: boolean }
  | { readonly status: "needs_verification" }
  | { readonly context: PlatformContextResponse; readonly status: "ready" };

interface EnrollmentSecrets {
  readonly backupCodes: readonly string[];
  readonly totpURI: string | null;
  readonly totpVerified: boolean;
}

interface PlatformSectionProps {
  readonly actionError: string | null;
  readonly children: ReactNode;
  readonly eyebrow?: string;
  readonly title?: string;
  readonly titleId?: string;
}

function PlatformSection({
  actionError,
  children,
  eyebrow = "Platform security",
  title = "Platform Administrator access",
  titleId = "platform-title",
}: PlatformSectionProps) {
  return (
    <section className="account-section account-section--platform" aria-labelledby={titleId}>
      <div className="section-heading section-heading--compact platform-section__heading">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
      </div>
      {actionError ? (
        <p className="notice notice--error" role="alert">
          {actionError}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function AuthenticatorSetup({ totpURI }: { readonly totpURI: string | null }) {
  if (!totpURI) {
    return (
      <div>
        <h3>Authenticator already enabled</h3>
        <p>These newly generated recovery codes replace any codes issued earlier.</p>
      </div>
    );
  }
  return (
    <div>
      <h3>1. Add the authenticator</h3>
      <p>
        Open this setup link on a device with your authenticator app. The setup secret is shown only
        in this in-memory enrollment view.
      </p>
      <a className="button button--secondary" href={totpURI}>
        Open authenticator setup
      </a>
    </div>
  );
}

function RecoveryCodes({ secrets }: { readonly secrets: EnrollmentSecrets }) {
  return (
    <div>
      <h3>{secrets.totpURI ? "2" : "1"}. Save the recovery codes</h3>
      <p>
        Store these outside Choir Management. They are not saved in browser storage and will not be
        shown again by this page.
      </p>
      <textarea
        aria-label="Platform Administrator recovery codes"
        className="recovery-codes"
        readOnly
        rows={Math.min(10, secrets.backupCodes.length)}
        value={secrets.backupCodes.join("\n")}
      />
    </div>
  );
}

interface EnrollmentNextStepProps {
  readonly acknowledgedRecoveryCodes: boolean;
  readonly busy: boolean;
  readonly enrollmentCode: string;
  readonly onAcknowledge: (acknowledged: boolean) => void;
  readonly onCodeChange: (code: string) => void;
  readonly onConfirm: () => void;
  readonly onVerify: () => void;
  readonly totpVerified: boolean;
}

function EnrollmentNextStep(props: EnrollmentNextStepProps) {
  if (!props.totpVerified) {
    return (
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          props.onVerify();
        }}
      >
        <div className="field">
          <label htmlFor="platform-enrollment-code">3. Verify the authenticator code</label>
          <input
            autoComplete="one-time-code"
            id="platform-enrollment-code"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => {
              props.onCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6));
            }}
            pattern="[0-9]{6}"
            value={props.enrollmentCode}
          />
        </div>
        <button className="button button--primary" disabled={props.busy} type="submit">
          {props.busy ? "Verifying…" : "Verify authenticator"}
        </button>
      </form>
    );
  }
  return (
    <div className="recovery-confirmation">
      <label>
        <input
          checked={props.acknowledgedRecoveryCodes}
          onChange={(event) => {
            props.onAcknowledge(event.target.checked);
          }}
          type="checkbox"
        />
        I saved these recovery codes in a secure place.
      </label>
      <button
        className="button button--primary"
        disabled={props.busy || !props.acknowledgedRecoveryCodes}
        onClick={props.onConfirm}
        type="button"
      >
        {props.busy ? "Confirming…" : "Confirm recovery codes"}
      </button>
    </div>
  );
}

interface EnrollmentPanelProps extends EnrollmentNextStepProps {
  readonly enrollmentPassword: string;
  readonly onPasswordChange: (password: string) => void;
  readonly onStart: () => void;
  readonly secrets: EnrollmentSecrets | null;
  readonly twoFactorEnabled: boolean;
}

function EnrollmentPanel(props: EnrollmentPanelProps) {
  if (!props.secrets) {
    let buttonLabel = props.twoFactorEnabled ? "Continue MFA setup" : "Start MFA setup";
    if (props.busy) {
      buttonLabel = "Preparing MFA…";
    }
    return (
      <form
        className="platform-action mfa-start-form"
        onSubmit={(event) => {
          event.preventDefault();
          props.onStart();
        }}
      >
        <div>
          <h3>Complete mandatory MFA</h3>
          <p>
            Platform Administrators must enroll an authenticator and retain recovery codes before
            any platform operation is available. If your account has a password, enter it to
            authorize this security change.
          </p>
        </div>
        <div className="form-stack mfa-start-form__controls">
          <div className="field">
            <label htmlFor="platform-enrollment-password">Current password (if set)</label>
            <input
              autoComplete="current-password"
              id="platform-enrollment-password"
              maxLength={128}
              onChange={(event) => {
                props.onPasswordChange(event.target.value);
              }}
              type="password"
              value={props.enrollmentPassword}
            />
          </div>
          <button className="button button--primary" disabled={props.busy} type="submit">
            {buttonLabel}
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="mfa-enrollment">
      <AuthenticatorSetup totpURI={props.secrets.totpURI} />
      <RecoveryCodes secrets={props.secrets} />
      <EnrollmentNextStep {...props} totpVerified={props.secrets.totpVerified} />
    </div>
  );
}

interface VerificationPanelProps {
  readonly busy: boolean;
  readonly code: string;
  readonly method: "recovery_code" | "totp";
  readonly onCodeChange: (code: string) => void;
  readonly onMethodChange: (method: "recovery_code" | "totp") => void;
  readonly onVerify: () => void;
}

function VerificationPanel(props: VerificationPanelProps) {
  return (
    <form
      className="form-stack platform-verification"
      onSubmit={(event) => {
        event.preventDefault();
        props.onVerify();
      }}
    >
      <h3>Verify Platform Administrator access</h3>
      <p>Enter a fresh factor to open a 15-minute Platform Administrator session.</p>
      <div className="field">
        <label htmlFor="platform-verification-method">Verification method</label>
        <select
          id="platform-verification-method"
          onChange={(event) => {
            props.onMethodChange(event.target.value === "recovery_code" ? "recovery_code" : "totp");
          }}
          value={props.method}
        >
          <option value="totp">Authenticator code</option>
          <option value="recovery_code">Recovery code</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="platform-verification-code">
          {props.method === "totp" ? "6-digit code" : "Recovery code"}
        </label>
        <input
          autoComplete="one-time-code"
          id="platform-verification-code"
          inputMode={props.method === "totp" ? "numeric" : "text"}
          maxLength={128}
          onChange={(event) => {
            props.onCodeChange(event.target.value);
          }}
          value={props.code}
        />
      </div>
      <button className="button button--primary" disabled={props.busy} type="submit">
        {props.busy ? "Verifying…" : "Verify Platform access"}
      </button>
    </form>
  );
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

async function readAccessState(signal?: AbortSignal): Promise<AccessState> {
  const status = await getPlatformMfaStatus(signal);
  if (!status.activePlatformAdministrator) {
    return { status: "hidden" };
  }
  if (!status.enrollmentComplete) {
    return { status: "needs_enrollment", twoFactorEnabled: status.twoFactorEnabled };
  }
  try {
    return { context: await getPlatformContext(), status: "ready" };
  } catch (error: unknown) {
    if (error instanceof AuthApiError && error.status === 401) {
      return { status: "needs_verification" };
    }
    throw error;
  }
}

type PlatformAccessView = "access" | "organizations" | "queue_failures" | "security";

interface PlatformAccessProps {
  readonly view?: PlatformAccessView;
}

function viewCopy(view: PlatformAccessView): {
  readonly eyebrow: string;
  readonly title: string;
  readonly titleId: string;
} {
  if (view === "organizations") {
    return {
      eyebrow: "Platform operations",
      title: "Organizations",
      titleId: "platform-organizations-title",
    };
  }
  if (view === "access") {
    return {
      eyebrow: "Platform operations",
      title: "Organization access",
      titleId: "platform-access-title",
    };
  }
  if (view === "queue_failures") {
    return {
      eyebrow: "Platform operations",
      title: "Queue failures",
      titleId: "platform-queue-failures-title",
    };
  }
  return {
    eyebrow: "Platform security",
    title: "Platform Administrator access",
    titleId: "platform-title",
  };
}

export function PlatformAccess({ view = "security" }: PlatformAccessProps) {
  const copy = viewCopy(view);
  const [accessState, setAccessState] = useState<AccessState>({ status: "loading" });
  const [acknowledgedRecoveryCodes, setAcknowledgedRecoveryCodes] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [enrollmentPassword, setEnrollmentPassword] = useState("");
  const [enrollmentSecrets, setEnrollmentSecrets] = useState<EnrollmentSecrets | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationMethod, setVerificationMethod] = useState<"recovery_code" | "totp">("totp");

  useEffect(() => {
    const abortController = new AbortController();
    readAccessState(abortController.signal)
      .then((state) => {
        setAccessState(state);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAccessState({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, []);

  async function refreshAccess() {
    try {
      setAccessState(await readAccessState());
    } catch {
      setAccessState({ status: "error" });
    }
  }

  async function startEnrollment() {
    if (accessState.status !== "needs_enrollment") {
      return;
    }
    setActionError(null);
    setBusy(true);
    try {
      if (accessState.twoFactorEnabled) {
        setEnrollmentSecrets({
          backupCodes: await regenerateAccountRecoveryCodes(enrollmentPassword),
          totpURI: null,
          totpVerified: true,
        });
      } else {
        const enrollment = await beginAccountMfaEnrollment(enrollmentPassword);
        setEnrollmentSecrets({
          backupCodes: enrollment.backupCodes,
          totpURI: enrollment.totpURI,
          totpVerified: false,
        });
      }
    } catch {
      setActionError(
        "MFA setup could not be started. If your account has a password, check it and try again.",
      );
    } finally {
      setEnrollmentPassword("");
      setBusy(false);
    }
  }

  async function verifyEnrollmentCode() {
    if (!/^\d{6}$/.test(enrollmentCode)) {
      setActionError("Enter the current 6-digit code from your authenticator app.");
      return;
    }
    setActionError(null);
    setBusy(true);
    try {
      await verifyAccountTotpEnrollment(enrollmentCode);
      setEnrollmentSecrets((current) => (current ? { ...current, totpVerified: true } : current));
      setEnrollmentCode("");
    } catch {
      setActionError("That authenticator code was not accepted. Check the time and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRecoveryCodes() {
    if (!acknowledgedRecoveryCodes || !enrollmentSecrets?.totpVerified) {
      setActionError(
        "Verify TOTP and confirm that the recovery codes are saved before continuing.",
      );
      return;
    }
    setActionError(null);
    setBusy(true);
    try {
      await confirmPlatformMfaEnrollment();
      setEnrollmentSecrets(null);
      setAcknowledgedRecoveryCodes(false);
      await refreshAccess();
    } catch {
      setActionError("MFA enrollment could not be confirmed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyAccess() {
    const code = verificationCode.trim();
    const valid = verificationMethod === "totp" ? /^\d{6}$/.test(code) : code.length >= 8;
    if (!valid) {
      setActionError(
        verificationMethod === "totp"
          ? "Enter a 6-digit authenticator code."
          : "Enter one complete recovery code.",
      );
      return;
    }
    setActionError(null);
    setBusy(true);
    try {
      await verifyPlatformMfa(verificationMethod, code);
      setVerificationCode("");
      await refreshAccess();
    } catch {
      setActionError("Platform Administrator verification failed. Check the code and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (accessState.status === "hidden" || accessState.status === "loading") {
    return null;
  }
  if (accessState.status === "error") {
    return (
      <PlatformSection actionError={actionError} {...copy}>
        <p className="notice notice--error" role="alert">
          Platform Administrator status could not be checked. Refresh the page and try again.
        </p>
      </PlatformSection>
    );
  }
  if (accessState.status === "ready") {
    return (
      <PlatformSection actionError={actionError} {...copy}>
        <div className="notice notice--success platform-access-status" role="status">
          <strong>Platform access is ready.</strong> Verified with {accessState.context.mfaMethod};
          expires {displayDate(accessState.context.mfaVerifiedUntil)}.
        </div>
        {view === "security" ? null : (
          <PlatformOperations mode={view} scope={accessState.context.scope} />
        )}
      </PlatformSection>
    );
  }
  if (accessState.status === "needs_verification") {
    return (
      <PlatformSection actionError={actionError} {...copy}>
        <VerificationPanel
          busy={busy}
          code={verificationCode}
          method={verificationMethod}
          onCodeChange={setVerificationCode}
          onMethodChange={(method) => {
            setVerificationMethod(method);
            setVerificationCode("");
          }}
          onVerify={() => {
            void verifyAccess();
          }}
        />
      </PlatformSection>
    );
  }
  return (
    <PlatformSection actionError={actionError} {...copy}>
      <EnrollmentPanel
        acknowledgedRecoveryCodes={acknowledgedRecoveryCodes}
        busy={busy}
        enrollmentCode={enrollmentCode}
        enrollmentPassword={enrollmentPassword}
        onAcknowledge={setAcknowledgedRecoveryCodes}
        onCodeChange={setEnrollmentCode}
        onConfirm={() => {
          void confirmRecoveryCodes();
        }}
        onStart={() => {
          void startEnrollment();
        }}
        onPasswordChange={setEnrollmentPassword}
        onVerify={() => {
          void verifyEnrollmentCode();
        }}
        secrets={enrollmentSecrets}
        totpVerified={enrollmentSecrets?.totpVerified ?? false}
        twoFactorEnabled={accessState.twoFactorEnabled}
      />
    </PlatformSection>
  );
}
