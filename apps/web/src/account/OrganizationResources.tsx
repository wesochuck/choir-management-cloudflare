import type { OrganizationResource, OrganizationResourceRequest } from "@choir/contracts";
import { DataTable, Dialog } from "@choir/ui";
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<OrganizationResource | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function resetForm(): void {
    setEditingResource(null);
    setTitle("");
    setUrl("");
    setFile(null);
  }

  function closeDialog(): void {
    if (busy) return;
    setDialogOpen(false);
    resetForm();
  }

  function openAdd(): void {
    resetForm();
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }

  function openEdit(resource: OrganizationResource): void {
    setEditingResource(resource);
    setTitle(resource.title);
    setUrl(resource.url ?? "");
    setFile(null);
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }

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

  // eslint-disable-next-line complexity -- add/edit source validation and cleanup are intentionally co-located.
  async function saveResource() {
    const keepsExistingSource = Boolean(
      editingResource && (editingResource.fileId ?? editingResource.url),
    );
    if (!title.trim() || (!file && !url.trim() && !keepsExistingSource) || (file && url.trim())) {
      setError("Enter a title and choose either one file or one HTTPS link.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    let uploadedFileId: string | null = null;
    try {
      if (file) uploadedFileId = (await uploadPrivateOrganizationFile(file)).id;
      const normalizedUrl = url.trim();
      const request: OrganizationResourceRequest = {
        fileId: uploadedFileId,
        sortOrder: editingResource?.sortOrder ?? resources.length,
        title: title.trim(),
        url: uploadedFileId ? null : normalizedUrl ? normalizedUrl : (editingResource?.url ?? null),
      };
      const saved = editingResource
        ? await updateOrganizationResource(editingResource.id, {
            ...request,
            fileId: uploadedFileId ?? editingResource.fileId,
            url: uploadedFileId ? null : normalizedUrl ? normalizedUrl : editingResource.url,
          })
        : await createOrganizationResource(request);
      setResources((current) =>
        editingResource
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved],
      );
      setDialogOpen(false);
      resetForm();
      setSuccess(editingResource ? "Resource updated." : "Resource added.");
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
  const resourceIndex = (resource: OrganizationResource): number =>
    resources.findIndex(({ id }) => id === resource.id);

  return (
    <section className="panel organization-resources" aria-label="Organization resources">
      <p className="section-description">Shared files and trusted links for this Organization.</p>
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
        <DataTable
          columns={[
            {
              header: "Resource",
              id: "title",
              render: (resource) => (
                <a
                  href={
                    resource.fileId
                      ? `/api/organization/files/${encodeURIComponent(resource.fileId)}`
                      : (resource.url ?? "#")
                  }
                  rel="noreferrer"
                  target="_blank"
                >
                  <strong>{resource.title}</strong>
                </a>
              ),
              sortValue: (resource) => resource.title,
            },
            {
              header: "Source",
              id: "source",
              render: (resource) => (resource.fileId ? "Shared file" : "HTTPS link"),
              sortValue: (resource) => (resource.fileId ? "Shared file" : "HTTPS link"),
            },
            ...(manager
              ? [
                  {
                    header: "Actions",
                    id: "actions",
                    mobileLabel: "Manage",
                    render: (resource: OrganizationResource) => {
                      const index = resourceIndex(resource);
                      return (
                        <div className="table-actions">
                          <button
                            className="button button--secondary button--small"
                            disabled={busy || index <= 0}
                            onClick={() => void move(index, -1)}
                            type="button"
                          >
                            Move up
                          </button>
                          <button
                            className="button button--secondary button--small"
                            disabled={busy || index < 0 || index === resources.length - 1}
                            onClick={() => void move(index, 1)}
                            type="button"
                          >
                            Move down
                          </button>
                          <button
                            className="button button--secondary button--small"
                            disabled={busy}
                            onClick={() => {
                              openEdit(resource);
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="button button--danger button--small"
                            disabled={busy}
                            onClick={() => void remove(resource)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      );
                    },
                  },
                ]
              : []),
          ]}
          emptyMessage="No resources have been shared yet."
          keySelector={(resource) => resource.id}
          rowLabel={(resource) => `Edit resource ${resource.title}`}
          rows={resources}
          {...(manager ? { onRowClick: openEdit } : {})}
        />
      )}
      {manager ? (
        <>
          <button className="button button--primary" onClick={openAdd} type="button">
            Add resource
          </button>
          <Dialog
            description="Share a file or trusted HTTPS link with Organization members."
            onClose={closeDialog}
            open={dialogOpen}
            title={editingResource ? "Edit resource" : "Add resource"}
          >
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void saveResource();
              }}
            >
              {error ? (
                <p className="notice notice--error" role="alert">
                  {error}
                </p>
              ) : null}
              <label className="field" htmlFor="resource-title">
                Title
                <input
                  autoFocus
                  id="resource-title"
                  maxLength={300}
                  onChange={(event) => {
                    setTitle(event.target.value);
                  }}
                  required
                  value={title}
                />
              </label>
              <label className="field" htmlFor="resource-url">
                HTTPS link
                <input
                  id="resource-url"
                  onChange={(event) => {
                    if (event.target.value) setFile(null);
                    setUrl(event.target.value);
                  }}
                  placeholder="https://"
                  type="url"
                  value={url}
                />
              </label>
              <label className="field" htmlFor="resource-file">
                {editingResource ? "Replace file (optional)" : "Or upload a file"}
                <input
                  id="resource-file"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    if (event.target.files?.[0]) setUrl("");
                  }}
                  type="file"
                />
              </label>
              <p className="field-help">
                Choose exactly one source. Leave the file blank when editing a link or keeping the
                existing file.
              </p>
              <div className="dialog__actions">
                <button className="button button--secondary" onClick={closeDialog} type="button">
                  Cancel
                </button>
                <button className="button button--primary" disabled={busy} type="submit">
                  {busy ? "Saving…" : editingResource ? "Save changes" : "Add resource"}
                </button>
              </div>
            </form>
          </Dialog>
        </>
      ) : null}
    </section>
  );
}
