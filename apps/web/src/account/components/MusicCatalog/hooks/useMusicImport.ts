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
      const imported = await importOrganizationMusicCsv(
        mapMusicCsvColumns(csv, musicImportMappings),
      );
      setPieces(await listOrganizationMusic());
      setImportFile(null);
      setImportDialogOpen(false);
      setMusicImportCsv("");
      setMusicImportHeaders([]);
      setMusicImportMappings([]);
      setMusicImportInspection(null);
      setMusicImportConfirmed(false);
      setMusicImportInspecting(false);
      setMessage(`${String(imported)} music piece(s) imported.`);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError ? caught.message : "The music CSV could not be imported.",
      );
    } finally {
      setBusy(false);
    }
  }
  return {
    closeImportDialog,
    handleMusicColumnMap,
    handleMusicImportFile,
    importCsv,
    importDialogOpen,
    importFile,
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
