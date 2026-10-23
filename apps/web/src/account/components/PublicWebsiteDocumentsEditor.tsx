import type { PublicWebsiteDocument } from "@choir/contracts";
import { DataTable, Dialog, DialogClose, useConfirmation } from "@choir/ui";
import { useEffect, useState } from "react";

import {
  AuthApiError,
  createOrganizationPublicDocument,
  deleteOrganizationPublicDocument,
  deletePrivateOrganizationFile,
  listOrganizationPublicDocuments,
  updateOrganizationPublicDocument,
  uploadPrivateOrganizationFile,
} from "../../api";

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024; // 5 MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
  return error instanceof AuthApiError
    ? error.message
    : "The public document could not be saved. Please try again.";
}

function validateDocumentFile(file: File | null, isEditing: boolean): string | null {
  if (!file) {
    return isEditing ? null : "Choose a PDF or Word (.docx) file to upload.";
  }

  const name = file.name.toLowerCase();
  const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";
  const isDocx =
    name.endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  if (!isPdf && !isDocx) {
    return "Only PDF (.pdf) and Word (.docx) files are supported.";
  }

  if (file.size > MAX_DOCUMENT_BYTES) {
    return "Hosted documents must be 5 MB or smaller.";
  }

  return null;
}

export function PublicWebsiteDocumentsEditor() {
  const [documents, setDocuments] = useState<readonly PublicWebsiteDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDocument, setEditingDocument] = useState<PublicWebsiteDocument | null>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { confirm, confirmationDialog } = useConfirmation();

  useEffect(() => {
    let active = true;
    void listOrganizationPublicDocuments()
      .then((docs) => {
        if (!active) return;
        setDocuments(docs);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function openAdd(): void {
    setEditingDocument(null);
    setTitle("");
    setFile(null);
    setDialogError(null);
    setDialogOpen(true);
  }

  function openEdit(doc: PublicWebsiteDocument): void {
    setEditingDocument(doc);
    setTitle(doc.title);
    setFile(null);
    setDialogError(null);
    setDialogOpen(true);
  }

  function closeDialog(): void {
    setDialogOpen(false);
    setEditingDocument(null);
    setTitle("");
    setFile(null);
    setDialogError(null);
  }

  async function handleCopyLink(doc: PublicWebsiteDocument): Promise<void> {
    try {
      const fullUrl = `${window.location.origin}${doc.downloadPath}`;
      await navigator.clipboard.writeText(fullUrl);
      setCopiedId(doc.id);
      setSuccess(`Copied public link for ${doc.title}.`);
      window.setTimeout(() => {
        setCopiedId((current) => (current === doc.id ? null : current));
      }, 2000);
    } catch {
      setError("Failed to copy link to clipboard.");
    }
  }

  async function saveDocument(): Promise<void> {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setDialogError("Document title is required.");
      return;
    }

    const fileError = validateDocumentFile(file, Boolean(editingDocument));
    if (fileError) {
      setDialogError(fileError);
      return;
    }

    setBusy(true);
    setDialogError(null);
    setError(null);
    setSuccess(null);

    let uploadedFileId: string | null = null;
    try {
      if (file) {
        const uploaded = await uploadPrivateOrganizationFile(file);
        uploadedFileId = uploaded.id;
      }

      if (editingDocument) {
        const fileIdToUse = uploadedFileId ?? editingDocument.fileId;
        const updated = await updateOrganizationPublicDocument(editingDocument.id, {
          fileId: fileIdToUse,
          title: trimmedTitle,
        });
        setDocuments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        setSuccess(
          uploadedFileId
            ? "Document updated with replacement file. Stable link preserved."
            : "Document title updated.",
        );
      } else {
        if (!uploadedFileId) {
          throw new Error("A file must be uploaded.");
        }
        const created = await createOrganizationPublicDocument({
          fileId: uploadedFileId,
          title: trimmedTitle,
        });
        setDocuments((current) => [...current, created]);
        setSuccess("Public document uploaded and published.");
      }
      closeDialog();
    } catch (failure: unknown) {
      if (uploadedFileId) {
        void deletePrivateOrganizationFile(uploadedFileId).catch(() => undefined);
      }
      setDialogError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(doc: PublicWebsiteDocument): Promise<void> {
    const confirmed = await confirm({
      confirmLabel: "Delete document",
      description: `Are you sure you want to delete "${doc.title}"? Any links pointing to this file on your public website or donation page will stop working.`,
      destructive: true,
      title: "Delete hosted document?",
    });

    if (!confirmed) return;

    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteOrganizationPublicDocument(doc.id);
      setDocuments((current) => current.filter(({ id }) => id !== doc.id));
      setSuccess(`Document "${doc.title}" deleted.`);
    } catch (failure: unknown) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface-card organization-settings-panel">
      <header className="public-website-documents-header">
        <h2>Hosted documents</h2>
        <p className="field-help">
          Upload printable forms, packets, or policies (PDF or Word .docx, up to 5 MB each).
          Documents are immediately live upon upload and can be linked anywhere on your public
          website or donation page without republishing the website draft.
        </p>
      </header>

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

      {loading ? (
        <p role="status">Loading documents…</p>
      ) : documents.length === 0 ? (
        <div className="empty-state">
          <p>No public documents uploaded yet.</p>
          <button className="button button--primary" onClick={openAdd} type="button">
            Upload document
          </button>
        </div>
      ) : (
        <div className="table-wrapper">
          <DataTable<PublicWebsiteDocument>
            columns={[
              {
                header: "Document",
                id: "title",
                render: (doc: PublicWebsiteDocument) => (
                  <div className="public-document-row__info">
                    <strong>{doc.title}</strong>
                    <div className="public-document-row__meta field-help">
                      <span>{doc.fileName}</span>
                      <span>•</span>
                      <span>{formatFileSize(doc.sizeBytes)}</span>
                      <span>•</span>
                      <span className="badge badge--subtle">
                        {doc.contentType === "application/pdf" ? "PDF" : "DOCX"}
                      </span>
                    </div>
                  </div>
                ),
              },
              {
                header: "Public link",
                id: "downloadPath",
                render: (doc: PublicWebsiteDocument) => (
                  <code className="public-document-row__path" title={doc.downloadPath}>
                    {doc.downloadPath}
                  </code>
                ),
              },
              {
                header: "Actions",
                id: "actions",
                render: (doc: PublicWebsiteDocument) => (
                  <div className="public-document-row__actions actions-group">
                    <button
                      aria-label={`Copy link for ${doc.title}`}
                      className="button button--secondary button--small"
                      onClick={() => void handleCopyLink(doc)}
                      type="button"
                    >
                      {copiedId === doc.id ? "Copied!" : "Copy link"}
                    </button>
                    <a
                      aria-label={`Preview ${doc.title}`}
                      className="button button--secondary button--small"
                      href={doc.downloadPath}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Preview
                    </a>
                    <button
                      aria-label={`Edit ${doc.title}`}
                      className="button button--secondary button--small"
                      disabled={busy}
                      onClick={() => {
                        openEdit(doc);
                      }}
                      type="button"
                    >
                      Edit / Replace
                    </button>
                    <button
                      aria-label={`Delete ${doc.title}`}
                      className="button button--danger button--small"
                      disabled={busy}
                      onClick={() => void handleDelete(doc)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                ),
              },
            ]}
            emptyMessage="No public documents uploaded yet."
            keySelector={(doc: PublicWebsiteDocument) => doc.id}
            rows={documents}
          />

          <div className="public-website-documents-actions" style={{ marginTop: "1rem" }}>
            <button
              className="button button--primary"
              disabled={busy || documents.length >= 50}
              onClick={openAdd}
              type="button"
            >
              Upload document
            </button>
          </div>
        </div>
      )}

      <PublicWebsiteDocumentDialog
        busy={busy}
        closeDialog={closeDialog}
        dialogError={dialogError}
        dialogOpen={dialogOpen}
        editingDocument={editingDocument}
        onSave={() => void saveDocument()}
        setFile={setFile}
        setTitle={setTitle}
        title={title}
      />

      {confirmationDialog}
    </div>
  );
}

function PublicWebsiteDocumentDialog({
  busy,
  closeDialog,
  dialogError,
  dialogOpen,
  editingDocument,
  onSave,
  setFile,
  setTitle,
  title,
}: {
  readonly busy: boolean;
  readonly closeDialog: () => void;
  readonly dialogError: string | null;
  readonly dialogOpen: boolean;
  readonly editingDocument: PublicWebsiteDocument | null;
  readonly onSave: () => void;
  readonly setFile: (file: File | null) => void;
  readonly setTitle: (title: string) => void;
  readonly title: string;
}) {
  return (
    <Dialog
      description="Upload a PDF or Word (.docx) document to make it publicly viewable or downloadable on your website."
      onClose={closeDialog}
      open={dialogOpen}
      title={editingDocument ? "Edit hosted document" : "Upload hosted document"}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        {dialogError ? (
          <p className="notice notice--error" role="alert">
            {dialogError}
          </p>
        ) : null}

        <label className="field" htmlFor="public-document-title">
          Document title
          <input
            autoFocus
            id="public-document-title"
            maxLength={300}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            placeholder="e.g., Mail-In Donation Form"
            required
            value={title}
          />
        </label>

        <label className="field" htmlFor="public-document-file">
          {editingDocument ? "Replace file (optional)" : "File (PDF or DOCX, max 5 MB)"}
          <input
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            id="public-document-file"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
            }}
            required={!editingDocument}
            type="file"
          />
        </label>

        {editingDocument ? (
          <p className="field-help">
            Current file: <strong>{editingDocument.fileName}</strong> (
            {formatFileSize(editingDocument.sizeBytes)}). Uploading a replacement file keeps the
            same public URL so existing links don&apos;t break.
          </p>
        ) : (
          <p className="field-help">
            PDFs will open inline in visitors&apos; browsers by default; Word documents will
            download as attachments.
          </p>
        )}

        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Cancel
            </button>
          </DialogClose>
          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Saving…" : editingDocument ? "Save changes" : "Upload document"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
