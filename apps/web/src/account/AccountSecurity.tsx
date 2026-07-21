import { useEffect, useState } from "react";

import { getAccountSecurity, updateAccountPassword } from "../auth/api";

type SecurityState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly passwordSet: boolean; readonly status: "ready" };

export function AccountSecurity() {
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [securityState, setSecurityState] = useState<SecurityState>({ status: "loading" });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    getAccountSecurity(abortController.signal)
      .then((security) => {
        setSecurityState({ passwordSet: security.passwordSet, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSecurityState({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, []);

  async function savePassword() {
    if (securityState.status !== "ready") {
      return;
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      setErrorMessage("Use a password between 12 and 128 characters.");
      return;
    }
    if (newPassword !== confirmation) {
      setErrorMessage("The new password and confirmation do not match.");
      return;
    }

    const wasSet = securityState.passwordSet;
    setBusy(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await updateAccountPassword(
        wasSet ? { currentPassword, mode: "change", newPassword } : { mode: "set", newPassword },
      );
      setSecurityState({ passwordSet: result.passwordSet, status: "ready" });
      setConfirmation("");
      setCurrentPassword("");
      setNewPassword("");
      setSuccessMessage(wasSet ? "Password changed." : "Password added to your account.");
    } catch {
      setErrorMessage(
        wasSet
          ? "The password could not be changed. Check the current password and try again."
          : "The password could not be added. Sign in again and retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (securityState.status === "loading") {
    return null;
  }

  return (
    <section className="account-section account-section--security" aria-labelledby="password-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Sign-in options</p>
        <h2 id="password-title">Account password</h2>
      </div>
      {securityState.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Password status could not be loaded. Refresh the page and try again.
        </p>
      ) : (
        <>
          <p className="section-description">
            Email code remains the primary sign-in method. A password is optional and can be set or
            changed only by you.
          </p>
          {errorMessage ? (
            <p className="notice notice--error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          {successMessage ? (
            <p className="notice notice--success" role="status">
              {successMessage}
            </p>
          ) : null}
          <form
            className="form-stack password-form"
            onSubmit={(event) => {
              event.preventDefault();
              void savePassword();
            }}
          >
            {securityState.passwordSet ? (
              <div className="field">
                <label htmlFor="current-password">Current password</label>
                <input
                  autoComplete="current-password"
                  id="current-password"
                  maxLength={128}
                  onChange={(event) => {
                    setCurrentPassword(event.target.value);
                  }}
                  required
                  type="password"
                  value={currentPassword}
                />
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input
                autoComplete="new-password"
                id="new-password"
                maxLength={128}
                minLength={12}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                }}
                required
                type="password"
                value={newPassword}
              />
            </div>
            <div className="field">
              <label htmlFor="confirm-password">Confirm new password</label>
              <input
                autoComplete="new-password"
                id="confirm-password"
                maxLength={128}
                minLength={12}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                }}
                required
                type="password"
                value={confirmation}
              />
            </div>
            <button className="button button--primary" disabled={busy} type="submit">
              {busy
                ? "Saving password…"
                : securityState.passwordSet
                  ? "Change password"
                  : "Add password"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
