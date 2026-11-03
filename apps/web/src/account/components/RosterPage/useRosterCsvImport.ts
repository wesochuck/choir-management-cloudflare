import {
  inspectRosterCsv,
  mapRosterCsvColumns,
  rosterCsvColumnForHeader,
  type CsvColumnMapping,
  type RosterCsvInspection,
} from "@choir/domain";
import { useState, type Dispatch, type SetStateAction } from "react";

import {
  AuthApiError,
  importOrganizationProfilesCsv,
  listOrganizationProfiles,
} from "../../../auth/api";
import type { RosterState } from "./types";

export function useRosterCsvImport({
  busy,
  performerLabel,
  roster,
  setBusy,
  setError,
  setRoster,
  setSuccess,
}: {
  readonly busy: boolean;
  readonly performerLabel: string;
  readonly roster: RosterState;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setRoster: Dispatch<SetStateAction<RosterState>>;
  readonly setSuccess: Dispatch<SetStateAction<string | null>>;
}) {
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [rosterImportCsv, setRosterImportCsv] = useState("");
  const [rosterImportHeaders, setRosterImportHeaders] = useState<readonly string[]>([]);
  const [rosterImportMappings, setRosterImportMappings] = useState<readonly CsvColumnMapping[]>([]);
  const [rosterImportInspection, setRosterImportInspection] = useState<RosterCsvInspection | null>(
    null,
  );
  const [rosterImportConfirmed, setRosterImportConfirmed] = useState(false);
  const [rosterImportInspecting, setRosterImportInspecting] = useState(false);

  function closeImportDialog() {
    if (busy) return;
    setImportDialogOpen(false);
    setImportFile(null);
    setRosterImportCsv("");
    setRosterImportHeaders([]);
    setRosterImportMappings([]);
    setRosterImportInspection(null);
    setRosterImportConfirmed(false);
    setRosterImportInspecting(false);
  }

  function handleRosterImportFile(file: File | null): void {
    setImportFile(file);
    setRosterImportCsv("");
    setRosterImportHeaders([]);
    setRosterImportMappings([]);
    setRosterImportInspection(null);
    setRosterImportConfirmed(false);
    setRosterImportInspecting(Boolean(file));
    setError(null);
    if (!file) return;
    const configuredVoiceParts =
      roster.status === "ready" ? roster.configuration.voiceParts : undefined;
    void file
      .text()
      .then((csv) => {
        const initialInspection = inspectRosterCsv(csv, performerLabel, configuredVoiceParts);
        const mappings = initialInspection.headers.map((header, sourceIndex) => ({
          sourceIndex,
          targetHeader: rosterCsvColumnForHeader(header, performerLabel),
        }));
        setRosterImportCsv(csv);
        setRosterImportHeaders(initialInspection.headers);
        setRosterImportMappings(mappings);
        const inspection = inspectRosterCsv(
          mapRosterCsvColumns(csv, mappings),
          performerLabel,
          configuredVoiceParts,
        );
        setRosterImportInspection(inspection);
        if (inspection.fatalError) setError(inspection.fatalError);
      })
      .catch(() => {
        setError("The CSV could not be read.");
      })
      .finally(() => {
        setRosterImportInspecting(false);
      });
  }

  function handleRosterColumnMap(sourceIndex: number, targetHeader: string | null): void {
    const nextMappings = rosterImportMappings.map((mapping) =>
      mapping.sourceIndex === sourceIndex ? { ...mapping, targetHeader } : mapping,
    );
    setRosterImportMappings(nextMappings);
    setRosterImportConfirmed(false);
    const configuredVoiceParts =
      roster.status === "ready" ? roster.configuration.voiceParts : undefined;
    const nextInspection = inspectRosterCsv(
      mapRosterCsvColumns(rosterImportCsv, nextMappings),
      performerLabel,
      configuredVoiceParts,
    );
    setRosterImportInspection(nextInspection);
    setError(nextInspection.fatalError);
  }

  async function importRoster() {
    if (!importFile) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await importOrganizationProfilesCsv(
        mapRosterCsvColumns(await importFile.text(), rosterImportMappings),
      );
      const profiles = await listOrganizationProfiles();
      setRoster((current) => (current.status === "ready" ? { ...current, profiles } : current));
      setImportFile(null);
      setImportDialogOpen(false);
      setRosterImportCsv("");
      setRosterImportHeaders([]);
      setRosterImportMappings([]);
      setRosterImportInspection(null);
      setRosterImportConfirmed(false);
      setRosterImportInspecting(false);
      setSuccess(
        `${String(result.imported)} Profile(s) created. ${String(result.emailsPersisted)} email(s) and ${String(result.phonesPersisted)} phone(s) retained. ${String(result.conflicts.length)} conflicting row(s) skipped.${result.conflicts.map((conflict) => ` Row ${String(conflict.row)}: ${conflict.message}`).join("")}`,
      );
    } catch (importError: unknown) {
      setError(
        importError instanceof AuthApiError
          ? importError.message
          : "The roster CSV could not be imported.",
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    closeImportDialog,
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
    rosterImportSamples: rosterImportCsv
      ? (inspectRosterCsv(rosterImportCsv, performerLabel).samples ?? [])
      : [],
    setImportDialogOpen,
    setRosterImportConfirmed,
  };
}
