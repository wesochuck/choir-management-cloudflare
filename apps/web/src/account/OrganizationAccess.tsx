import type { OrganizationAuthStatusResponse } from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  beginAccountMfaEnrollment,
  getOrganizationAuthStatus,
  regenerateAccountRecoveryCodes,
  setOrganizationMfaPolicy,
  verifyAccountTotpEnrollment,
  verifyOrganizationMfa,
} from "../auth/api";
import { OrganizationInvitations } from "./OrganizationInvitations";
import { AttendanceManager } from "./AttendanceManager";
import { CalendarSubscription } from "./CalendarSubscription";
import { OrganizationCalendar } from "./OrganizationCalendar";
import { MySchedule } from "./MySchedule";
import { MemberProfileDirectory } from "./MemberProfileDirectory";
import { MusicCatalog } from "./MusicCatalog";
import { RosterConfiguration } from "./RosterConfiguration";
import { SeatingFinder } from "./SeatingFinder";
import { SeatingManager } from "./SeatingManager";

type AccessState =
  | { readonly status: "error" }
  | { readonly status: "hidden" }
  | { readonly status: "loading" }
  | { readonly context: OrganizationAuthStatusResponse; readonly status: "ready" };

interface EnrollmentSecrets {
  readonly backupCodes: readonly string[];
  readonly totpURI: string | null;
  readonly totpVerified: boolean;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function roleLabel(role: OrganizationAuthStatusResponse["role"]): string {
  switch (role) {
    case "administrator":
      return "Organization Administrator";
    case "member":
      return "Organization Member";
    case "owner":
      return "Organization Owner";
  }
}

async function readAccessState(signal?: AbortSignal): Promise<AccessState> {
  try {
    return { context: await getOrganizationAuthStatus(signal), status: "ready" };
  } catch (error: unknown) {
    if (error instanceof AuthApiError && (error.status === 403 || error.status === 404)) {
      return { status: "hidden" };
    }
    throw error;
  }
}

function OrganizationFeedback({
  actionError,
  successMessage,
}: {
  readonly actionError: string | null;
  readonly successMessage: string | null;
}) {
  return (
    <>
      {actionError ? (
        <p className="notice notice--error" role="alert">
          {actionError}
        </p>
      ) : null}
      {successMessage ? (
        <p className="notice notice--success" role="status">
          {successMessage}
        </p>
      ) : null}
    </>
  );
}

interface PolicyProps {
  readonly busy: boolean;
  readonly confirmDisable: boolean;
  readonly context: OrganizationAuthStatusResponse;
  readonly onCancelDisable: () => void;
  readonly onChangePolicy: (required: boolean) => void;
  readonly onConfirmDisable: () => void;
}

function OrganizationPolicy(props: PolicyProps) {
  if (props.context.role !== "owner") {
    return null;
  }
  let control;
  if (!props.context.mfaRequired) {
    control = (
      <button
        className="button button--primary"
        disabled={props.busy}
        onClick={() => {
          props.onChangePolicy(true);
        }}
        type="button"
      >
        {props.busy ? "Updating policy…" : "Require MFA for this Organization"}
      </button>
    );
  } else if (props.confirmDisable) {
    control = (
      <div className="danger-confirmation" role="group" aria-label="Confirm MFA policy change">
        <p>Stop requiring MFA for every Organization Membership?</p>
        <div className="form-actions">
          <button
            className="button button--secondary"
            disabled={props.busy}
            onClick={props.onCancelDisable}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--danger"
            disabled={props.busy}
            onClick={() => {
              props.onChangePolicy(false);
            }}
            type="button"
          >
            {props.busy ? "Updating policy…" : "Confirm: stop requiring MFA"}
          </button>
        </div>
      </div>
    );
  } else {
    control = (
      <button
        className="button button--secondary"
        disabled={props.busy || !props.context.mfaVerifiedUntil}
        onClick={props.onConfirmDisable}
        type="button"
      >
        Stop requiring MFA
      </button>
    );
  }
  return (
    <div className="organization-policy">
      <h3>Organization MFA policy</h3>
      {control}
      {props.context.mfaRequired && !props.context.mfaVerifiedUntil ? (
        <p className="section-description">
          Verify Organization MFA before changing an active policy.
        </p>
      ) : null}
    </div>
  );
}

function EnrollmentStart({
  busy,
  enrollmentPassword,
  onPasswordChange,
  onStart,
  replacingCodes,
  visible,
}: {
  readonly busy: boolean;
  readonly enrollmentPassword: string;
  readonly onPasswordChange: (password: string) => void;
  readonly onStart: () => void;
  readonly replacingCodes: boolean;
  readonly visible: boolean;
}) {
  if (!visible) {
    return null;
  }
  return (
    <form
      className="platform-action mfa-start-form organization-enrollment-start"
      onSubmit={(event) => {
        event.preventDefault();
        onStart();
      }}
    >
      <div>
        <h3>{replacingCodes ? "Replace recovery codes" : "Set up an authenticator"}</h3>
        <p>
          Save the recovery codes before verifying access to this Organization. If your account has
          a password, enter it to authorize this security change.
        </p>
      </div>
      <div className="form-stack mfa-start-form__controls">
        <div className="field">
          <label htmlFor="organization-enrollment-password">Current password (if set)</label>
          <input
            autoComplete="current-password"
            id="organization-enrollment-password"
            maxLength={128}
            onChange={(event) => {
              onPasswordChange(event.target.value);
            }}
            type="password"
            value={enrollmentPassword}
          />
        </div>
        <button className="button button--primary" disabled={busy} type="submit">
          {busy
            ? "Preparing MFA…"
            : replacingCodes
              ? "Generate replacement codes"
              : "Start Organization MFA setup"}
        </button>
      </div>
    </form>
  );
}

interface EnrollmentDetailsProps {
  readonly acknowledged: boolean;
  readonly busy: boolean;
  readonly code: string;
  readonly onAcknowledge: (acknowledged: boolean) => void;
  readonly onCodeChange: (code: string) => void;
  readonly onContinue: () => void;
  readonly onVerify: () => void;
  readonly secrets: EnrollmentSecrets | null;
}

function EnrollmentDetails(props: EnrollmentDetailsProps) {
  if (!props.secrets) {
    return null;
  }
  return (
    <div className="mfa-enrollment organization-mfa-enrollment">
      {props.secrets.totpURI ? (
        <div>
          <h3>1. Add the authenticator</h3>
          <p>The setup secret stays only in this in-memory view.</p>
          <a className="button button--secondary" href={props.secrets.totpURI}>
            Open authenticator setup
          </a>
        </div>
      ) : (
        <div>
          <h3>Replacement recovery codes</h3>
          <p>These codes replace all earlier recovery codes.</p>
        </div>
      )}
      <div>
        <h3>{props.secrets.totpURI ? "2. Save recovery codes" : "Save recovery codes"}</h3>
        <textarea
          aria-label="Organization MFA recovery codes"
          className="recovery-codes"
          readOnly
          rows={Math.min(10, props.secrets.backupCodes.length)}
          value={props.secrets.backupCodes.join("\n")}
        />
      </div>
      {!props.secrets.totpVerified ? (
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            props.onVerify();
          }}
        >
          <div className="field">
            <label htmlFor="organization-enrollment-code">3. Verify authenticator code</label>
            <input
              autoComplete="one-time-code"
              id="organization-enrollment-code"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => {
                props.onCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6));
              }}
              pattern="[0-9]{6}"
              value={props.code}
            />
          </div>
          <button className="button button--primary" disabled={props.busy} type="submit">
            {props.busy ? "Verifying…" : "Verify authenticator"}
          </button>
        </form>
      ) : (
        <div className="recovery-confirmation">
          <label>
            <input
              checked={props.acknowledged}
              onChange={(event) => {
                props.onAcknowledge(event.target.checked);
              }}
              type="checkbox"
            />
            I saved these Organization MFA recovery codes in a secure place.
          </label>
          <button
            className="button button--primary"
            disabled={props.busy || !props.acknowledged}
            onClick={props.onContinue}
            type="button"
          >
            Continue to Organization verification
          </button>
        </div>
      )}
    </div>
  );
}

interface VerificationPanelProps {
  readonly busy: boolean;
  readonly code: string;
  readonly method: "recovery_code" | "totp";
  readonly onCodeChange: (code: string) => void;
  readonly onMethodChange: (method: "recovery_code" | "totp") => void;
  readonly onReplaceCodes: () => void;
  readonly onVerify: () => void;
  readonly visible: boolean;
}

function VerificationPanel(props: VerificationPanelProps) {
  if (!props.visible) {
    return null;
  }
  return (
    <form
      className="form-stack organization-verification"
      onSubmit={(event) => {
        event.preventDefault();
        props.onVerify();
      }}
    >
      <h3>Verify Organization MFA</h3>
      <div className="field">
        <label htmlFor="organization-verification-method">Verification method</label>
        <select
          id="organization-verification-method"
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
        <label htmlFor="organization-verification-code">
          {props.method === "totp" ? "6-digit Organization code" : "Recovery code"}
        </label>
        <input
          autoComplete="one-time-code"
          id="organization-verification-code"
          inputMode={props.method === "totp" ? "numeric" : "text"}
          maxLength={128}
          onChange={(event) => {
            props.onCodeChange(event.target.value);
          }}
          value={props.code}
        />
      </div>
      <div className="form-actions">
        <button className="button button--primary" disabled={props.busy} type="submit">
          {props.busy ? "Verifying…" : "Verify Organization access"}
        </button>
        <button
          className="text-button"
          disabled={props.busy}
          onClick={props.onReplaceCodes}
          type="button"
        >
          Replace recovery codes
        </button>
      </div>
    </form>
  );
}

function OrganizationOperations({
  context,
  enabled,
}: {
  readonly context: OrganizationAuthStatusResponse;
  readonly enabled: boolean;
}) {
  const managerEnabled = enabled && context.role !== "member";
  return (
    <>
      <OrganizationCalendar context={context} enabled={enabled} />
      <RosterConfiguration enabled={managerEnabled} />
      <MusicCatalog enabled={managerEnabled} />
      <SeatingManager enabled={managerEnabled} />
      <AttendanceManager enabled={managerEnabled} />
      <MemberProfileDirectory enabled={enabled} />
      <MySchedule enabled={enabled} />
      <SeatingFinder enabled={enabled} />
      <CalendarSubscription enabled={enabled} />
    </>
  );
}

export function OrganizationAccess() {
  const [accessState, setAccessState] = useState<AccessState>({ status: "loading" });
  const [acknowledgedRecoveryCodes, setAcknowledgedRecoveryCodes] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [enrollmentPassword, setEnrollmentPassword] = useState("");
  const [enrollmentSecrets, setEnrollmentSecrets] = useState<EnrollmentSecrets | null>(null);
  const [replacementRequested, setReplacementRequested] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationMethod, setVerificationMethod] = useState<"recovery_code" | "totp">("totp");

  useEffect(() => {
    const abortController = new AbortController();
    readAccessState(abortController.signal)
      .then(setAccessState)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAccessState({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, []);

  async function changePolicy(mfaRequired: boolean) {
    if (accessState.status !== "ready" || accessState.context.role !== "owner") {
      return;
    }
    setBusy(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const result = await setOrganizationMfaPolicy(mfaRequired);
      if (result.organizationId !== accessState.context.organizationId) {
        setAccessState({ status: "error" });
        return;
      }
      setAccessState({
        context: {
          ...accessState.context,
          mfaRequired: result.mfaRequired,
          mfaVerifiedUntil: null,
        },
        status: "ready",
      });
      setConfirmDisable(false);
      setSuccessMessage(
        result.mfaRequired
          ? "Organization MFA is now required. Complete the security steps below."
          : "Organization MFA is no longer required.",
      );
    } catch (error: unknown) {
      setActionError(
        error instanceof AuthApiError
          ? error.message
          : "The Organization MFA policy could not be changed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function startEnrollment() {
    if (accessState.status !== "ready") {
      return;
    }
    setBusy(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      if (accessState.context.twoFactorEnabled && accessState.context.twoFactorVerified) {
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
      setReplacementRequested(false);
    } catch {
      setActionError(
        "Authenticator setup could not be started. If your account has a password, check it and try again.",
      );
    } finally {
      setEnrollmentPassword("");
      setBusy(false);
    }
  }

  async function verifyEnrollment() {
    if (!/^\d{6}$/.test(enrollmentCode)) {
      setActionError("Enter the current 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await verifyAccountTotpEnrollment(enrollmentCode);
      setEnrollmentCode("");
      setEnrollmentSecrets((current) => (current ? { ...current, totpVerified: true } : current));
    } catch {
      setActionError("That authenticator code was not accepted. Check the time and try again.");
    } finally {
      setBusy(false);
    }
  }

  function finishEnrollment() {
    if (
      accessState.status !== "ready" ||
      !enrollmentSecrets?.totpVerified ||
      !acknowledgedRecoveryCodes
    ) {
      setActionError("Verify the authenticator and confirm that the recovery codes are saved.");
      return;
    }
    setAccessState({
      context: {
        ...accessState.context,
        twoFactorEnabled: true,
        twoFactorVerified: true,
      },
      status: "ready",
    });
    setAcknowledgedRecoveryCodes(false);
    setEnrollmentSecrets(null);
    setSuccessMessage("Authenticator and recovery codes are ready for Organization MFA.");
  }

  async function verifyAccess() {
    if (accessState.status !== "ready") {
      return;
    }
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
    setBusy(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const result = await verifyOrganizationMfa(verificationMethod, code);
      if (result.organizationId !== accessState.context.organizationId) {
        setAccessState({ status: "error" });
        return;
      }
      setAccessState({
        context: { ...accessState.context, mfaVerifiedUntil: result.expiresAt },
        status: "ready",
      });
      setVerificationCode("");
      setSuccessMessage("Organization MFA verified for this browser session.");
    } catch {
      setActionError("Organization MFA verification failed. Check the code and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (accessState.status === "hidden" || accessState.status === "loading") {
    return null;
  }
  if (accessState.status === "error") {
    return (
      <section
        className="account-section account-section--organization-security"
        aria-labelledby="organization-security-title"
      >
        <h2 id="organization-security-title">Organization security</h2>
        <p className="notice notice--error" role="alert">
          Organization security status could not be loaded. Refresh and try again.
        </p>
      </section>
    );
  }

  const { context } = accessState;
  const enrollmentComplete = context.twoFactorEnabled && context.twoFactorVerified;
  const needsVerification = context.mfaRequired && !context.mfaVerifiedUntil;

  return (
    <>
      <section
        className="account-section account-section--organization-security"
        aria-labelledby="organization-security-title"
      >
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">{roleLabel(context.role)}</p>
          <h2 id="organization-security-title">Organization security</h2>
        </div>
        <p className="section-description">
          This Organization was selected by the validated hostname. Its MFA assertion is bound to
          this Organization, your identity, and this browser session.
        </p>
        <OrganizationFeedback actionError={actionError} successMessage={successMessage} />

        <div className="organization-security-status">
          <span className="status-pill">
            {context.mfaRequired ? "MFA required" : "MFA not required"}
          </span>
          {context.mfaVerifiedUntil ? (
            <p className="notice notice--success" role="status">
              Verified until {displayDate(context.mfaVerifiedUntil)}.
            </p>
          ) : null}
        </div>

        <OrganizationPolicy
          busy={busy}
          confirmDisable={confirmDisable}
          context={context}
          onCancelDisable={() => {
            setConfirmDisable(false);
          }}
          onChangePolicy={(required) => {
            void changePolicy(required);
          }}
          onConfirmDisable={() => {
            setConfirmDisable(true);
          }}
        />

        <EnrollmentStart
          busy={busy}
          enrollmentPassword={enrollmentPassword}
          onPasswordChange={setEnrollmentPassword}
          onStart={() => {
            void startEnrollment();
          }}
          replacingCodes={enrollmentComplete}
          visible={
            (replacementRequested || (context.mfaRequired && !enrollmentComplete)) &&
            !enrollmentSecrets
          }
        />

        <EnrollmentDetails
          acknowledged={acknowledgedRecoveryCodes}
          busy={busy}
          code={enrollmentCode}
          onAcknowledge={setAcknowledgedRecoveryCodes}
          onCodeChange={setEnrollmentCode}
          onContinue={finishEnrollment}
          onVerify={() => {
            void verifyEnrollment();
          }}
          secrets={enrollmentSecrets}
        />

        <VerificationPanel
          busy={busy}
          code={verificationCode}
          method={verificationMethod}
          onCodeChange={setVerificationCode}
          onMethodChange={(method) => {
            setVerificationMethod(method);
            setVerificationCode("");
          }}
          onReplaceCodes={() => {
            setActionError(null);
            setSuccessMessage(null);
            setReplacementRequested(true);
          }}
          onVerify={() => {
            void verifyAccess();
          }}
          visible={needsVerification && enrollmentComplete && !enrollmentSecrets}
        />
      </section>
      <OrganizationOperations context={context} enabled={!needsVerification} />
      <OrganizationInvitations context={context} />
    </>
  );
}
