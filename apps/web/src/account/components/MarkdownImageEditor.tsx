import type { WebsiteContentImage } from "@choir/domain";
import { Dialog, DialogClose } from "@choir/ui";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  AuthApiError,
  deletePrivateOrganizationFile,
  uploadPrivateOrganizationFile,
} from "../../api";

function imageFileError(file: File): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "Choose a JPEG, PNG, or WebP image.";
  return file.size <= 5 * 1024 * 1024 ? null : "Images must be 5 MB or smaller.";
}
const changedTextError =
  "The page text changed while choosing an image. Close this dialog, place your cursor, and try again.";
function initialFields(initial: WebsiteContentImage | null, selectedText: string) {
  return {
    alt: initial?.alt ?? selectedText.replace(/[\r\n]+/g, " ").slice(0, 500),
    caption: initial?.caption ?? "",
  };
}
async function imageReference(file: File | null, initial: WebsiteContentImage | null) {
  if (file) return { id: (await uploadPrivateOrganizationFile(file)).id, uploaded: true };
  if (initial) return { id: initial.fileId, uploaded: false };
  throw new Error("Choose an image first.");
}
function applyLabel(busy: boolean, initial: WebsiteContentImage | null) {
  if (busy) return "Uploading…";
  return initial ? "Apply image" : "Insert image";
}
export function MarkdownImageEditor({
  initial,
  selectedText,
  anchorRef,
  onApply,
  onRemove,
  onClose,
  onReturnFocus,
}: {
  readonly initial: WebsiteContentImage | null;
  readonly selectedText: string;
  readonly anchorRef: RefObject<HTMLButtonElement | null>;
  readonly onApply: (image: WebsiteContentImage) => boolean;
  readonly onRemove: () => boolean;
  readonly onClose: () => void;
  readonly onReturnFocus: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const defaults = initialFields(initial, selectedText);
  const [alt, setAlt] = useState(defaults.alt);
  const [caption, setCaption] = useState(defaults.caption);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
    [blobUrl],
  );
  const preview = blobUrl ?? (initial ? `/api/organization/files/${initial.fileId}` : null);
  async function apply() {
    if (!alt.trim() || (!file && !initial)) {
      setError("Choose an image and enter a short description for people who cannot see it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const reference = await imageReference(file, initial);
      const accepted =
        active.current &&
        onApply({ fileId: reference.id, alt: alt.trim(), caption: caption.trim() });
      if (!accepted && reference.uploaded) await deletePrivateOrganizationFile(reference.id);
      if (active.current && !accepted) setError(changedTextError);
    } catch (failure: unknown) {
      if (active.current)
        setError(
          failure instanceof AuthApiError
            ? failure.message
            : "The image could not be inserted. Please try again.",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <Dialog
      open
      anchorRef={anchorRef}
      title={initial ? "Edit image" : "Insert image"}
      description="Images stay private until you save and publish the page."
      dirty={file !== null || alt !== defaults.alt || caption !== defaults.caption}
      onClose={onClose}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onReturnFocus();
      }}
      footer={
        <>
          <DialogClose asChild>
            <button type="button" className="button button--secondary">
              Cancel
            </button>
          </DialogClose>
          {initial ? (
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={() => {
                if (!onRemove()) setError(changedTextError);
              }}
            >
              Remove image
            </button>
          ) : null}
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => {
              void apply();
            }}
          >
            {applyLabel(busy, initial)}
          </button>
        </>
      }
    >
      <div className="form-stack">
        {error ? (
          <p role="alert" className="notice notice--error">
            {error}
          </p>
        ) : null}
        {preview ? (
          <img
            className="website-image-picker__preview"
            alt="Selected image preview"
            src={preview}
          />
        ) : null}
        <label className="field">
          Choose image
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              const validation = next ? imageFileError(next) : null;
              setError(validation);
              setFile(validation ? null : next);
              setBlobUrl((previous) => {
                if (previous) URL.revokeObjectURL(previous);
                return next && !validation ? URL.createObjectURL(next) : null;
              });
            }}
          />
        </label>
        <p className="field-help">JPEG, PNG, or WebP; maximum 5 MB.</p>
        <label className="field">
          Alt text
          <input
            value={alt}
            maxLength={500}
            disabled={busy}
            onChange={(event) => {
              setAlt(event.target.value);
            }}
          />
        </label>
        <p className="field-help">Describe the image for people who cannot see it.</p>
        <label className="field">
          Caption (optional)
          <input
            value={caption}
            maxLength={1_000}
            disabled={busy}
            onChange={(event) => {
              setCaption(event.target.value);
            }}
          />
        </label>
      </div>
    </Dialog>
  );
}
