import {
  inspectMusicCsv,
  mapMusicCsvColumns,
  musicCsvColumnForHeader,
  type CsvColumnMapping,
  type MusicCsvInspection,
} from "@choir/domain";
import { useState, type Dispatch, type SetStateAction } from "react";
import {
  AuthApiError,
  importOrganizationMusicCsv,
  listOrganizationMusic,
} from "../../../../auth/api";
import type { OrganizationMusicPiece } from "@choir/contracts";
export function useMusicImport({
  busy,
  setBusy,
  setError,
  setMessage,
  setPieces,
}: {
  readonly busy: boolean;
  readonly setBusy: (value: boolean) => void;
  readonly setError: (value: string | null) => void;
  readonly setMessage: (value: string | null) => void;
  readonly setPieces: Dispatch<SetStateAction<readonly OrganizationMusicPiece[]>>;
}) {
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [lastImportErrors, setLastImportErrors] = useState<
    readonly { readonly reason: string; readonly row: number }[]
  >([]);
  const [musicImportCsv, setMusicImportCsv] = useState("");
  const [musicImportHeaders, setMusicImportHeaders] = useState<readonly string[]>([]);
  const [musicImportMappings, setMusicImportMappings] = useState<readonly CsvColumnMapping[]>([]);
  const [musicImportInspection, setMusicImportInspection] = useState<MusicCsvInspection | null>(
    null,
  );
  const [musicImportConfirmed, setMusicImportConfirmed] = useState(false);
  const [musicImportInspecting, setMusicImportInspecting] = useState(false);
  function closeImportDialog(): void {
    if (busy) return;
    setImportDialogOpen(false);
    setImportFile(null);
    setLastImportErrors([]);
    setMusicImportCsv("");
    setMusicImportHeaders([]);
    setMusicImportMappings([]);
    setMusicImportInspection(null);
    setMusicImportConfirmed(false);
    setMusicImportInspecting(false);
  }
  function handleMusicImportFile(file: File | null): void {
    setImportFile(file);
    setMusicImportCsv("");
    setMusicImportHeaders([]);
    setMusicImportMappings([]);
    setMusicImportInspection(null);
    setMusicImportConfirmed(false);
    setError(null);
    setMusicImportInspecting(Boolean(file));
    if (!file) return;
    void file
      .text()
      .then((csv) => {
        const initialInspection = inspectMusicCsv(csv);
        const mappings = initialInspection.headers.map((header, sourceIndex) => ({
          sourceIndex,
          targetHeader: musicCsvColumnForHeader(header),
        }));
        setMusicImportCsv(csv);
        setMusicImportHeaders(initialInspection.headers);
        setMusicImportMappings(mappings);
        const inspection = inspectMusicCsv(mapMusicCsvColumns(csv, mappings));
        setMusicImportInspection(inspection);
        if (inspection.fatalError) setError(inspection.fatalError);
      })
      .catch(() => {
        setError("The CSV could not be read.");
      })
      .finally(() => {
        setMusicImportInspecting(false);
      });
  }
  function handleMusicColumnMap(sourceIndex: number, targetHeader: string | null): void {
    const nextMappings = musicImportMappings.map((mapping) =>
      mapping.sourceIndex === sourceIndex ? { ...mapping, targetHeader } : mapping,
    );
    setMusicImportMappings(nextMappings);
    setMusicImportConfirmed(false);
    setMusicImportInspection(inspectMusicCsv(mapMusicCsvColumns(musicImportCsv, nextMappings)));
  }
  async function importCsv(): Promise<void> {
    if (!importFile) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const csv = await importFile.text();
      const result = await importOrganizationMusicCsv(mapMusicCsvColumns(csv, musicImportMappings));
      setPieces(await listOrganizationMusic());
      setImportFile(null);
      setImportDialogOpen(false);
      setMusicImportCsv("");
      setMusicImportHeaders([]);
      setMusicImportMappings([]);
      setMusicImportInspection(null);
      setMusicImportConfirmed(false);
      setMusicImportInspecting(false);
      if (result.skipped > 0) {
        setMessage(
          `${String(result.imported)} music piece(s) imported, ${String(result.skipped)} row(s) skipped.`,
        );
        setLastImportErrors(result.errors);
      } else {
        setMessage(`${String(result.imported)} music piece(s) imported.`);
        setLastImportErrors([]);
      }
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError ? caught.message : "The music CSV could not be imported.",
      );
    } finally {
      setBusy(false);
    }
  }
  function downloadImportErrors(): void {
    if (lastImportErrors.length === 0) return;
    const header = "Row,Reason";
    const rows = lastImportErrors.map(
      ({ reason, row }) => `${String(row)},"${reason.replaceAll('"', '""')}"`,
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "music_import_errors.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return {
    closeImportDialog,
    downloadImportErrors,
    handleMusicColumnMap,
    handleMusicImportFile,
    importCsv,
    importDialogOpen,
    importFile,
    lastImportErrors,
    musicImportConfirmed,
    musicImportHeaders,
    musicImportInspecting,
    musicImportInspection,
    musicImportMappings,
    musicImportCsv,
    setImportDialogOpen,
    setMusicImportConfirmed,
  };
}
