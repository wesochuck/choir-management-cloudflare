import { Dialog } from "@choir/ui";

interface CsvImportDialogProps {
  readonly busy: boolean;
  readonly description: string;
  readonly error?: string | null;
  readonly file: File | null;
  readonly helpText?: string;
  readonly onClose: () => void;
  readonly onFileChange: (file: File | null) => void;
  readonly onImport: () => void;
  readonly open: boolean;
  readonly title: string;
}

export function CsvImportDialog({
  busy,
  description,
  error,
  file,
  helpText,
  onClose,
  onFileChange,
  onImport,
  open,
  title,
}: CsvImportDialogProps) {
  return (
    <Dialog description={description} onClose={onClose} open={open} title={title}>
      <div className="form-stack">
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="field">
          Choose CSV file
          <input
            accept=".csv,text/csv"
            aria-label={title}
            onChange={(event) => {
              onFileChange(event.target.files?.item(0) ?? null);
            }}
            type="file"
          />
        </label>
        {helpText ? <p className="field-help">{helpText}</p> : null}
        <div className="dialog__actions">
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={busy || !file}
            onClick={onImport}
            type="button"
          >
            {busy ? "Importing…" : "Import CSV"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
