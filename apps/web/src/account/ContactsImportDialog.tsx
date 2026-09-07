import type {
  ContactImportJobStatusResponse,
  ContactImportPreviewResponse,
  ContactImportTarget,
  ContactImportUploadResponse,
  ContactList,
} from "@choir/contracts";
import { CONTACT_IMPORT_TARGETS, suggestContactImportMapping } from "@choir/domain";
import { DataTable, Dialog, DialogClose } from "@choir/ui";
import { useEffect, useState } from "react";

import {
  cancelContactImport,
  confirmContactImport,
  contactImportErrorMessage,
  downloadContactImportErrorFile,
  downloadContactImportErrors,
  getContactImportStatus,
  previewContactImport,
  saveContactImportMapping,
  uploadContactImportCsv,
} from "../api/contactImports";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const TARGET_LABELS: Record<ContactImportTarget, string> = {
  consentSource: "Consent/Status Source",
  displayName: "Display Name",
  email: "Email",
  emailStatus: "Email Marketing Status",
  firstName: "First Name",
  ignore: "Ignore",
  lastName: "Last Name",
  phone: "Phone",
  smsStatus: "SMS Marketing Status",
  source: "Source",
};

type ImportStep = "upload" | "map" | "preview" | "processing" | "result";

const STEP_LABELS: Record<ImportStep, string> = {
  map: "Map columns",
  preview: "Preview",
  processing: "Processing",
  result: "Result",
  upload: "Upload",
};

const STEP_ORDER: readonly ImportStep[] = ["upload", "map", "preview", "processing", "result"];

function countLabel(value: number, singular: string, plural: string): string {
  return `${String(value)} ${value === 1 ? singular : plural}`;
}

export function ContactImportWizardSteps({ step }: { readonly step: ImportStep }) {
  return (
    <ol aria-label="Import progress" className="contacts-import-steps">
      {STEP_ORDER.map((candidate) => (
        <li
          aria-current={candidate === step ? "step" : undefined}
          className={candidate === step ? "contacts-import-steps__current" : undefined}
          key={candidate}
        >
          {STEP_LABELS[candidate]}
        </li>
      ))}
    </ol>
  );
}

/** Pure upload fields (no Dialog wrapper) so labels stay covered by SSR tests. */
export function ContactImportUploadFields({
  busy,
  onFile,
}: {
  readonly busy: boolean;
  readonly onFile: (file: File | undefined) => void;
}) {
  return (
    <div className="field">
      <label htmlFor="contact-import-file">Choose a CSV file</label>
      <input
        accept=".csv,text/csv"
        disabled={busy}
        id="contact-import-file"
        onChange={(event) => {
          onFile(event.target.files?.[0]);
        }}
        type="file"
      />
      <p className="field-help">
        At most 5 MB and 10,000 rows. Importing never implies consent: rows without a status are
        added as unknown.
      </p>
    </div>
  );
}

/** Pure mapping fields (no Dialog wrapper) so labels stay covered by SSR tests. */
export function ContactImportMappingFields({
  busy,
  invalidRowCount,
  listIds,
  lists,
  onBack,
  onContinue,
  onListIdsChange,
  onTargetsChange,
  probableDuplicateCount,
  sampleRow,
  sampleRows,
  targets,
  upload,
}: {
  readonly busy: boolean;
  readonly invalidRowCount: number;
  readonly listIds: readonly string[];
  readonly lists: readonly ContactList[];
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly onListIdsChange: (listIds: readonly string[]) => void;
  readonly onTargetsChange: (targets: readonly ContactImportTarget[]) => void;
  readonly probableDuplicateCount: number;
  readonly sampleRow: readonly string[];
  readonly sampleRows: readonly (readonly string[])[];
  readonly targets: readonly ContactImportTarget[];
  readonly upload: ContactImportUploadResponse;
}) {
  const sampleTableRows = sampleRows.map((cells, index) => ({ cells, index }));
  return (
    <div className="form-stack">
      {invalidRowCount > 0 ? (
        <p className="notice notice--warning" role="status">
          {countLabel(invalidRowCount, "row was", "rows were")} rejected during upload and will be
          skipped.
        </p>
      ) : null}
      {probableDuplicateCount > 0 ? (
        <p className="notice notice--warning" role="status">
          {countLabel(probableDuplicateCount, "probable duplicate was", "probable duplicates were")}{" "}
          detected within this file. Later duplicates are skipped.
        </p>
      ) : null}
      <section aria-labelledby="contact-import-sample-heading">
        <h3 id="contact-import-sample-heading">Sample rows</h3>
        <DataTable
          columns={upload.headers.map((header, columnIndex) => ({
            header,
            id: `sample-column-${String(columnIndex)}`,
            render: (row: { readonly cells: readonly string[]; readonly index: number }) =>
              row.cells[columnIndex] === "" || row.cells[columnIndex] === undefined
                ? "No value"
                : (row.cells[columnIndex] ?? "No value"),
            sortValue: (row: { readonly cells: readonly string[]; readonly index: number }) =>
              row.cells[columnIndex] ?? "",
          }))}
          emptyMessage="No sample rows"
          initialSort={{ columnId: "sample-column-0", direction: "asc" }}
          keySelector={(row) => `sample-row-${String(row.index)}`}
          rows={sampleTableRows}
        />
      </section>
      <fieldset className="field">
        <legend>Map columns to contact fields</legend>
        {upload.headers.map((header, index) => (
          <div className="field" key={`${header}-${String(index)}`}>
            <label htmlFor={`contact-import-mapping-${String(index)}`}>
              Column “{header}”{sampleRow[index] ? ` (for example: ${sampleRow[index] ?? ""})` : ""}
            </label>
            <select
              disabled={busy}
              id={`contact-import-mapping-${String(index)}`}
              onChange={(event) => {
                const next = [...targets];
                next[index] =
                  CONTACT_IMPORT_TARGETS.find((candidate) => candidate === event.target.value) ??
                  "ignore";
                onTargetsChange(next);
              }}
              value={targets[index] ?? "ignore"}
            >
              {CONTACT_IMPORT_TARGETS.map((target) => (
                <option key={target} value={target}>
                  {TARGET_LABELS[target]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </fieldset>
      <fieldset className="field">
        <legend>Add imported contacts to lists</legend>
        {lists.length === 0 ? (
          <p className="field-help">
            No contact lists exist yet. Create one from Contact lists before importing.
          </p>
        ) : (
          <div className="contacts-checkbox-group">
            {lists.map((list) => {
              const checkboxId = `contact-import-list-${list.id}`;
              return (
                <label className="checkbox-row" htmlFor={checkboxId} key={list.id}>
                  <input
                    checked={listIds.includes(list.id)}
                    disabled={busy}
                    id={checkboxId}
                    onChange={(event) => {
                      onListIdsChange(
                        event.target.checked
                          ? [...listIds, list.id]
                          : listIds.filter((candidate) => candidate !== list.id),
                      );
                    }}
                    type="checkbox"
                  />
                  {list.name}
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
      <div className="dialog__actions">
        <button className="button button--secondary" disabled={busy} onClick={onBack} type="button">
          Back
        </button>
        <button
          className="button button--primary"
          disabled={busy || lists.length === 0}
          onClick={onContinue}
          type="button"
        >
          {busy ? "Checking…" : "Preview import"}
        </button>
      </div>
    </div>
  );
}

/** Pure preview fields (no Dialog wrapper) so counts stay covered by SSR tests. */
export function ContactImportPreviewFields({
  busy,
  onBack,
  onConfirm,
  preview,
}: {
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly onConfirm: () => void;
  readonly preview: ContactImportPreviewResponse;
}) {
  return (
    <div className="form-stack">
      <dl className="contacts-import-summary">
        <div>
          <dt>Rows read</dt>
          <dd>{preview.rowsRead}</dd>
        </div>
        <div>
          <dt>New contacts</dt>
          <dd>{preview.newContacts}</dd>
        </div>
        <div>
          <dt>Existing contacts to update</dt>
          <dd>{preview.existingMatches}</dd>
        </div>
        <div>
          <dt>Duplicates within file</dt>
          <dd>{preview.inFileDuplicates}</dd>
        </div>
        <div>
          <dt>Invalid rows</dt>
          <dd>{preview.invalidRows}</dd>
        </div>
        <div>
          <dt>Unsubscribes preserved</dt>
          <dd>{preview.suppressedPreserved}</dd>
        </div>
      </dl>
      {preview.suppressedPreserved > 0 ? (
        <p className="notice notice--warning" role="status">
          Existing unsubscribes stay unsubscribed even where the CSV says subscribed.
        </p>
      ) : null}
      <p className="field-help">
        Confirming starts the import as background work. Existing list memberships are kept, blank
        values never erase stored details, and the same import can never run twice.
      </p>
      <div className="dialog__actions">
        <button className="button button--secondary" disabled={busy} onClick={onBack} type="button">
          Back
        </button>
        <button
          aria-busy={busy}
          className="button button--primary"
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          {busy ? "Confirming…" : "Confirm import"}
        </button>
      </div>
    </div>
  );
}

/** Pure result fields (no Dialog wrapper) so counts stay covered by SSR tests. */
export function ContactImportResultFields({
  busy,
  onDone,
  onDownloadErrors,
  status,
}: {
  readonly busy: boolean;
  readonly onDone: () => void;
  readonly onDownloadErrors: () => void;
  readonly status: ContactImportJobStatusResponse;
}) {
  return (
    <div className="form-stack">
      <p role="status">
        Import {status.status}: {countLabel(status.contactsCreated, "contact", "contacts")} created,{" "}
        {countLabel(status.contactsUpdated, "contact", "contacts")} updated,{" "}
        {countLabel(status.membershipsAdded, "list membership", "list memberships")} added.
      </p>
      <dl className="contacts-import-summary">
        <div>
          <dt>Rows read</dt>
          <dd>{status.rowsRead}</dd>
        </div>
        <div>
          <dt>Duplicates within file</dt>
          <dd>{status.inFileDuplicates}</dd>
        </div>
        <div>
          <dt>Already existing</dt>
          <dd>{status.existingMatches}</dd>
        </div>
        <div>
          <dt>Invalid rows</dt>
          <dd>{status.invalidRows}</dd>
        </div>
        <div>
          <dt>Unsubscribes preserved</dt>
          <dd>{status.suppressedPreserved}</dd>
        </div>
      </dl>
      {status.hasErrorCsv ? (
        <button
          className="button button--secondary"
          disabled={busy}
          onClick={onDownloadErrors}
          type="button"
        >
          {busy ? "Preparing…" : "Download error CSV"}
        </button>
      ) : null}
      <div className="dialog__actions">
        <button className="button button--primary" onClick={onDone} type="button">
          Done
        </button>
      </div>
    </div>
  );
}

export function ContactImportDialog({
  lists,
  onClose,
  onImported,
  open,
}: {
  readonly lists: readonly ContactList[];
  readonly onClose: () => void;
  readonly onImported: () => void;
  readonly open: boolean;
}) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<ContactImportUploadResponse | null>(null);
  const [targets, setTargets] = useState<readonly ContactImportTarget[]>([]);
  const [listIds, setListIds] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<ContactImportPreviewResponse | null>(null);
  const [status, setStatus] = useState<ContactImportJobStatusResponse | null>(null);

  const importId = upload?.importId ?? null;
  const staged = importId !== null && (step === "map" || step === "preview");

  useEffect(() => {
    if (step !== "processing" || importId === null) return;
    let cancelled = false;
    let timer: number | undefined;
    async function poll(): Promise<void> {
      try {
        const current = await getContactImportStatus(importId ?? "");
        if (cancelled) return;
        setStatus(current);
        if (
          current.status === "completed" ||
          current.status === "failed" ||
          current.status === "cancelled"
        ) {
          setStep("result");
          onImported();
          return;
        }
        timer = window.setTimeout(() => {
          void poll();
        }, 2000);
      } catch (pollError: unknown) {
        if (cancelled) return;
        setError(contactImportErrorMessage(pollError, "The import status could not be loaded."));
        timer = window.setTimeout(() => {
          void poll();
        }, 5000);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [importId, onImported, step]);

  function reset(): void {
    setStep("upload");
    setError(null);
    setUpload(null);
    setTargets([]);
    setListIds([]);
    setPreview(null);
    setStatus(null);
  }

  function close(cancelStaged: boolean): void {
    if (busy) return;
    if (cancelStaged && importId !== null && staged) {
      // A staged draft holds no contacts; cancelling before confirm leaves
      // the address book untouched. Failures are swallowed: the draft simply
      // remains staged for the next import to replace.
      cancelContactImport(importId).catch(() => undefined);
    }
    reset();
    onClose();
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("Contact CSV files may not exceed 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const csv = await file.text();
      if (!csv.trim()) {
        setError("The CSV is empty.");
        return;
      }
      const uploaded = await uploadContactImportCsv(file.name || "contacts.csv", csv);
      setUpload(uploaded);
      setTargets(suggestContactImportMapping(uploaded.headers));
      setListIds([]);
      setPreview(null);
      setStatus(null);
      setStep("map");
    } catch (uploadError: unknown) {
      setError(contactImportErrorMessage(uploadError, "The contact CSV could not be uploaded."));
    } finally {
      setBusy(false);
    }
  }

  async function backToUpload(): Promise<void> {
    if (importId !== null) {
      setBusy(true);
      try {
        await cancelContactImport(importId);
      } catch (cancelError: unknown) {
        setError(contactImportErrorMessage(cancelError, "The staged import could not be cleared."));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setUpload(null);
    setTargets([]);
    setListIds([]);
    setPreview(null);
    setError(null);
    setStep("upload");
  }

  async function continueToPreview(): Promise<void> {
    if (importId === null) return;
    if (listIds.length === 0) {
      setError("Assign the import to at least one contact list.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveContactImportMapping(importId, { listIds, mapping: targets });
      const previewed = await previewContactImport(importId);
      setPreview(previewed);
      setStep("preview");
    } catch (mappingError: unknown) {
      setError(contactImportErrorMessage(mappingError, "The column mapping could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (importId === null) return;
    setBusy(true);
    setError(null);
    try {
      await confirmContactImport(importId);
      setStep("processing");
    } catch (confirmError: unknown) {
      setError(
        contactImportErrorMessage(confirmError, "The contact import could not be confirmed."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadErrors(): Promise<void> {
    if (importId === null) return;
    setBusy(true);
    setError(null);
    try {
      const exported = await downloadContactImportErrors(importId);
      downloadContactImportErrorFile(exported);
    } catch (downloadError: unknown) {
      setError(contactImportErrorMessage(downloadError, "The error CSV could not be downloaded."));
    } finally {
      setBusy(false);
    }
  }

  const finished = status !== null && step === "result";

  return (
    <Dialog
      description="Upload a CSV, map its columns, preview the outcome, then confirm. Only confirmation starts the import."
      dirty={upload !== null && !finished}
      onClose={() => {
        close(true);
      }}
      open={open}
      title="Import contacts from CSV"
    >
      <ContactImportDialogBody
        busy={busy}
        error={error}
        listIds={listIds}
        lists={lists}
        onBackToMap={() => {
          setStep("map");
        }}
        onBackToUpload={() => {
          void backToUpload();
        }}
        onConfirm={() => {
          void confirm();
        }}
        onContinueToPreview={() => {
          void continueToPreview();
        }}
        onDone={() => {
          reset();
          onClose();
        }}
        onDownloadErrors={() => {
          void downloadErrors();
        }}
        onFile={(file) => {
          void handleFile(file);
        }}
        onListIdsChange={setListIds}
        onTargetsChange={setTargets}
        preview={preview}
        status={status}
        step={step}
        targets={targets}
        upload={upload}
      />
    </Dialog>
  );
}
function ContactImportCancelActions({ busy }: { readonly busy: boolean }) {
  return (
    <div className="dialog__actions">
      <DialogClose asChild>
        <button className="button button--secondary" disabled={busy} type="button">
          Cancel
        </button>
      </DialogClose>
    </div>
  );
}

function ContactImportProcessingNotice({
  status,
}: {
  readonly status: ContactImportJobStatusResponse | null;
}) {
  return (
    <p role="status">
      {status
        ? `Processing import… ${String(status.processedRows)} of ${String(status.rowsRead)} rows checked.`
        : "Processing import…"}
    </p>
  );
}

function ContactImportDialogBody({
  busy,
  error,
  listIds,
  lists,
  onBackToMap,
  onBackToUpload,
  onConfirm,
  onContinueToPreview,
  onDone,
  onDownloadErrors,
  onFile,
  onListIdsChange,
  onTargetsChange,
  preview,
  status,
  step,
  targets,
  upload,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly listIds: readonly string[];
  readonly lists: readonly ContactList[];
  readonly onBackToMap: () => void;
  readonly onBackToUpload: () => void;
  readonly onConfirm: () => void;
  readonly onContinueToPreview: () => void;
  readonly onDone: () => void;
  readonly onDownloadErrors: () => void;
  readonly onFile: (file: File | undefined) => void;
  readonly onListIdsChange: (listIds: readonly string[]) => void;
  readonly onTargetsChange: (targets: readonly ContactImportTarget[]) => void;
  readonly preview: ContactImportPreviewResponse | null;
  readonly status: ContactImportJobStatusResponse | null;
  readonly step: ImportStep;
  readonly targets: readonly ContactImportTarget[];
  readonly upload: ContactImportUploadResponse | null;
}) {
  return (
    <>
      <ContactImportWizardSteps step={step} />
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      {step === "upload" ? <ContactImportUploadFields busy={busy} onFile={onFile} /> : null}

      {step === "map" && upload ? (
        <ContactImportMappingFields
          busy={busy}
          invalidRowCount={upload.invalidRowCount}
          listIds={listIds}
          lists={lists}
          onBack={onBackToUpload}
          onContinue={onContinueToPreview}
          onListIdsChange={onListIdsChange}
          onTargetsChange={onTargetsChange}
          probableDuplicateCount={upload.probableDuplicateCount}
          sampleRow={upload.sampleRows[0] ?? []}
          sampleRows={upload.sampleRows}
          targets={targets}
          upload={upload}
        />
      ) : null}

      {step === "preview" && preview ? (
        <ContactImportPreviewFields
          busy={busy}
          onBack={onBackToMap}
          onConfirm={onConfirm}
          preview={preview}
        />
      ) : null}

      {step === "processing" ? <ContactImportProcessingNotice status={status} /> : null}

      {step === "result" && status ? (
        <ContactImportResultFields
          busy={busy}
          onDone={onDone}
          onDownloadErrors={onDownloadErrors}
          status={status}
        />
      ) : null}

      {step === "upload" || step === "processing" || (step === "result" && !status) ? (
        <ContactImportCancelActions busy={busy} />
      ) : null}
    </>
  );
}
