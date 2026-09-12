import { useEffect, useState } from "react";

import { getAccountSecurity, updateAccountPassword } from "../auth/api";
import {
  addPasskey,
  deletePasskey,
  listPasskeys,
  renamePasskey,
  type PasskeyItem,
} from "../auth/passkeyClient";

type SecurityState =
  | { readonly passwordSet: boolean; readonly status: "ready" }
  | { readonly status: "error" }
  | { readonly status: "loading" };

// eslint-disable-next-line complexity -- AccountSecurity coordinates passkey management, password settings, and verification state.
export function AccountSecurity() {
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [securityState, setSecurityState] = useState<SecurityState>({ status: "loading" });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(true);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeySuccess, setPasskeySuccess] = useState<string | null>(null);
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null);
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [editingPasskeyName, setEditingPasskeyName] = useState("");

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

  useEffect(() => {
    let active = true;
    listPasskeys()
      .then((items) => {
        if (active) {
          setPasskeys(items);
          setPasskeysLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setPasskeysLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleAddPasskey() {
    setPasskeyError(null);
    setPasskeySuccess(null);
    setAddingPasskey(true);
    try {
      const result = await addPasskey();
      if (result.success) {
        const items = await listPasskeys();
        setPasskeys(items);
        setPasskeySuccess("Passkey added to your account.");
      } else if (result.error && !result.canceled) {
        setPasskeyError(result.error);
      }
    } catch {
      setPasskeyError("Could not add passkey. Please try again.");
    } finally {
      setAddingPasskey(false);
    }
  }

  async function handleConfirmDelete(id: string) {
    setPasskeyError(null);
    setPasskeySuccess(null);
    setBusy(true);
    try {
      await deletePasskey(id);
      const items = await listPasskeys();
      setPasskeys(items);
      setDeletingPasskeyId(null);
      setPasskeySuccess("Passkey removed.");
    } catch {
      setPasskeyError("Could not remove passkey. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveRename(id: string) {
    const trimmed = editingPasskeyName.trim();
    if (!trimmed) return;
    setPasskeyError(null);
    setPasskeySuccess(null);
    setBusy(true);
    try {
      await renamePasskey(id, trimmed);
      const items = await listPasskeys();
      setPasskeys(items);
      setEditingPasskeyId(null);
      setPasskeySuccess("Passkey renamed.");
    } catch {
      setPasskeyError("Could not rename passkey. Please try again.");
    } finally {
      setBusy(false);
    }
  }

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

  if (securityState.status === "loading" && passkeysLoading) {
    return null;
  }

  return (
    <>
      <section
        className="account-section account-section--security"
        aria-labelledby="passkeys-title"
      >
        <div className="section-heading section-heading--compact">
          <h2 id="passkeys-title">Passkeys</h2>
        </div>
        <p className="section-description">
          Sign in faster with Face ID, Touch ID, Windows Hello, or a security key. A passkey
          replaces waiting for email codes and automatically satisfies Organization MFA.
        </p>

        {passkeyError ? (
          <p className="notice notice--error" role="alert">
            {passkeyError}
          </p>
        ) : null}

        {passkeySuccess ? (
          <p className="notice notice--success" role="status">
            {passkeySuccess}
          </p>
        ) : null}

        {passkeys.length === 0 && !passkeysLoading ? (
          <p className="notice notice--info" role="status">
            No passkeys registered yet. Make sign-in faster next time by adding a passkey.
          </p>
        ) : null}

        {passkeys.length > 0 ? (
          <ul className="account-list" aria-label="Registered passkeys">
            {passkeys.map((pk) => {
              const isEditing = editingPasskeyId === pk.id;
              const isDeleting = deletingPasskeyId === pk.id;
              const displayName = pk.name ?? "Passkey";
              const createdDate = pk.createdAt
                ? new Date(pk.createdAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : null;

              return (
                <li aria-label={`Passkey: ${displayName}`} key={pk.id}>
                  {isDeleting ? (
                    <div
                      aria-label="Confirm passkey removal"
                      className="danger-confirmation"
                      role="group"
                    >
                      <p>
                        Remove passkey &ldquo;{displayName}&rdquo;?
                        {passkeys.length === 1
                          ? " If you remove your last passkey, email code sign-in remains available."
                          : ""}
                      </p>
                      <div className="form-actions">
                        <button
                          className="button button--secondary"
                          disabled={busy}
                          onClick={() => {
                            setDeletingPasskeyId(null);
                          }}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button
                          className="button button--danger"
                          disabled={busy}
                          onClick={() => {
                            void handleConfirmDelete(pk.id);
                          }}
                          type="button"
                        >
                          Confirm removal
                        </button>
                      </div>
                    </div>
                  ) : isEditing ? (
                    <form
                      className="form-stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSaveRename(pk.id);
                      }}
                    >
                      <div className="field">
                        <label htmlFor={`rename-passkey-${pk.id}`}>Passkey name</label>
                        <input
                          id={`rename-passkey-${pk.id}`}
                          maxLength={64}
                          onChange={(e) => {
                            setEditingPasskeyName(e.target.value);
                          }}
                          required
                          type="text"
                          value={editingPasskeyName}
                        />
                      </div>
                      <div className="form-actions">
                        <button
                          className="button button--secondary"
                          disabled={busy}
                          onClick={() => {
                            setEditingPasskeyId(null);
                          }}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button className="button button--primary" disabled={busy} type="submit">
                          Save name
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div>
                        <h3>{displayName}</h3>
                        {createdDate ? <p>Added {createdDate}</p> : null}
                      </div>
                      <div className="form-actions">
                        <button
                          className="button button--secondary"
                          disabled={busy || addingPasskey}
                          onClick={() => {
                            setEditingPasskeyId(pk.id);
                            setEditingPasskeyName(pk.name ?? "");
                          }}
                          type="button"
                        >
                          Rename
                        </button>
                        <button
                          className="button button--danger"
                          disabled={busy || addingPasskey}
                          onClick={() => {
                            setDeletingPasskeyId(pk.id);
                          }}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        <div>
          <button
            className="button button--primary"
            disabled={addingPasskey || busy}
            onClick={() => {
              void handleAddPasskey();
            }}
            type="button"
          >
            {addingPasskey ? "Adding passkey…" : "Add a passkey"}
          </button>
        </div>
      </section>

      <section
        className="account-section account-section--security"
        aria-labelledby="password-title"
      >
        <div className="section-heading section-heading--compact">
          <h2 id="password-title">Account password</h2>
        </div>
        {securityState.status === "loading" ? (
          <p className="notice notice--info" role="status">
            Loading password status…
          </p>
        ) : securityState.status === "error" ? (
          <p className="notice notice--error" role="alert">
            Password status could not be loaded. Refresh the page and try again.
          </p>
        ) : (
          <>
            <p className="section-description">
              Passkey is the preferred sign-in method. Email code provides account recovery and
              fallback. A password is optional and can be set or changed only by you.
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
    </>
  );
}
