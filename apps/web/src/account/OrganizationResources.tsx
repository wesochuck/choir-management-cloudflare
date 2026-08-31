import type { OrganizationResource, OrganizationResourceRequest } from "@choir/contracts";
import { DataTable, Dialog, DialogClose, useConfirmation } from "@choir/ui";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  AuthApiError,
  createOrganizationResource,
  deleteOrganizationResource,
  deletePrivateOrganizationFile,
  listOrganizationResources,
  reorderOrganizationResources,
  updateOrganizationResource,
  uploadPrivateOrganizationFile,
} from "../api";

function message(error: unknown): string {
  return error instanceof AuthApiError
    ? error.message
    : "Organization resources could not be updated.";
}

function dropBoundaryForPosition(
  target: HTMLElement,
  clientY: number,
  resourceIndex: number,
): number {
  const bounds = target.getBoundingClientRect();
  return clientY < bounds.top + bounds.height / 2 ? resourceIndex : resourceIndex + 1;
}

function dropBoundaryForEvent(event: DragEvent<HTMLElement>, resourceIndex: number): number {
  return dropBoundaryForPosition(event.currentTarget, event.clientY, resourceIndex);
}

function dropBoundaryForPointerEvent(
  event: PointerEvent<HTMLElement>,
  resourceIndex: number,
): number {
  return dropBoundaryForPosition(event.currentTarget, event.clientY, resourceIndex);
}

function canDropAtBoundary(boundary: number, dragIndex: number | null): boolean {
  return dragIndex !== null && boundary !== dragIndex && boundary !== dragIndex + 1;
}

function moveResource(
  resources: readonly OrganizationResource[],
  fromIndex: number,
  toIndex: number,
): readonly OrganizationResource[] {
  const next = [...resources];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return resources;
  next.splice(toIndex, 0, moved);
  return next.map((resource, sortOrder) => ({ ...resource, sortOrder }));
}

function resourceOrdersMatch(
  left: readonly OrganizationResource[],
  right: readonly OrganizationResource[],
): boolean {
  return (
    left.length === right.length &&
    left.every((resource, index) => resource.id === right[index]?.id)
  );
}

function reorderHandleLabel(
  title: string,
  index: number,
  resourceCount: number,
  keyboardDragging: boolean,
): string {
  return `${keyboardDragging ? "Reordering" : "Reorder"} ${title}, position ${String(index + 1)} of ${String(resourceCount)}`;
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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverBoundary, setDragOverBoundary] = useState<number | null>(null);
  const [keyboardDragIndex, setKeyboardDragIndex] = useState<number | null>(null);
  const [keyboardDragOriginResources, setKeyboardDragOriginResources] = useState<
    readonly OrganizationResource[] | null
  >(null);
  const [recentlyMovedResourceId, setRecentlyMovedResourceId] = useState<string | null>(null);
  const movedFlashTimerRef = useRef<number | null>(null);
  const { confirm, confirmationDialog } = useConfirmation();

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

  useEffect(() => {
    return () => {
      if (movedFlashTimerRef.current !== null) {
        window.clearTimeout(movedFlashTimerRef.current);
      }
    };
  }, []);

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
        await deletePrivateOrganizationFile(uploadedFileId).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function remove(resource: OrganizationResource) {
    const shouldDelete = await confirm({
      confirmLabel: "Delete resource",
      description: `This will permanently remove “${resource.title}” from the Organization resources.`,
      destructive: true,
      title: "Delete resource?",
    });
    if (!shouldDelete) return;
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

  function flashMovedResource(resourceId: string): void {
    setRecentlyMovedResourceId(resourceId);
    setSuccess("Resources reordered.");
    if (movedFlashTimerRef.current !== null) {
      window.clearTimeout(movedFlashTimerRef.current);
    }
    movedFlashTimerRef.current = window.setTimeout(() => {
      setRecentlyMovedResourceId((current) => (current === resourceId ? null : current));
      movedFlashTimerRef.current = null;
    }, 900);
  }

  async function persistResourceOrder(
    next: readonly OrganizationResource[],
    rollbackResources?: readonly OrganizationResource[],
    movedResourceId?: string,
  ): Promise<void> {
    const previousResources = rollbackResources ?? resources;
    if (next.length < 2 || resourceOrdersMatch(previousResources, next)) {
      setResources(next.map((resource, sortOrder) => ({ ...resource, sortOrder })));
      setSuccess("Resource order unchanged.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await reorderOrganizationResources(next.map(({ id }) => id));
      setResources(next.map((item, sortOrder) => ({ ...item, sortOrder })));
      if (movedResourceId) flashMovedResource(movedResourceId);
    } catch (failure: unknown) {
      if (rollbackResources) setResources(rollbackResources);
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  function clearPointerReorder(): void {
    setDragIndex(null);
    setDragOverBoundary(null);
  }

  function dropResourceAtBoundary(boundary: number): void {
    const currentDragIndex = dragIndex;
    if (!canDropAtBoundary(boundary, currentDragIndex) || currentDragIndex === null) {
      clearPointerReorder();
      return;
    }
    const movedResource = resources[currentDragIndex];
    const next = moveResource(
      resources,
      currentDragIndex,
      boundary > currentDragIndex ? boundary - 1 : boundary,
    );
    clearPointerReorder();
    void persistResourceOrder(next, undefined, movedResource?.id);
  }

  function startResourceDrag(index: number): void {
    if (busy) return;
    setKeyboardDragIndex(null);
    setKeyboardDragOriginResources(null);
    setRecentlyMovedResourceId(null);
    setDragIndex(index);
    setDragOverBoundary(null);
    setSuccess(null);
  }

  function handleResourceDragStart(event: DragEvent<HTMLButtonElement>, index: number): void {
    if (busy) {
      event.preventDefault();
      return;
    }
    startResourceDrag(index);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleResourcePointerDown(event: PointerEvent<HTMLButtonElement>, index: number): void {
    if (event.pointerType === "touch") startResourceDrag(index);
  }

  function moveKeyboardResource(direction: -1 | 1): void {
    if (keyboardDragIndex === null) return;
    const movedResource = resources[keyboardDragIndex];
    const targetIndex = keyboardDragIndex + direction;
    if (!movedResource || targetIndex < 0 || targetIndex >= resources.length) return;
    setResources((current) => [...moveResource(current, keyboardDragIndex, targetIndex)]);
    setKeyboardDragIndex(targetIndex);
    setSuccess(
      `${movedResource.title} moved to position ${String(targetIndex + 1)}. Use the arrow keys to continue, or press Space or Enter to drop.`,
    );
  }

  function cancelKeyboardReorder(): void {
    if (keyboardDragIndex === null) return;
    const movedResource = resources[keyboardDragIndex];
    if (keyboardDragOriginResources) setResources(keyboardDragOriginResources);
    setKeyboardDragIndex(null);
    setKeyboardDragOriginResources(null);
    setSuccess(`${movedResource?.title ?? "Resource"} reordering canceled.`);
  }

  function toggleKeyboardReorder(index: number, isActive: boolean): void {
    if (keyboardDragIndex === null) {
      const resource = resources[index];
      if (!resource) return;
      setKeyboardDragIndex(index);
      setKeyboardDragOriginResources(resources);
      setSuccess(
        `Picked up ${resource.title}, position ${String(index + 1)} of ${String(resources.length)}. Use the arrow keys to move, or press Space or Enter to drop.`,
      );
      return;
    }
    if (!isActive) return;
    const resource = resources[index];
    const originResources = keyboardDragOriginResources;
    setKeyboardDragIndex(null);
    setKeyboardDragOriginResources(null);
    if (originResources && resourceOrdersMatch(originResources, resources)) {
      setSuccess(`${resource?.title ?? "Resource"} dropped at position ${String(index + 1)}.`);
      return;
    }
    void persistResourceOrder(resources, originResources ?? undefined, resource?.id);
  }

  function handleKeyboardReorderKeyDown(
    index: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ): void {
    if (busy) return;
    const isActive = keyboardDragIndex === index;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggleKeyboardReorder(index, isActive);
      return;
    }
    if (event.key === "Escape" && isActive) {
      event.preventDefault();
      cancelKeyboardReorder();
      return;
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && isActive) {
      event.preventDefault();
      moveKeyboardResource(event.key === "ArrowUp" ? -1 : 1);
    }
  }

  if (!enabled) return null;
  const resourceIndex = (resource: OrganizationResource): number =>
    resources.findIndex(({ id }) => id === resource.id);

  return (
    <fieldset className="surface-card organization-settings-panel organization-resources">
      <legend>Resources</legend>
      {error && !dialogOpen ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {success && !dialogOpen ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      {resources.length === 0 ? (
        <p>No resources have been shared yet.</p>
      ) : (
        <>
          {manager ? (
            <>
              <p className="field-help" aria-live="polite">
                Drag a resource by its handle to reorder it, or focus the handle and press Space or
                Enter to pick it up. Use the arrow keys to move it, then press Space or Enter to
                drop; Escape cancels.
              </p>
              <p className="sr-only" id="organization-resources-reorder-help">
                Press Space or Enter to pick up this resource. Use Arrow Up or Arrow Down to move
                it. Press Space or Enter to drop it, or Escape to cancel.
              </p>
            </>
          ) : null}
          <DataTable
            {...(manager
              ? {
                  getRowProps: (
                    _resource: OrganizationResource,
                    context: { readonly index: number },
                  ) => {
                    const index = context.index;
                    const isKeyboardDragging = keyboardDragIndex === index;
                    const isDragging = dragIndex === index || isKeyboardDragging;
                    const dropBefore =
                      dragOverBoundary === index && canDropAtBoundary(index, dragIndex);
                    const dropAfter =
                      dragOverBoundary === index + 1 && canDropAtBoundary(index + 1, dragIndex);
                    const recentlyMoved = recentlyMovedResourceId === _resource.id;
                    return {
                      className: `organization-resource-row${isDragging ? " organization-resource-row--dragging" : ""}${dropBefore ? " organization-resource-row--drop-before" : ""}${dropAfter ? " organization-resource-row--drop-after" : ""}${recentlyMoved ? " organization-resource-row--moved" : ""}`,
                      onDragEnd: () => {
                        clearPointerReorder();
                      },
                      onDragOver: (event) => {
                        if (dragIndex === null || busy) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDragOverBoundary(dropBoundaryForEvent(event, index));
                      },
                      onDrop: (event) => {
                        event.preventDefault();
                        dropResourceAtBoundary(dropBoundaryForEvent(event, index));
                      },
                      onPointerCancel: (event) => {
                        if (event.pointerType === "touch") clearPointerReorder();
                      },
                      onPointerUp: (event) => {
                        if (event.pointerType === "touch" && dragIndex !== null) {
                          dropResourceAtBoundary(dropBoundaryForPointerEvent(event, index));
                        }
                      },
                    };
                  },
                }
              : {})}
            columns={[
              {
                header: "Resource",
                id: "title",
                // Resource order is an explicit user-controlled order, so sorting this column
                // would conflict with the drag position shown to the user.
                render: (resource) => {
                  const index = resourceIndex(resource);
                  const keyboardDragging = keyboardDragIndex === index;
                  return (
                    <div className="organization-resource-title">
                      {manager ? (
                        <button
                          aria-describedby="organization-resources-reorder-help"
                          aria-label={reorderHandleLabel(
                            resource.title,
                            index,
                            resources.length,
                            keyboardDragging,
                          )}
                          aria-pressed={keyboardDragging}
                          className="set-list-drag-handle organization-resource-drag-handle"
                          disabled={busy}
                          draggable={!busy}
                          onDragStart={(event) => {
                            handleResourceDragStart(event, index);
                          }}
                          onKeyDown={(event) => {
                            handleKeyboardReorderKeyDown(index, event);
                          }}
                          onPointerDown={(event) => {
                            handleResourcePointerDown(event, index);
                          }}
                          title="Drag to reorder, or press Space or Enter for keyboard control"
                          type="button"
                        >
                          <span aria-hidden="true" />
                        </button>
                      ) : null}
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
                    </div>
                  );
                },
              },
              {
                header: "Source",
                id: "source",
                render: (resource) => (resource.fileId ? "Shared file" : "HTTPS link"),
              },
              ...(manager
                ? [
                    {
                      header: "Actions",
                      id: "actions",
                      mobileLabel: "Manage",
                      render: (resource: OrganizationResource) => {
                        return (
                          <div className="table-actions">
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
        </>
      )}
      {manager ? (
        <>
          <button className="button button--primary" onClick={openAdd} type="button">
            Add resource
          </button>
          <ResourceDialog
            busy={busy}
            closeDialog={closeDialog}
            dialogOpen={dialogOpen}
            editingResource={editingResource}
            error={error}
            file={file}
            saveResource={saveResource}
            setFile={setFile}
            setTitle={setTitle}
            setUrl={setUrl}
            title={title}
            url={url}
          />
          {confirmationDialog}
        </>
      ) : null}
    </fieldset>
  );
}

function ResourceDialog({
  busy,
  closeDialog,
  dialogOpen,
  editingResource,
  error,
  saveResource,
  setFile,
  setTitle,
  setUrl,
  title,
  url,
}: {
  readonly busy: boolean;
  readonly closeDialog: () => void;
  readonly dialogOpen: boolean;
  readonly editingResource: OrganizationResource | null;
  readonly error: string | null;
  readonly file: File | null;
  readonly saveResource: () => Promise<void>;
  readonly setFile: (file: File | null) => void;
  readonly setTitle: (title: string) => void;
  readonly setUrl: (url: string) => void;
  readonly title: string;
  readonly url: string;
}) {
  return (
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
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Cancel
            </button>
          </DialogClose>
          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Saving…" : editingResource ? "Save changes" : "Add resource"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
