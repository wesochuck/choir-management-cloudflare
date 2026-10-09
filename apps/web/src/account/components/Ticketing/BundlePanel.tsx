import type { OrganizationEvent, TicketBundle } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
  type SyntheticEvent,
} from "react";
import { money } from "./shared";

const allowedGraphicTypes = ["image/jpeg", "image/png", "image/webp"];
const maxGraphicBytes = 5 * 1024 * 1024;

function BundleGraphicField({
  bundleGraphicFile,
  bundleGraphicFileId,
  setBundleGraphicFile,
  setBundleGraphicFileId,
}: {
  readonly bundleGraphicFile: File | null;
  readonly bundleGraphicFileId: string | null;
  readonly setBundleGraphicFile: Dispatch<SetStateAction<File | null>>;
  readonly setBundleGraphicFileId: Dispatch<SetStateAction<string | null>>;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [graphicError, setGraphicError] = useState<string | null>(null);
  const [graphicDragging, setGraphicDragging] = useState(false);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  function handleGraphicFile(nextFile: File | null): void {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (!nextFile) {
      setPreviewUrl(null);
      setGraphicError(null);
      setBundleGraphicFile(null);
      return;
    }
    if (!allowedGraphicTypes.includes(nextFile.type)) {
      setPreviewUrl(null);
      setGraphicError("Choose a PNG, JPG, or WebP image.");
      return;
    }
    if (nextFile.size > maxGraphicBytes) {
      setPreviewUrl(null);
      setGraphicError("Graphic file size must not exceed 5MB.");
      return;
    }
    const nextPreview = URL.createObjectURL(nextFile);
    previewUrlRef.current = nextPreview;
    setPreviewUrl(nextPreview);
    setGraphicError(null);
    setBundleGraphicFile(nextFile);
  }

  function handleRemoveGraphicFile(): void {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setGraphicError(null);
    setBundleGraphicFile(null);
  }

  function handleGraphicDrop(dropEvent: DragEvent<HTMLLabelElement>): void {
    dropEvent.preventDefault();
    setGraphicDragging(false);
    handleGraphicFile(dropEvent.dataTransfer.files[0] ?? null);
  }

  const activeGraphicPreviewUrl =
    previewUrl ??
    (bundleGraphicFileId
      ? `/api/organization/files/${encodeURIComponent(bundleGraphicFileId)}`
      : null);

  return (
    <div className="field">
      <div className="event-graphic-field">
        <label
          className={`event-graphic-dropzone${graphicDragging ? " is-dragging" : ""}`}
          htmlFor="bundle-graphic"
          onDragLeave={() => {
            setGraphicDragging(false);
          }}
          onDragOver={(dragEvent) => {
            dragEvent.preventDefault();
            setGraphicDragging(true);
          }}
          onDrop={handleGraphicDrop}
        >
          <span className="event-graphic-dropzone__title">Public graphic</span>
          {activeGraphicPreviewUrl ? (
            <div className="event-graphic-dropzone__preview">
              <img
                alt="Bundle graphic preview"
                className="event-graphic-dropzone__image"
                src={activeGraphicPreviewUrl}
              />
            </div>
          ) : null}
          <span className="event-graphic-dropzone__label">
            {bundleGraphicFile ? (
              <>
                Selected: <strong>{bundleGraphicFile.name}</strong>
              </>
            ) : (
              <>
                Drag and drop an image here, or{" "}
                <span className="event-graphic-dropzone__browse">browse</span>
              </>
            )}
          </span>
          <span className="field-help">
            {bundleGraphicFileId && !bundleGraphicFile
              ? "An image is already saved. Choose another image to replace it."
              : "PNG, JPG, or WebP images are supported."}
          </span>
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-describedby={graphicError ? "bundle-graphic-error" : undefined}
            aria-invalid={Boolean(graphicError)}
            className="sr-only"
            id="bundle-graphic"
            onChange={(change) => {
              handleGraphicFile(change.target.files?.[0] ?? null);
              change.target.value = "";
            }}
            type="file"
          />
        </label>
        {graphicError ? (
          <p className="notice notice--error" id="bundle-graphic-error" role="alert">
            {graphicError}
          </p>
        ) : null}
        {bundleGraphicFile ? (
          <button className="text-button" onClick={handleRemoveGraphicFile} type="button">
            Remove selected image
          </button>
        ) : bundleGraphicFileId ? (
          <button
            className="text-button"
            onClick={() => {
              setGraphicError(null);
              setBundleGraphicFileId(null);
            }}
            type="button"
          >
            Remove saved image
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function BundlePanel({
  bundleCapacity,
  bundleDialogOpen,
  bundleError,
  bundleEventIds,
  bundleGraphicFile,
  bundleGraphicFileId,
  bundleIsActive,
  bundlePrice,
  bundleSaleEnd,
  bundleTitle,
  bundles,
  busy,
  closeBundleDialog,
  editBundle,
  editingBundleId,
  openNewBundle,
  removeBundle,
  saveBundle,
  setBundleCapacity,
  setBundleEventIds,
  setBundleGraphicFile,
  setBundleGraphicFileId,
  setBundleIsActive,
  setBundlePrice,
  setBundleSaleEnd,
  setBundleTitle,
  ticketEvents,
}: {
  readonly bundleCapacity: string;
  readonly bundleDialogOpen: boolean;
  readonly bundleError?: string | null | undefined;
  readonly bundleEventIds: readonly string[];
  readonly bundleGraphicFile: File | null;
  readonly bundleGraphicFileId: string | null;
  readonly bundleIsActive: boolean;
  readonly bundlePrice: string;
  readonly bundleSaleEnd: string;
  readonly bundleTitle: string;
  readonly bundles: readonly TicketBundle[];
  readonly busy: boolean;
  readonly closeBundleDialog: () => void;
  readonly editBundle: (bundle: TicketBundle) => void;
  readonly editingBundleId: string | null;
  readonly openNewBundle: () => void;
  readonly removeBundle: (bundleId: string) => Promise<void>;
  readonly saveBundle: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
  readonly setBundleCapacity: Dispatch<SetStateAction<string>>;
  readonly setBundleEventIds: Dispatch<SetStateAction<readonly string[]>>;
  readonly setBundleGraphicFile: Dispatch<SetStateAction<File | null>>;
  readonly setBundleGraphicFileId: Dispatch<SetStateAction<string | null>>;
  readonly setBundleIsActive: Dispatch<SetStateAction<boolean>>;
  readonly setBundlePrice: Dispatch<SetStateAction<string>>;
  readonly setBundleSaleEnd: Dispatch<SetStateAction<string>>;
  readonly setBundleTitle: Dispatch<SetStateAction<string>>;
  readonly ticketEvents: readonly OrganizationEvent[];
}) {
  return (
    <div
      aria-labelledby="ticketing-bundles-tab"
      className="split-panel"
      id="ticketing-bundles-panel"
      role="tabpanel"
    >
      <div>
        <h3>Ticket bundles</h3>
        <button className="button button--primary" onClick={openNewBundle} type="button">
          New ticket bundle
        </button>
      </div>
      <Dialog
        description="Set pricing, capacity, sale timing, and included performances."
        onClose={closeBundleDialog}
        open={bundleDialogOpen}
        title={editingBundleId ? "Edit ticket bundle" : "New ticket bundle"}
      >
        {bundleError ? (
          <p className="notice notice--error" role="alert">
            {bundleError}
          </p>
        ) : null}
        <form className="form-stack" onSubmit={(formEvent) => void saveBundle(formEvent)}>
          <div className="field">
            <label htmlFor="bundle-title">Bundle title</label>
            <input
              id="bundle-title"
              required
              maxLength={500}
              value={bundleTitle}
              onChange={(event) => {
                setBundleTitle(event.target.value);
              }}
            />
          </div>
          <div className="form-grid form-grid--two">
            <div className="field">
              <label htmlFor="bundle-price">Price (USD)</label>
              <input
                id="bundle-price"
                required
                min="0"
                step="0.01"
                type="number"
                value={bundlePrice}
                onChange={(event) => {
                  setBundlePrice(event.target.value);
                }}
              />
            </div>
            <div className="field">
              <label className="field__label-row" htmlFor="bundle-capacity">
                <span>Capacity</span>{" "}
                <span className="field-help field-help--inline">(blank is unlimited)</span>
              </label>
              <input
                id="bundle-capacity"
                min="1"
                step="1"
                type="number"
                value={bundleCapacity}
                onChange={(event) => {
                  setBundleCapacity(event.target.value);
                }}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="bundle-sale-end">Sale ends</label>
            <input
              id="bundle-sale-end"
              required
              type="datetime-local"
              value={bundleSaleEnd}
              onChange={(event) => {
                setBundleSaleEnd(event.target.value);
              }}
            />
          </div>
          <BundleGraphicField
            bundleGraphicFile={bundleGraphicFile}
            bundleGraphicFileId={bundleGraphicFileId}
            setBundleGraphicFile={setBundleGraphicFile}
            setBundleGraphicFileId={setBundleGraphicFileId}
          />
          <label>
            <input
              checked={bundleIsActive}
              type="checkbox"
              onChange={(event) => {
                setBundleIsActive(event.target.checked);
              }}
            />{" "}
            Active for public sale
          </label>
          <fieldset className="field">
            <legend>Included performances</legend>
            {ticketEvents.length === 0 ? <p>Create ticketed performances first.</p> : null}
            {ticketEvents.map((event) => (
              <label key={event.id}>
                <input
                  checked={bundleEventIds.includes(event.id)}
                  type="checkbox"
                  onChange={(change) => {
                    setBundleEventIds((current) =>
                      change.target.checked
                        ? [...current, event.id]
                        : current.filter((id) => id !== event.id),
                    );
                  }}
                />{" "}
                {event.title}
              </label>
            ))}
          </fieldset>
          <div className="dialog__actions">
            <DialogClose asChild>
              <button className="button button--secondary" disabled={busy} type="button">
                Cancel
              </button>
            </DialogClose>
            <button
              className="button button--primary"
              disabled={busy || bundleEventIds.length === 0}
              type="submit"
            >
              {busy ? "Saving…" : "Save bundle"}
            </button>
          </div>
        </form>
      </Dialog>
      <div>
        {bundles.length === 0 ? (
          <div className="empty-state">
            <p>No bundles yet.</p>
            <button className="button button--primary" onClick={openNewBundle} type="button">
              Create your first bundle
            </button>
          </div>
        ) : null}
        {bundles.map((bundle) => (
          <fieldset className="compact-card" key={bundle.id}>
            <legend>{bundle.title}</legend>
            <p>
              {money(bundle.priceCents)} · {bundle.eventIds.length} performance
              {bundle.eventIds.length === 1 ? "" : "s"} · {bundle.isActive ? "active" : "inactive"}
            </p>
            <div className="form-actions">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  editBundle(bundle);
                }}
                type="button"
              >
                Edit
              </button>
              <button
                className="text-button text-button--danger"
                disabled={busy}
                onClick={() => void removeBundle(bundle.id)}
                type="button"
              >
                Delete
              </button>
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
