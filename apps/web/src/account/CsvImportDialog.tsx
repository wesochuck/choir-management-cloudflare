import { Dialog, DialogClose } from "@choir/ui";
import { useState, type DragEvent } from "react";

interface CsvImportDialogProps {
  readonly busy: boolean;
  readonly columnWarnings?: readonly CsvImportColumnWarning[];
  readonly columnMappings?: readonly CsvImportColumnMapping[];
  readonly confirmed?: boolean;
  readonly description: string;
  readonly excludedColumns?: readonly string[];
  readonly error?: string | null;
  readonly file: File | null;
  readonly helpText?: string;
  readonly invalid?: boolean;
  readonly mappingOptions?: readonly CsvImportMappingOption[];
  readonly onClose: () => void;
  readonly onConfirmationChange?: (confirmed: boolean) => void;
  readonly onFileChange: (file: File | null) => void;
  readonly onImport: () => void;
  readonly onMapColumn?: (sourceIndex: number, targetHeader: string | null) => void;
  readonly onToggleColumn?: (header: string) => void;
  readonly open: boolean;
  readonly requiredExcludedColumns?: readonly string[];
  readonly title: string;
}

interface CsvImportColumnWarning {
  readonly header: string;
  readonly message: string;
  readonly rows?: readonly number[];
  readonly sourceIndex?: number;
}

export interface CsvImportColumnMapping {
  readonly header: string;
  readonly sourceIndex: number;
  readonly targetHeader: string | null;
}

export interface CsvImportMappingOption {
  readonly label: string;
  readonly required?: boolean;
  readonly value: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// eslint-disable-next-line complexity -- the shared dialog owns optional preview and confirmation states.
export function CsvImportDialog({
  busy,
  columnWarnings = [],
  columnMappings = [],
  confirmed = false,
  description,
  excludedColumns = [],
  error,
  file,
  helpText,
  invalid = false,
  mappingOptions = [],
  onClose,
  onConfirmationChange,
  onFileChange,
  onImport,
  onMapColumn,
  onToggleColumn,
  open,
  requiredExcludedColumns = [],
  title,
}: CsvImportDialogProps) {
  const [dragging, setDragging] = useState(false);
  const hasIgnoredColumns = columnMappings.some(({ targetHeader }) => targetHeader === null);
  const ignoredHeaders = columnMappings
    .filter(({ targetHeader }) => targetHeader === null)
    .map(({ header, sourceIndex }) => header || `Column ${String(sourceIndex + 1)}`);
  const hasMappingControls = columnMappings.length > 0 && Boolean(onMapColumn);
  function toggleWarningColumn(header: string): void {
    if (onToggleColumn) onToggleColumn(header);
  }
  const hasBlockingWarnings = requiredExcludedColumns.some(
    (header) => !excludedColumns.includes(header),
  );
  const importDisabled =
    busy ||
    !file ||
    invalid ||
    ((columnWarnings.length > 0 || hasIgnoredColumns) && (!confirmed || hasBlockingWarnings));
  return (
    <Dialog description={description} onClose={onClose} open={open} title={title}>
      <div className="form-stack">
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        {file ? (
          <div className="csv-import-file-card" role="status">
            <div className="csv-import-file-card__info">
              <span aria-hidden="true" className="csv-import-file-card__icon">
                📄
              </span>
              <div className="csv-import-file-card__details">
                <strong className="csv-import-file-card__name">{file.name}</strong>
                <span className="csv-import-file-card__size">{formatFileSize(file.size)}</span>
              </div>
            </div>
            <button
              className="button button--secondary button--small"
              disabled={busy}
              onClick={() => {
                onFileChange(null);
              }}
              type="button"
            >
              Change file
            </button>
          </div>
        ) : (
          <label
            className={`csv-import-dropzone${dragging ? " is-dragging" : ""}`}
            onDragEnter={(event) => {
              if (busy) return;
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => {
              if (busy) return;
              setDragging(false);
            }}
            onDragOver={(event) => {
              if (busy) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDragging(true);
            }}
            onDrop={(event: DragEvent<HTMLLabelElement>) => {
              event.preventDefault();
              setDragging(false);
              if (busy) return;
              const dropped = event.dataTransfer.files.item(0);
              if (dropped) {
                onFileChange(dropped);
              }
            }}
          >
            <div className="csv-import-dropzone__content">
              <span className="button button--secondary button--control-height">Choose file</span>
              <span className="csv-import-dropzone__hint">or drag and drop .csv here</span>
            </div>
            <input
              accept=".csv,text/csv"
              aria-label="Choose CSV file"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                onFileChange(event.target.files?.item(0) ?? null);
                event.target.value = "";
              }}
              type="file"
            />
          </label>
        )}
        {helpText ? <p className="field-help">{helpText}</p> : null}
        {hasMappingControls ? (
          <fieldset className="csv-import-mappings">
            <legend>Map columns</legend>
            <p>
              Choose the destination for each CSV column. Use <strong>Ignore</strong> for data you
              do not want to import.
            </p>
            <div className="csv-import-mappings__list">
              {columnMappings.map((mapping) => {
                const warning =
                  columnWarnings.find(
                    (candidate) => candidate.sourceIndex === mapping.sourceIndex,
                  ) ?? columnWarnings.find((candidate) => candidate.header === mapping.header);
                const warningIndex = warning ? columnWarnings.indexOf(warning) : -1;
                const warningId =
                  warningIndex >= 0 ? `csv-warning-${String(warningIndex)}` : undefined;
                return (
                  <label className="csv-import-mapping" key={mapping.sourceIndex}>
                    <span>{mapping.header || `Column ${String(mapping.sourceIndex + 1)}`}</span>
                    <select
                      aria-describedby={warningId}
                      aria-label={`Map ${mapping.header || `column ${String(mapping.sourceIndex + 1)}`}`}
                      disabled={busy}
                      value={mapping.targetHeader ?? ""}
                      onChange={(event) => {
                        onMapColumn?.(mapping.sourceIndex, event.target.value || null);
                      }}
                    >
                      <option value="">Ignore</option>
                      {mappingOptions.map((option) => (
                        <option
                          disabled={columnMappings.some(
                            (candidate) =>
                              candidate.sourceIndex !== mapping.sourceIndex &&
                              candidate.targetHeader === option.value,
                          )}
                          key={option.value}
                          value={option.value}
                        >
                          {option.label}
                          {option.required ? " (required)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        {columnWarnings.length > 0 || hasIgnoredColumns ? (
          <div className="notice notice--warning csv-import-warnings" role="status">
            <strong>Review these columns before importing</strong>
            <p>
              Some columns or values do not match the preferred format. Map a column to a supported
              field or choose Ignore if you do not want to import it.
            </p>
            {columnWarnings.length > 0 ? (
              <ul>
                {columnWarnings.map((warning, warningIndex) => {
                  const excluded = excludedColumns.includes(warning.header);
                  const rows = warning.rows?.length
                    ? ` (row${warning.rows.length === 1 ? "" : "s"} ${warning.rows.join(", ")})`
                    : "";
                  return (
                    <li
                      id={`csv-warning-${String(warningIndex)}`}
                      key={`${warning.header}-${warning.message}`}
                    >
                      {onToggleColumn ? (
                        <label className="checkbox-row">
                          <input
                            checked={excluded}
                            disabled={busy}
                            type="checkbox"
                            onChange={() => {
                              toggleWarningColumn(warning.header);
                            }}
                          />
                          <span>
                            <strong>{warning.header}</strong>: {warning.message}
                            {rows}
                          </span>
                        </label>
                      ) : (
                        <span>
                          <strong>{warning.header}</strong>: {warning.message}
                          {rows}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {hasIgnoredColumns ? (
              <p>
                Columns marked <strong>Ignore</strong> will be left out of the import:{" "}
                {ignoredHeaders.join(", ")}
              </p>
            ) : null}
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
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
          <button
            className="button button--primary"
            disabled={importDisabled}
            onClick={onImport}
            type="button"
          >
            {busy || columnWarnings.length > 0 || hasIgnoredColumns
              ? busy
                ? "Importing…"
                : "Proceed with import"
              : "Import"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
