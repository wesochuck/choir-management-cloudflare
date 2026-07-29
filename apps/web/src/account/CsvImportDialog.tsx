import { Dialog } from "@choir/ui";

interface CsvImportDialogProps {
  readonly busy: boolean;
  readonly columnWarnings?: readonly CsvImportColumnWarning[];
  readonly confirmed?: boolean;
  readonly description: string;
  readonly excludedColumns?: readonly string[];
  readonly error?: string | null;
  readonly file: File | null;
  readonly helpText?: string;
  readonly invalid?: boolean;
  readonly onClose: () => void;
  readonly onConfirmationChange?: (confirmed: boolean) => void;
  readonly onFileChange: (file: File | null) => void;
  readonly onImport: () => void;
  readonly onToggleColumn?: (header: string) => void;
  readonly open: boolean;
  readonly requiredExcludedColumns?: readonly string[];
  readonly title: string;
}

export interface CsvImportColumnWarning {
  readonly header: string;
  readonly message: string;
  readonly rows?: readonly number[];
}

// eslint-disable-next-line complexity -- the shared dialog owns optional preview and confirmation states.
export function CsvImportDialog({
  busy,
  columnWarnings = [],
  confirmed = false,
  description,
  excludedColumns = [],
  error,
  file,
  helpText,
  invalid = false,
  onClose,
  onConfirmationChange,
  onFileChange,
  onImport,
  onToggleColumn,
  open,
  requiredExcludedColumns = [],
  title,
}: CsvImportDialogProps) {
  const hasBlockingWarnings = requiredExcludedColumns.some(
    (header) => !excludedColumns.includes(header),
  );
  const importDisabled =
    busy || !file || invalid || (columnWarnings.length > 0 && (!confirmed || hasBlockingWarnings));
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
        {columnWarnings.length > 0 ? (
          <div className="notice notice--warning csv-import-warnings" role="status">
            <strong>Review these columns before importing</strong>
            <p>
              Some columns or values do not match the preferred format. Exclude a column if you do
              not want to import it. Unrecognized columns are ignored automatically.
            </p>
            <ul>
              {columnWarnings.map((warning) => {
                const excluded = excludedColumns.includes(warning.header);
                const rows = warning.rows?.length
                  ? ` (row${warning.rows.length === 1 ? "" : "s"} ${warning.rows.join(", ")})`
                  : "";
                return (
                  <li key={`${warning.header}-${warning.message}`}>
                    <label className="checkbox-row">
                      <input
                        checked={excluded}
                        disabled={busy || !onToggleColumn}
                        type="checkbox"
                        onChange={() => {
                          onToggleColumn?.(warning.header);
                        }}
                      />
                      <span>
                        <strong>{warning.header}</strong>: {warning.message}
                        {rows}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <label className="checkbox-row">
              <input
                checked={confirmed}
                disabled={busy || hasBlockingWarnings}
                type="checkbox"
                onChange={(event) => {
                  onConfirmationChange?.(event.target.checked);
                }}
              />
              I reviewed these warnings and want to proceed.
            </label>
            {hasBlockingWarnings ? (
              <small>Exclude the columns with invalid values before proceeding.</small>
            ) : null}
          </div>
        ) : null}
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
            disabled={importDisabled}
            onClick={onImport}
            type="button"
          >
            {busy ? "Importing…" : columnWarnings.length > 0 ? "Proceed with import" : "Import CSV"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
