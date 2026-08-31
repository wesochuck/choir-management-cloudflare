import { useState, useEffect, useRef } from "react";
import type { OrganizationBranding } from "@choir/contracts";
import {
  AuthApiError,
  getOrganizationBranding,
  updateOrganizationBranding,
  uploadPrivateOrganizationFile,
} from "../auth/api";
import { usePersistedDraft } from "../persistence";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export function OrganizationBrandingPanel() {
  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  const brandingRef = useRef<OrganizationBranding | null>(null);
  brandingRef.current = branding;

  const [loading, setLoading] = useState(true);
  const [logoBusy, setLogoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    draft: addressDraft,
    error: addressError,
    persisted: savedAddress,
    saving: addressSaving,
    setDraft: setAddressDraft,
  } = usePersistedDraft<string>({
    initialValue: branding ? (branding.physicalAddress ?? "") : null,
    normalize: (addr) => addr.trim(),
    onSaveSuccess: () => {
      setSuccess("Organization address updated successfully.");
    },
    resourceKey: "organization-branding-address",
    save: async (nextAddress) => {
      const updated = await updateOrganizationBranding({
        logoFileId: brandingRef.current?.logoFileId ?? null,
        physicalAddress: nextAddress.trim() ? nextAddress.trim() : null,
      });
      setBranding(updated);
      return updated.physicalAddress ?? "";
    },
  });

  useEffect(() => {
    const controller = new AbortController();
    getOrganizationBranding(controller.signal)
      .then((data) => {
        setBranding(data);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof AuthApiError
              ? loadError.message
              : "Failed to load organization branding.",
          );
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
      setError("Please select a valid image file (PNG, JPEG, WebP, or SVG).");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (file.size > MAX_LOGO_BYTES) {
      setError("Logo file size must not exceed 5MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setError(null);
    setSuccess(null);
    setLogoBusy(true);

    try {
      const uploadResult = await uploadPrivateOrganizationFile(file, file.name);
      // Decouple from uncommitted address draft by persisting only already-saved address
      const persistedPhysicalAddress =
        savedAddress !== null ? savedAddress.trim() || null : (branding?.physicalAddress ?? null);
      const updated = await updateOrganizationBranding({
        logoFileId: uploadResult.id,
        physicalAddress: persistedPhysicalAddress,
      });
      setBranding(updated);
      setSuccess("Organization logo updated successfully.");
    } catch (saveError: unknown) {
      setError(
        saveError instanceof AuthApiError
          ? saveError.message
          : "Failed to upload or save organization logo.",
      );
    } finally {
      setLogoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemoveLogo() {
    setError(null);
    setSuccess(null);
    setLogoBusy(true);

    try {
      const persistedPhysicalAddress =
        savedAddress !== null ? savedAddress.trim() || null : (branding?.physicalAddress ?? null);
      const updated = await updateOrganizationBranding({
        logoFileId: null,
        physicalAddress: persistedPhysicalAddress,
      });
      setBranding(updated);
      setSuccess("Organization logo removed successfully.");
    } catch (removeError: unknown) {
      setError(
        removeError instanceof AuthApiError
          ? removeError.message
          : "Failed to remove organization logo.",
      );
    } finally {
      setLogoBusy(false);
    }
  }

  const busy = logoBusy || addressSaving;
  const effectiveError = error ?? addressError;

  const initials = branding?.organizationName
    ? branding.organizationName
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "CM";

  return (
    <fieldset className="surface-card organization-settings-panel">
      <legend id="branding-settings-title">Organization Branding & Identity</legend>
      <div className="section-heading section-heading--compact">
        <p className="section-description">
          Manage your Organization logo and official physical postal address. These represent the
          Organization across member interfaces and outbound communication footers.
        </p>
      </div>

      {effectiveError ? (
        <div className="notice notice--error" role="alert">
          <p>{effectiveError}</p>
        </div>
      ) : null}

      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}

      {loading ? (
        <p role="status">Loading branding settings…</p>
      ) : (
        <div className="form-stack settings-form">
          <div
            className="branding-preview-row"
            style={{ display: "flex", alignItems: "center", gap: "1.5rem", margin: "1rem 0" }}
          >
            <div
              className="branding-preview-box"
              style={{
                width: "96px",
                height: "96px",
                borderRadius: "8px",
                border: "1px solid var(--color-border, #dedde5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "var(--color-surface-elevated, #f9f9fb)",
                overflow: "hidden",
                padding: "8px",
              }}
            >
              {branding?.logoFileId ? (
                <img
                  src={`/api/organization/files/${encodeURIComponent(branding.logoFileId)}`}
                  alt="Organization logo preview"
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                />
              ) : (
                <span
                  style={{
                    backgroundColor: "var(--color-accent, #1b4d3e)",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: "1.25rem",
                    borderRadius: "6px",
                    width: "48px",
                    height: "48px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {initials}
                </span>
              )}
            </div>

            <div
              className="branding-actions"
              style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_MIME_TYPES.join(",")}
                onChange={(event) => {
                  void handleFileChange(event);
                }}
                disabled={busy}
                style={{ display: "none" }}
                id="org-logo-upload-input"
              />
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="button button--secondary button--sm"
                  disabled={busy}
                  onClick={() => {
                    fileInputRef.current?.click();
                  }}
                >
                  {busy ? "Uploading…" : branding?.logoFileId ? "Change logo" : "Upload logo"}
                </button>
                {branding?.logoFileId ? (
                  <button
                    type="button"
                    className="button button--secondary button--sm"
                    disabled={busy}
                    onClick={() => {
                      void handleRemoveLogo();
                    }}
                  >
                    Remove logo
                  </button>
                ) : null}
              </div>
              <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted, #687078)" }}>
                Supported formats: PNG, JPEG, WebP, SVG (max 5MB).
              </span>
            </div>
          </div>

          <div
            className="field"
            style={{ borderTop: "1px solid var(--color-border, #dedde5)", paddingTop: "1rem" }}
          >
            <label htmlFor="org-physical-address">Physical Postal Address</label>
            <textarea
              id="org-physical-address"
              maxLength={2000}
              onChange={(e) => {
                setAddressDraft(e.target.value);
              }}
              placeholder="e.g. 123 Main St, Suite 400&#10;Seattle, WA 98101"
              rows={3}
              value={addressDraft ?? ""}
            />
            <p className="field-hint">
              The official physical mailing address or PO box of the Organization. Displayed in
              outbound email footers for CAN-SPAM and postal compliance.
            </p>
          </div>
        </div>
      )}
    </fieldset>
  );
}
