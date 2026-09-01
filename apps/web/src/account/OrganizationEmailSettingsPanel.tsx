import { useEffect, useState, type ChangeEvent } from "react";
import type { OrganizationEmailDomainDnsRecord, OrganizationEmailSettings } from "@choir/contracts";
import {
  AuthApiError,
  getOrganizationEmailSettings,
  updateOrganizationEmailSettings,
  verifyOrganizationEmailDomain,
} from "../auth/api";
import { usePersistedDraft } from "../persistence";

function DnsRecordRow({
  copiedKey,
  onCopy,
  record,
}: {
  readonly copiedKey: string | null;
  readonly onCopy: (key: string, text: string) => void;
  readonly record: OrganizationEmailDomainDnsRecord;
}) {
  const recordKey = `${record.type}-${record.name}`;
  const isCopied = copiedKey === recordKey;
  return (
    <tr>
      <td>
        <strong>{record.type}</strong>
      </td>
      <td style={{ wordBreak: "break-all" }}>
        <code>{record.name}</code>
      </td>
      <td style={{ wordBreak: "break-all" }}>
        <code>{record.value}</code>
      </td>
      <td style={{ textAlign: "center" }}>
        <span
          className={`status-pill status-pill--${
            record.status === "valid"
              ? "active"
              : record.status === "pending"
                ? "pending"
                : "inactive"
          }`}
        >
          {record.status === "valid"
            ? "Valid"
            : record.status === "pending"
              ? "Pending"
              : "Missing"}
        </span>
      </td>
      <td style={{ textAlign: "right" }}>
        <button
          className="button button--ghost button--xs"
          onClick={() => {
            onCopy(recordKey, record.value);
          }}
          type="button"
        >
          {isCopied ? "Copied!" : "Copy"}
        </button>
      </td>
    </tr>
  );
}

function DnsChecklist({
  dnsRecords,
  onVerify,
  status,
  verifyBusy,
}: {
  readonly dnsRecords: readonly OrganizationEmailDomainDnsRecord[];
  readonly onVerify: () => void;
  readonly status: "none" | "pending" | "active" | "degraded";
  readonly verifyBusy: boolean;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copyToClipboard(key: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 2000);
  }

  return (
    <div
      className="dns-checklist-panel"
      style={{
        background: "var(--color-bg-subtle, rgba(0,0,0,0.03))",
        borderRadius: "var(--radius-md, 8px)",
        marginTop: "1.5rem",
        padding: "1rem",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h3 style={{ fontSize: "1rem", margin: 0 }}>DNS Authentication Records</h3>
          <p className="field-hint" style={{ margin: "0.25rem 0 0" }}>
            Add these 4 records to your DNS provider (Cloudflare, GoDaddy, Namecheap, Route 53,
            etc.).
          </p>
        </div>
        <div style={{ alignItems: "center", display: "flex", gap: "0.5rem" }}>
          <span
            className={`badge badge--${
              status === "active" ? "success" : status === "pending" ? "warning" : "error"
            }`}
          >
            {status === "active"
              ? "Active & Verified"
              : status === "pending"
                ? "Pending DNS"
                : "Degraded"}
          </span>
          <button
            className="button button--secondary button--sm"
            disabled={verifyBusy}
            onClick={() => {
              onVerify();
            }}
            type="button"
          >
            {verifyBusy ? "Checking…" : "Verify DNS"}
          </button>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="table" style={{ fontSize: "0.875rem", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Type</th>
              <th style={{ textAlign: "left" }}>Name / Host</th>
              <th style={{ textAlign: "left" }}>Value / Destination</th>
              <th style={{ textAlign: "center" }}>Status</th>
              <th style={{ textAlign: "right" }}>Copy</th>
            </tr>
          </thead>
          <tbody>
            {dnsRecords.map((record) => (
              <DnsRecordRow
                copiedKey={copiedKey}
                key={`${record.type}-${record.name}`}
                onCopy={copyToClipboard}
                record={record}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OrganizationEmailSettingsPanel() {
  const [initialSettings, setInitialSettings] = useState<OrganizationEmailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);

  const {
    draft: settings,
    error: draftError,
    replaceDraft,
    saving,
    updateField,
  } = usePersistedDraft<OrganizationEmailSettings>({
    initialValue: initialSettings,
    normalize: (val) => ({
      ...val,
      customDomain: val.customDomain?.trim() ? val.customDomain.trim() : null,
      fromName: val.fromName?.trim() ? val.fromName.trim() : null,
      replyToEmail: val.replyToEmail?.trim() ? val.replyToEmail.trim() : null,
    }),
    onSaveSuccess: () => {
      setSuccess("Email settings saved successfully.");
    },
    resourceKey: "organization-email-settings",
    save: (draftVal) =>
      updateOrganizationEmailSettings({
        customDomain: draftVal.customDomain?.trim() ? draftVal.customDomain.trim() : null,
        fromName: draftVal.fromName?.trim() ? draftVal.fromName.trim() : null,
        replyToEmail: draftVal.replyToEmail?.trim() ? draftVal.replyToEmail.trim() : null,
      }),
  });

  useEffect(() => {
    const controller = new AbortController();
    getOrganizationEmailSettings(controller.signal)
      .then((loaded) => {
        setInitialSettings(loaded);
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof AuthApiError
              ? loadError.message
              : "Organization email settings could not be loaded.",
          );
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  async function handleVerifyDns() {
    setVerifyBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await verifyOrganizationEmailDomain();
      if (settings) {
        replaceDraft({
          ...settings,
          customDomainStatus: result.status,
          dnsRecords: result.dnsRecords,
          lastCheckedAt: new Date().toISOString(),
          verifiedAt: result.allValid ? new Date().toISOString() : settings.verifiedAt,
        });
      }
      if (result.allValid) {
        setSuccess("All DNS records verified! Custom domain sending is now active.");
      } else {
        setError(
          "Some DNS records are not yet verified. Please ensure records are added in your DNS provider.",
        );
      }
    } catch (verifyError: unknown) {
      setError(
        verifyError instanceof AuthApiError
          ? verifyError.message
          : "DNS verification check failed.",
      );
    } finally {
      setVerifyBusy(false);
    }
  }

  async function handleRemoveCustomDomain() {
    setRemoveBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await updateOrganizationEmailSettings({
        customDomain: null,
      });
      replaceDraft(updated);
      setSuccess(
        "Custom domain removed. Outbound emails will use the platform sender with your Reply-To address.",
      );
    } catch (removeError: unknown) {
      setError(
        removeError instanceof AuthApiError
          ? removeError.message
          : "Failed to remove custom domain.",
      );
    } finally {
      setRemoveBusy(false);
    }
  }

  const busy = saving || removeBusy;
  const effectiveError = error ?? draftError;

  return (
    <fieldset className="surface-card organization-settings-panel">
      <legend id="email-settings-title">Email & Sender Settings</legend>
      <div className="section-heading section-heading--compact">
        <p className="section-description">
          Configure sender information for outbound emails. The Organization's physical postal
          address configured in Organization Branding &amp; Identity is automatically included in
          email footers to satisfy CAN-SPAM and postal compliance.
        </p>
      </div>

      {loading ? <p role="status">Loading email settings…</p> : null}

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

      {!loading && settings ? (
        <div className="form-stack settings-form">
          <div className="field">
            <label htmlFor="email-from-name">Sender Display Name</label>
            <input
              disabled={busy}
              id="email-from-name"
              maxLength={100}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                updateField("fromName", e.target.value);
              }}
              placeholder="e.g. Seattle Men's Chorus"
              type="text"
              value={settings.fromName ?? ""}
            />
            <p className="field-hint">
              The sender name displayed on event reminders, ticket receipts, and member
              announcements.
            </p>
          </div>

          <div className="field">
            <label htmlFor="email-reply-to">Reply-To Email Address</label>
            <input
              disabled={busy}
              id="email-reply-to"
              maxLength={320}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                updateField("replyToEmail", e.target.value);
              }}
              placeholder="e.g. info@seattlechorus.org"
              type="email"
              value={settings.replyToEmail ?? ""}
            />
            <p className="field-hint">
              Directs replies from members and ticket buyers to your organization's staff mailbox.
              Active for all emails regardless of custom domain status.
            </p>
          </div>

          <div className="field">
            <label htmlFor="email-custom-domain">Custom Sending Subdomain (Optional)</label>
            <div
              className="inline-action-group"
              style={{ alignItems: "center", display: "flex", gap: "0.5rem" }}
            >
              <input
                disabled={busy}
                id="email-custom-domain"
                maxLength={253}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  updateField("customDomain", e.target.value);
                }}
                placeholder="e.g. mail.seattlechorus.org"
                style={{ flex: 1 }}
                type="text"
                value={settings.customDomain ?? ""}
              />
              {settings.customDomain ? (
                <button
                  className="button button--secondary button--sm"
                  disabled={busy || verifyBusy}
                  onClick={() => {
                    void handleRemoveCustomDomain();
                  }}
                  type="button"
                >
                  Remove Domain
                </button>
              ) : null}
            </div>
            <p className="field-hint">
              We recommend using a dedicated subdomain like <code>mail.yourchorus.org</code> to
              protect your main Google Workspace / Office 365 inbox reputation.
            </p>
          </div>

          {settings.customDomain && settings.dnsRecords.length > 0 ? (
            <DnsChecklist
              dnsRecords={settings.dnsRecords}
              onVerify={() => {
                void handleVerifyDns();
              }}
              status={settings.customDomainStatus}
              verifyBusy={verifyBusy}
            />
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
