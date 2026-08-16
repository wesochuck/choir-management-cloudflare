import { useId, useState } from "react";

import { AuthApiError, verifyOrganizationMfa } from "../auth/api";

type VerificationMethod = "recovery_code" | "totp";

export function OrganizationMfaPrompt({ message }: { readonly message: string }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<VerificationMethod>("totp");
  const [open, setOpen] = useState(false);
  const [verified, setVerified] = useState(false);

  async function submitVerification(): Promise<void> {
    const value = code.trim();
    const valid = method === "totp" ? /^\d{6}$/.test(value) : value.length >= 8;
    if (!valid) {
      setError(
        method === "totp"
          ? "Enter a 6-digit authenticator code."
          : "Enter one complete recovery code.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await verifyOrganizationMfa(method, value);
      setCode("");
      setVerified(true);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "Organization MFA verification failed. Check the code and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="organization-mfa-prompt">
      {!verified ? (
        <p className="notice notice--warning organization-mfa-prompt__notice">
          <span>{message}</span>
          <button
            className="text-button"
            onClick={() => {
              setError(null);
              setOpen((current) => !current);
            }}
            type="button"
          >
            {open ? "Hide verification" : "Verify Organization MFA"}
          </button>
        </p>
      ) : (
        <>
          <p className="notice notice--success" role="status">
            Organization MFA verified for this browser session.
          </p>
          <button
            className="button button--primary"
            onClick={() => {
              window.location.reload();
            }}
            type="button"
          >
            Refresh to continue
          </button>
        </>
      )}
      {!verified && open ? (
        <form
          aria-label="Verify Organization MFA"
          className="form-stack organization-mfa-prompt__form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitVerification();
          }}
        >
          <div className="field">
            <label htmlFor={`${id}-method`}>Verification method</label>
            <select
              id={`${id}-method`}
              onChange={(event) => {
                setMethod(event.target.value === "recovery_code" ? "recovery_code" : "totp");
                setCode("");
                setError(null);
              }}
              value={method}
            >
              <option value="totp">Authenticator code</option>
              <option value="recovery_code">Recovery code</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-code`}>
              {method === "totp" ? "6-digit Organization code" : "Recovery code"}
            </label>
            <input
              autoComplete="one-time-code"
              id={`${id}-code`}
              inputMode={method === "totp" ? "numeric" : "text"}
              maxLength={method === "totp" ? 6 : 128}
              onChange={(event) => {
                setCode(
                  method === "totp"
                    ? event.target.value.replace(/\D/g, "").slice(0, 6)
                    : event.target.value,
                );
                setError(null);
              }}
              value={code}
            />
          </div>
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <button className="button button--primary" disabled={busy} type="submit">
              {busy ? "Verifying…" : "Verify Organization access"}
            </button>
            <button
              className="button button--secondary"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
