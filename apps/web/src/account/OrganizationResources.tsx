import type { OrganizationResource, OrganizationResourceRequest } from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  createOrganizationResource,
  deleteOrganizationResource,
  listOrganizationResources,
  reorderOrganizationResources,
  updateOrganizationResource,
  uploadPrivateOrganizationFile,
} from "../auth/api";

function message(error: unknown): string {
  return error instanceof AuthApiError
    ? error.message
    : "Organization resources could not be updated.";
}

export function OrganizationResources({
  enabled,
  manager,
}: {
  readonly enabled: boolean;
  readonly manager: boolean;
}) {
  const [resources, setResources] = useState<readonly OrganizationResource[]>([]);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    listOrganizationResources(controller.signal)
      .then(setResources)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(message(failure));
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  async function addResource() {
    if (!title.trim() || (!file && !url.trim()) || (file && url.trim())) {
      setError("Enter a title and choose either one file or one HTTPS link.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    let uploadedFileId: string | null = null;
    try {
      if (file) uploadedFileId = (await uploadPrivateOrganizationFile(file)).id;
      const request: OrganizationResourceRequest = {
        fileId: uploadedFileId,
        sortOrder: resources.length,
        title: title.trim(),
        url: uploadedFileId ? null : url.trim(),
      };
      const created = await createOrganizationResource(request);
      setResources((current) => [...current, created]);
      setTitle("");
      setUrl("");
      setFile(null);
      setSuccess("Resource added.");
    } catch (failure: unknown) {
      setError(message(failure));
      if (uploadedFileId)
        await fetch(`/api/organization/files/${encodeURIComponent(uploadedFileId)}`, {
          method: "DELETE",
        }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function rename(resource: OrganizationResource) {
    const nextTitle = window.prompt("Resource title", resource.title)?.trim();
    if (!nextTitle || nextTitle === resource.title) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateOrganizationResource(resource.id, {
        fileId: resource.fileId,
        sortOrder: resource.sortOrder,
        title: nextTitle,
        url: resource.url,
      });
      setResources((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (failure: unknown) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(resource: OrganizationResource) {
    if (!window.confirm(`Delete “${resource.title}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganizationResource(resource.id);
      setResources((current) => current.filter(({ id }) => id !== resource.id));
    } catch (failure: unknown) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, delta: -1 | 1) {
    const next = [...resources];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const currentResource = next[index];
    const targetResource = next[target];
    if (!currentResource || !targetResource) return;
    next[index] = targetResource;
    next[target] = currentResource;
    setBusy(true);
    setError(null);
    try {
      await reorderOrganizationResources(next.map(({ id }) => id));
      setResources(next.map((item, sortOrder) => ({ ...item, sortOrder })));
    } catch (failure: unknown) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;
  return (
    <section className="panel" aria-labelledby="organization-resources-heading">
      <p className="eyebrow">Member library</p>
      <h2 id="organization-resources-heading">Organization resources</h2>
      <p>Shared files and trusted links for this Organization.</p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      {resources.length === 0 ? (
        <p>No resources have been shared yet.</p>
      ) : (
        <ol>
          {resources.map((resource, index) => (
            <li key={resource.id}>
              <a
                href={
                  resource.fileId
                    ? `/api/organization/files/${encodeURIComponent(resource.fileId)}`
                    : (resource.url ?? "#")
                }
                rel="noreferrer"
                target="_blank"
              >
                {resource.title}
              </a>
              {manager ? (
                <span className="button-row">
                  <button
                    disabled={busy || index === 0}
                    onClick={() => void move(index, -1)}
                    type="button"
                  >
                    Up
                  </button>
                  <button
                    disabled={busy || index === resources.length - 1}
                    onClick={() => void move(index, 1)}
                    type="button"
                  >
                    Down
                  </button>
                  <button disabled={busy} onClick={() => void rename(resource)} type="button">
                    Rename
                  </button>
                  <button disabled={busy} onClick={() => void remove(resource)} type="button">
                    Delete
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {manager ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void addResource();
          }}
        >
          <h3>Add a resource</h3>
          <label htmlFor="resource-title">Title</label>
          <input
            id="resource-title"
            maxLength={300}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            value={title}
          />
          <label htmlFor="resource-url">HTTPS link</label>
          <input
            id="resource-url"
            onChange={(event) => {
              setUrl(event.target.value);
            }}
            placeholder="https://"
            type="url"
            value={url}
          />
          <label htmlFor="resource-file">Or upload a file</label>
          <input
            id="resource-file"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
            }}
            type="file"
          />
          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Saving…" : "Add resource"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
