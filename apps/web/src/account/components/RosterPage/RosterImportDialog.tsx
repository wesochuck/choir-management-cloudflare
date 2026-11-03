import { rosterCsvColumnOptions } from "@choir/domain";

import { CsvImportDialog } from "../../CsvImportDialog";
import type { RosterPageModel } from "./hooks";

export function RosterImportDialog({
  model,
  partLabel,
}: {
  readonly model: RosterPageModel;
  readonly partLabel: string;
}) {
  const {
    busy,
    closeImportDialog,
    error,
    handleRosterColumnMap,
    handleRosterImportFile,
    importDialogOpen,
    importFile,
    importRoster,
    rosterImportConfirmed,
    rosterImportHeaders,
    rosterImportInspecting,
    rosterImportInspection,
    rosterImportMappings,
    rosterImportSamples,
    setRosterImportConfirmed,
  } = model;

  return (
    <CsvImportDialog
      busy={busy || rosterImportInspecting}
      columnMappings={rosterImportMappings.map((mapping) => ({
        ...mapping,
        header: rosterImportHeaders[mapping.sourceIndex] ?? "",
        samples: rosterImportSamples.map((row) => row[mapping.sourceIndex] ?? ""),
      }))}
      columnWarnings={rosterImportInspection?.warnings ?? []}
      confirmed={rosterImportConfirmed}
      description="Upload a CSV to add profiles to this roster."
      error={error}
      file={importFile}
      helpText="Profiles are created without login access. Contact emails and phone numbers are saved; no invitations are sent."
      invalid={Boolean(rosterImportInspection?.fatalError)}
      mappingOptions={rosterCsvColumnOptions.map((value) => ({
        label: value === "Voice Part" ? partLabel : value,
        required: value === "Name",
        value,
      }))}
      onClose={closeImportDialog}
      onConfirmationChange={setRosterImportConfirmed}
      onFileChange={handleRosterImportFile}
      onImport={() => {
        void importRoster();
      }}
      onMapColumn={handleRosterColumnMap}
      open={importDialogOpen}
      title="Import roster"
    />
  );
}
