import {
  inspectMusicCsv,
  inspectRosterCsv,
  mapMusicCsvColumns,
  mapRosterCsvColumns,
  musicCsvColumnForHeader,
  musicCsvColumnOptions,
  rosterCsvColumnForHeader,
  rosterCsvColumnOptions,
  type CsvColumnMapping,
  type MusicCsvInspection,
  type RosterCsvInspection,
} from "@choir/domain";
import { useState } from "react";

import {
  AuthApiError,
  importOrganizationMusicCsv,
  importOrganizationProfilesCsv,
} from "../auth/api";
import {
  CsvImportDialog,
  type CsvImportColumnMapping,
  type CsvImportMappingOption,
} from "../account/CsvImportDialog";

type ImportKind = "music" | "roster";
type ImportInspection = MusicCsvInspection | RosterCsvInspection;

interface ImportState {
  readonly confirmed: boolean;
  readonly error: string | null;
  readonly file: File | null;
  readonly headers: readonly string[];
  readonly imported: number | null;
  readonly invitationCandidates: number | null;
  readonly inspecting: boolean;
  readonly inspection: ImportInspection | null;
  readonly mappings: readonly CsvColumnMapping[];
  readonly csv: string;
}

const emptyImportState: ImportState = {
  confirmed: false,
  csv: "",
  error: null,
  file: null,
  headers: [],
  imported: null,
  invitationCandidates: null,
  inspecting: false,
  inspection: null,
  mappings: [],
};

function importLabel(kind: ImportKind): string {
  return kind === "roster" ? "roster" : "Music Library";
}

function inspectImport(kind: ImportKind, csv: string): ImportInspection {
  return kind === "roster" ? inspectRosterCsv(csv) : inspectMusicCsv(csv);
}

function mapImportColumns(
  kind: ImportKind,
  csv: string,
  mappings: readonly CsvColumnMapping[],
): string {
  return kind === "roster" ? mapRosterCsvColumns(csv, mappings) : mapMusicCsvColumns(csv, mappings);
}

function mapOptions(kind: ImportKind): readonly CsvImportMappingOption[] {
  const options = kind === "roster" ? rosterCsvColumnOptions : musicCsvColumnOptions;
  return options.map((value) => ({ label: value, value }));
}

function createMappings(kind: ImportKind, headers: readonly string[]): CsvColumnMapping[] {
  return headers.map((header, sourceIndex) => ({
    sourceIndex,
    targetHeader:
      kind === "roster" ? rosterCsvColumnForHeader(header) : musicCsvColumnForHeader(header),
  }));
}

function SetupDataImportDialog({
  importing,
  kind,
  onClose,
  onColumnMap,
  onConfirmationChange,
  onFileChange,
  onImport,
  state,
}: {
  readonly importing: boolean;
  readonly kind: ImportKind;
  readonly onClose: () => void;
  readonly onColumnMap: (sourceIndex: number, targetHeader: string | null) => void;
  readonly onConfirmationChange: (confirmed: boolean) => void;
  readonly onFileChange: (file: File | null) => void;
  readonly onImport: () => void;
  readonly state: ImportState;
}) {
  return (
    <CsvImportDialog
      busy={importing || state.inspecting}
      columnMappings={state.mappings.map((mapping): CsvImportColumnMapping => ({
        ...mapping,
        header: state.headers[mapping.sourceIndex] ?? "",
      }))}
      columnWarnings={state.inspection?.warnings ?? []}
      confirmed={state.confirmed}
      description={
        kind === "roster"
          ? "Add Profiles from the established roster CSV format."
          : "Import up to 500 top-level works atomically. Existing catalog entries are retained."
      }
      error={state.error}
      file={state.file}
      helpText={
        kind === "roster"
          ? "Profiles are created without login access. CSV email addresses are counted as invitation candidates; send Membership invitations separately when ready."
          : "Existing catalog entries are retained. Practice tracks and publisher links can be added after import."
      }
      invalid={Boolean(state.inspection?.fatalError)}
      mappingOptions={mapOptions(kind)}
      onClose={onClose}
      onConfirmationChange={onConfirmationChange}
      onFileChange={onFileChange}
      onImport={onImport}
      onMapColumn={onColumnMap}
      open
      title={kind === "roster" ? "Import roster CSV" : "Import Music Library CSV"}
    />
  );
}

export function SetupDataImportStep() {
  const [activeImport, setActiveImport] = useState<ImportKind | null>(null);
  const [importing, setImporting] = useState<ImportKind | null>(null);
  const [roster, setRoster] = useState<ImportState>(emptyImportState);
  const [music, setMusic] = useState<ImportState>(emptyImportState);

  function stateFor(kind: ImportKind): ImportState {
    return kind === "roster" ? roster : music;
  }

  function updateState(kind: ImportKind, update: (current: ImportState) => ImportState): void {
    if (kind === "roster") {
      setRoster(update);
    } else {
      setMusic(update);
    }
  }

  function openImport(kind: ImportKind): void {
    updateState(kind, (current) => ({ ...current, error: null }));
    setActiveImport(kind);
  }

  function closeImport(): void {
    if (importing) return;
    setActiveImport(null);
  }

  function handleFileChange(kind: ImportKind, file: File | null): void {
    updateState(kind, (current) => ({
      ...current,
      confirmed: false,
      csv: "",
      error: null,
      file,
      headers: [],
      inspecting: Boolean(file),
      inspection: null,
      mappings: [],
    }));
    if (!file) return;
    void file
      .text()
      .then((csv) => {
        const initialInspection = inspectImport(kind, csv);
        const headers = initialInspection.headers;
        const mappings = createMappings(kind, headers);
        const inspection = inspectImport(kind, mapImportColumns(kind, csv, mappings));
        updateState(kind, (current) => ({
          ...current,
          csv,
          error: inspection.fatalError,
          headers,
          inspecting: false,
          inspection,
          mappings,
        }));
      })
      .catch(() => {
        updateState(kind, (current) => ({
          ...current,
          error: "The CSV could not be read.",
          inspecting: false,
        }));
      });
  }

  function handleColumnMap(
    kind: ImportKind,
    sourceIndex: number,
    targetHeader: string | null,
  ): void {
    const current = stateFor(kind);
    const mappings = current.mappings.map((mapping) =>
      mapping.sourceIndex === sourceIndex ? { ...mapping, targetHeader } : mapping,
    );
    try {
      const inspection = inspectImport(kind, mapImportColumns(kind, current.csv, mappings));
      updateState(kind, (state) => ({
        ...state,
        confirmed: false,
        error: inspection.fatalError,
        inspection,
        mappings,
      }));
    } catch {
      updateState(kind, (state) => ({
        ...state,
        confirmed: false,
        error: "The CSV column mapping could not be applied.",
        mappings,
      }));
    }
  }

  async function importData(kind: ImportKind): Promise<void> {
    const current = stateFor(kind);
    if (!current.file || current.inspection?.fatalError) return;
    setImporting(kind);
    updateState(kind, (state) => ({ ...state, error: null }));
    try {
      const csv = mapImportColumns(kind, await current.file.text(), current.mappings);
      if (kind === "roster") {
        const result = await importOrganizationProfilesCsv(csv);
        updateState(kind, () => ({
          ...emptyImportState,
          imported: result.imported,
          invitationCandidates: result.invitationCandidates,
        }));
      } else {
        const imported = await importOrganizationMusicCsv(csv);
        updateState(kind, () => ({ ...emptyImportState, imported }));
      }
      setActiveImport(null);
    } catch (error: unknown) {
      updateState(kind, (state) => ({
        ...state,
        error:
          error instanceof AuthApiError
            ? error.message
            : `The ${importLabel(kind)} CSV could not be imported.`,
      }));
    } finally {
      setImporting(null);
    }
  }

  const completedImports = [roster.imported !== null, music.imported !== null].filter(
    Boolean,
  ).length;

  return (
    <>
      <div className="setup-data-import__heading">
        <div>
          <p className="eyebrow">Optional</p>
          <h2 id="setup-step-heading">Import existing data</h2>
        </div>
        <span className="status-pill">{String(completedImports)} of 2 imported</span>
      </div>
      <p>
        If you already have data, import it now using the same CSV formats available in the Roster
        and Music Library pages. You can skip both imports and do them later.
      </p>
      <div className="setup-data-import__options">
        <section className="setup-data-import__option" aria-labelledby="setup-roster-import-title">
          <div>
            <h3 id="setup-roster-import-title">Roster CSV</h3>
            <p>Add Profiles, voice parts, statuses, notes, and section-leader assignments.</p>
            {roster.imported !== null ? (
              <p className="notice notice--success" role="status">
                {String(roster.imported)} Profile(s) imported
                {roster.invitationCandidates
                  ? `; ${String(roster.invitationCandidates)} invitation candidate(s) found.`
                  : "."}
              </p>
            ) : null}
          </div>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              openImport("roster");
            }}
          >
            {roster.imported === null ? "Import roster CSV" : "Import another roster CSV"}
          </button>
        </section>
        <section className="setup-data-import__option" aria-labelledby="setup-music-import-title">
          <div>
            <h3 id="setup-music-import-title">Music Library CSV</h3>
            <p>Add titles, composers, catalog IDs, durations, genres, sections, and notes.</p>
            {music.imported !== null ? (
              <p className="notice notice--success" role="status">
                {String(music.imported)} music piece(s) imported.
              </p>
            ) : null}
          </div>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              openImport("music");
            }}
          >
            {music.imported === null
              ? "Import Music Library CSV"
              : "Import another Music Library CSV"}
          </button>
        </section>
      </div>
      <p className="field-help">This step is optional. Choose Continue to skip imports for now.</p>
      {activeImport ? (
        <SetupDataImportDialog
          importing={Boolean(importing)}
          kind={activeImport}
          onClose={closeImport}
          onColumnMap={(sourceIndex, targetHeader) => {
            handleColumnMap(activeImport, sourceIndex, targetHeader);
          }}
          onConfirmationChange={(confirmed) => {
            updateState(activeImport, (current) => ({ ...current, confirmed }));
          }}
          onFileChange={(file) => {
            handleFileChange(activeImport, file);
          }}
          onImport={() => {
            void importData(activeImport);
          }}
          state={stateFor(activeImport)}
        />
      ) : null}
    </>
  );
}
