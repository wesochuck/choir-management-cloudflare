import type { PlatformOrganizationSummary } from "@choir/contracts";
import { useEffect, useState } from "react";

import { AuthApiError, listPlatformOrganizations, provisionOrganization } from "../../../auth/api";
import { FleetSchemaPreparation } from "./FleetSchemaPreparation";
import { PlatformOrganizationDomains } from "./OrganizationDomains";
import {
  organizationAccessHref,
  organizationHref,
  organizationStatus,
  type DirectoryState,
} from "./shared";

export function OrganizationDirectory() {
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState<DirectoryState>({ status: "loading" });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    listPlatformOrganizations(null, abortController.signal)
      .then((result) => {
        setDirectory({
          nextCursor: result.nextCursor,
          organizations: result.organizations,
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setDirectory({ status: "error" });
        }
      });
    return () => {
      abortController.abort();
    };
  }, []);

  async function loadMore() {
    if (directory.status !== "ready" || !directory.nextCursor) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result = await listPlatformOrganizations(directory.nextCursor);
      setDirectory({
        nextCursor: result.nextCursor,
        organizations: [...directory.organizations, ...result.organizations],
        status: "ready",
      });
    } catch {
      setActionError("More Organizations could not be loaded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createOrganization() {
    const normalizedName = name.trim();
    const normalizedSlug = slug.trim().toLowerCase();
    if (!normalizedName || normalizedName.length > 120) {
      setActionError("Enter an Organization name of at most 120 characters.");
      return;
    }
    if (
      normalizedSlug.length < 2 ||
      normalizedSlug.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(normalizedSlug)
    ) {
      setActionError(
        "Use 2–63 lowercase letters, numbers, or interior hyphens for the hostname slug.",
      );
      return;
    }

    setBusy(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const result = await provisionOrganization({ name: normalizedName, slug: normalizedSlug });
      const pendingOrganization: PlatformOrganizationSummary = {
        canonicalHostname: result.canonicalHostname,
        canonicalStatus: result.canonicalStatus,
        lifecycleState: result.lifecycleState,
        name: normalizedName,
        operationalSchemaVersion: 0,
        organizationId: result.organizationId,
        provisionedAt: null,
        slug: normalizedSlug,
      };
      setDirectory((current) =>
        current.status === "ready"
          ? {
              ...current,
              organizations: [
                pendingOrganization,
                ...current.organizations.filter(
                  (organization) => organization.organizationId !== result.organizationId,
                ),
              ],
            }
          : current,
      );
      setName("");
      setSlug("");
      setSuccessMessage(
        result.canonicalStatus === "active"
          ? `${normalizedName} provisioning started.`
          : `${normalizedName} provisioning started. Its canonical hostname remains pending until a managed Cloudflare domain is configured.`,
      );
    } catch (error: unknown) {
      setActionError(
        error instanceof AuthApiError
          ? error.message
          : "Organization provisioning could not be started. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="platform-operations" aria-labelledby="platform-provisioning-title">
      <div className="section-heading section-heading--nested platform-operation__heading">
        <h3 id="platform-provisioning-title">Organization provisioning</h3>
        <p>
          Create one audited Organization registry and Durable Object at a time. Canonical hostname
          activation stays pending on workers.dev until a managed Cloudflare domain is available.
          Select an Organization below to open it or manage temporary scoped Platform access.
        </p>
      </div>
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
      <form
        className="form-stack platform-provisioning-form"
        onSubmit={(event) => {
          event.preventDefault();
          void createOrganization();
        }}
      >
        <div className="field">
          <label htmlFor="platform-organization-name">Organization name</label>
          <input
            autoComplete="organization"
            id="platform-organization-name"
            maxLength={120}
            onChange={(event) => {
              setName(event.target.value);
            }}
            required
            value={name}
          />
        </div>
        <div className="field">
          <label htmlFor="platform-organization-slug">Hostname slug</label>
          <input
            autoCapitalize="none"
            autoComplete="off"
            id="platform-organization-slug"
            maxLength={63}
            minLength={2}
            onChange={(event) => {
              setSlug(event.target.value.toLowerCase());
            }}
            pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
            required
            value={slug}
          />
        </div>
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Starting provisioning…" : "Create Organization"}
        </button>
      </form>

      <div className="platform-directory platform-directory--organizations" aria-live="polite">
        <h4>Platform Organizations</h4>
        {directory.status === "loading" ? <p>Loading Organizations…</p> : null}
        {directory.status === "error" ? (
          <p className="notice notice--error" role="alert">
            The Platform Organization directory could not be loaded. Refresh and try again.
          </p>
        ) : null}
        {directory.status === "ready" && directory.organizations.length === 0 ? (
          <p className="empty-state">No Organizations have been provisioned yet.</p>
        ) : null}
        {directory.status === "ready" && directory.organizations.length > 0 ? (
          <ul className="account-list platform-organization-list platform-organization-list--directory">
            {directory.organizations.map((organization) => {
              const ready = organizationStatus(organization) === "Ready";
              return (
                <li key={organization.organizationId}>
                  <div className="platform-organization-card__identity">
                    <h5>{organization.name}</h5>
                    <p>{organization.canonicalHostname}</p>
                    <span className="status-pill">{organizationStatus(organization)}</span>
                  </div>
                  <PlatformOrganizationDomains organizationId={organization.organizationId} />
                  {ready ? (
                    <div className="platform-organization-actions">
                      <a
                        className="button button--secondary"
                        href={organizationHref(organization.canonicalHostname)}
                      >
                        Open {organization.name}
                      </a>
                      <a
                        className="button button--secondary"
                        href={organizationAccessHref(organization.canonicalHostname)}
                      >
                        Manage access
                      </a>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {directory.status === "ready" && directory.nextCursor ? (
          <button
            className="button button--secondary platform-load-more"
            disabled={busy}
            onClick={() => {
              void loadMore();
            }}
            type="button"
          >
            {busy ? "Loading…" : "Load more Organizations"}
          </button>
        ) : null}
      </div>

      <FleetSchemaPreparation />
    </div>
  );
}
