import { musicCsvColumnOptions } from "@choir/domain";
import { Dialog } from "@choir/ui";
import { MusicGenreFilter, MusicGenrePicker } from "./shared";
import { normalizeDurationInput, uniqueLabels } from "./utils";
import { MusicCatalogTable, SectionBuckets } from "./table";
import { performanceContainsPiece, pieceIdsForPerformance } from "./tableUtils";
import { MusicPiecePerformances, MusicTuttiTrackDropzone } from "./performances";
import { MusicAudioTracks, MusicBulkEditDialog, MusicDeleteControls } from "./tracksAndBulkEdit";
import { MusicCredits } from "./credits";
import { CsvImportDialog } from "../../CsvImportDialog";
import { AppLink } from "../AuthenticatedShell/navigation";
import type { MusicCatalogModel } from "./hooks";

// eslint-disable-next-line complexity -- render composition preserves the existing screen's independent states and dialogs.
export function MusicCatalogView({
  model,
  navigate,
  returnTo,
  view = "catalog",
}: {
  readonly model: MusicCatalogModel;
  readonly navigate: (href: string) => void;
  readonly returnTo?: string | null | undefined;
  readonly view?: "catalog" | "credits";
}) {
  const {
    applyBulkChanges,
    availableGenres,
    beginNew,
    bulkDialogOpen,
    bulkError,
    busy,
    childCount,
    closeBulkDialog,
    closeDialog,
    closeImportDialog,
    copiesInput,
    deleteConfirm,
    dialogOpen,
    durationAutoFillLabel,
    durationDetectionNotice,
    durationInput,
    durationMismatch,
    editingId,
    editorTab,
    error,
    events,
    genreCounts,
    genreFilterMode,
    genreFilterSearch,
    genresInput,
    handleMusicColumnMap,
    handleMusicImportFile,
    handlePendingTuttiFileChange,
    handlePerformanceChanged,
    handleTrackDurationDetected,
    importCsv,
    importDialogOpen,
    importFile,
    message,
    musicImportConfirmed,
    musicImportHeaders,
    musicImportInspecting,
    musicImportInspection,
    musicImportMappings,
    pendingTuttiFile,
    personNameOptions,
    piece,
    pieces,
    publisherSearchTemplate,
    renameCredit,
    remove,
    roster,
    save,
    search,
    selectManyPieces,
    selectPiece,
    selectedGenres,
    selectedPiece,
    selectedPieceIds,
    selectedPieces,
    setBulkDialogOpen,
    setBulkError,
    setCopiesInput,
    setDeleteConfirm,
    setDurationValue,
    setEditorPiece,
    setEditorTab,
    setError,
    setGenreFilterMode,
    setGenreFilterSearch,
    setGenresInput,
    setImportDialogOpen,
    setMessage,
    setMusicImportConfirmed,
    setPiece,
    setPieces,
    setSearch,
    setUnlinkChildren,
    timezone,
    toggleGenre,
    togglePieceSelection,
    topLevelPieces,
    unlinkChildren,
    venues,
  } = model;
  if (view === "credits") {
    return (
      <section
        className="account-section music-catalog-section"
        aria-label="Composers and arrangers"
      >
        <div className="section-heading section-heading--compact">
          <p className="section-description">
            Review exact catalog credits and correct a composer or arranger name everywhere it is
            used.
          </p>
        </div>
        <nav className="music-library-tabs" aria-label="Music library sections">
          <AppLink href="/admin/library" onNavigate={navigate}>
            Music Catalog
          </AppLink>
          <AppLink ariaCurrent="page" href="/admin/library?view=credits" onNavigate={navigate}>
            Composers &amp; arrangers <span className="sr-only">(current)</span>
          </AppLink>
          <AppLink href="/admin/library/settings" onNavigate={navigate}>
            Library Settings
          </AppLink>
        </nav>
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="notice notice--success" role="status">
            {message}
          </p>
        ) : null}
        {!roster ? (
          <p role="status">Loading music credits…</p>
        ) : (
          <MusicCredits busy={busy} onRename={renameCredit} pieces={pieces} />
        )}
      </section>
    );
  }
  return (
    <section className="account-section music-catalog-section" aria-label="Music catalog">
      {returnTo && !dialogOpen ? (
        <div className="music-library-return">
          <AppLink className="button button--secondary" href={returnTo} onNavigate={navigate}>
            ← Back to set list
          </AppLink>
        </div>
      ) : null}
      <div className="section-heading section-heading--compact">
        <p className="section-description">
          Manage owned works and movements. Audio tracks are stored securely as Organization files
          and will appear here when linked through the track workflow.
        </p>
      </div>
      <nav className="music-library-tabs" aria-label="Music library sections">
        <AppLink ariaCurrent="page" href="/admin/library" onNavigate={navigate}>
          Music Catalog <span className="sr-only">(current)</span>
        </AppLink>
        <AppLink href="/admin/library?view=credits" onNavigate={navigate}>
          Composers &amp; arrangers
        </AppLink>
        <AppLink href="/admin/library/settings" onNavigate={navigate}>
          Library Settings
        </AppLink>
      </nav>
      {error && !dialogOpen && !importDialogOpen && !bulkDialogOpen ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {message && !dialogOpen && !importDialogOpen && !bulkDialogOpen ? (
        <p className="notice notice--success" role="status">
          {message}
        </p>
      ) : null}
      {!roster ? (
        <p>Loading music catalog…</p>
      ) : (
        <div className="music-catalog-layout">
          <div>
            <div className="music-catalog-toolbar">
              <label className="field">
                Search catalog
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                />
              </label>
              <MusicGenreFilter
                counts={genreCounts}
                genres={availableGenres}
                mode={genreFilterMode}
                search={genreFilterSearch}
                selected={selectedGenres}
                onModeChange={setGenreFilterMode}
                onSearchChange={setGenreFilterSearch}
                onToggle={toggleGenre}
              />
              <button
                className="button button--secondary"
                disabled={selectedPieces.length === 0}
                type="button"
                onClick={() => {
                  setBulkError(null);
                  setBulkDialogOpen(true);
                }}
              >
                Bulk edit{selectedPieces.length > 0 ? ` (${String(selectedPieces.length)})` : ""}
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  beginNew();
                }}
              >
                Add music piece
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  setError(null);
                  setMessage(null);
                  setImportDialogOpen(true);
                }}
              >
                Import CSV
              </button>
              <a
                className="button button--secondary"
                download
                href="/api/organization/music/export"
              >
                Export CSV
              </a>
            </div>
            <MusicCatalogTable
              genreFilterMode={genreFilterMode}
              onEdit={selectPiece}
              onSelectMany={selectManyPieces}
              onToggleSelection={togglePieceSelection}
              pieces={pieces}
              publisherSearchTemplate={publisherSearchTemplate}
              search={search}
              selectedIds={selectedPieceIds}
              selectedGenres={selectedGenres}
            />
          </div>
          <Dialog
            description="Catalog metadata, sections, movements, learning tracks, and linked performances."
            onClose={closeDialog}
            open={dialogOpen}
            title={
              editingId ? "Edit music piece" : piece.parentId ? "Add movement" : "Add music piece"
            }
          >
            {error && dialogOpen ? (
              <p className="notice notice--error" role="alert">
                {error}
              </p>
            ) : null}
            {returnTo ? (
              <div className="music-library-return">
                <AppLink className="button button--secondary" href={returnTo} onNavigate={navigate}>
                  ← Back to set list
                </AppLink>
              </div>
            ) : null}
            {message && dialogOpen ? (
              <p className="notice notice--success" role="status">
                {message}
              </p>
            ) : null}
            <form
              className="form-stack music-piece-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <datalist id="music-composer-arranger-options">
                {personNameOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <div className="music-piece-tabs" role="tablist" aria-label="Music piece editor">
                <button
                  aria-controls="music-piece-details"
                  aria-selected={editorTab === "details"}
                  className={editorTab === "details" ? "is-active" : undefined}
                  id="music-piece-details-tab"
                  onClick={() => {
                    setEditorTab("details");
                  }}
                  role="tab"
                  type="button"
                >
                  Piece details
                </button>
                <button
                  aria-controls="music-piece-tracks"
                  aria-selected={editorTab === "tracks"}
                  className={editorTab === "tracks" ? "is-active" : undefined}
                  disabled={!selectedPiece}
                  id="music-piece-tracks-tab"
                  onClick={() => {
                    setEditorTab("tracks");
                  }}
                  role="tab"
                  type="button"
                >
                  Practice tracks
                  {selectedPiece && Object.values(selectedPiece.trackFileIds).some(Boolean)
                    ? ` (${String(Object.values(selectedPiece.trackFileIds).filter(Boolean).length)})`
                    : ""}
                </button>
                <button
                  aria-controls="music-piece-performances"
                  aria-selected={editorTab === "performances"}
                  className={editorTab === "performances" ? "is-active" : undefined}
                  disabled={!selectedPiece}
                  id="music-piece-performances-tab"
                  onClick={() => {
                    setEditorTab("performances");
                  }}
                  role="tab"
                  type="button"
                >
                  Linked performances
                  {selectedPiece
                    ? ` (${String(events.filter((event) => event.type === "Performance" && performanceContainsPiece(event, pieceIdsForPerformance(selectedPiece, pieces))).length)})`
                    : ""}
                </button>
              </div>
              {editorTab === "details" ? (
                <div
                  aria-labelledby="music-piece-details-tab"
                  id="music-piece-details"
                  role="tabpanel"
                >
                  <div className="music-fields-grid">
                    <label className="field music-field--wide">
                      Title
                      <input
                        maxLength={500}
                        required
                        value={piece.title}
                        onChange={(event) => {
                          setPiece((current) => ({ ...current, title: event.target.value }));
                        }}
                      />
                    </label>
                    <label className="field">
                      Composer
                      <input
                        aria-autocomplete="list"
                        list="music-composer-arranger-options"
                        maxLength={300}
                        value={piece.composer}
                        onChange={(event) => {
                          setPiece((current) => ({ ...current, composer: event.target.value }));
                        }}
                      />
                    </label>
                    <label className="field">
                      Arranger
                      <input
                        aria-autocomplete="list"
                        list="music-composer-arranger-options"
                        maxLength={300}
                        value={piece.arranger}
                        onChange={(event) => {
                          setPiece((current) => ({ ...current, arranger: event.target.value }));
                        }}
                      />
                    </label>
                    <label className="field">
                      Catalog ID
                      <input
                        maxLength={200}
                        value={piece.catalogId}
                        onChange={(event) => {
                          setPiece((current) => ({ ...current, catalogId: event.target.value }));
                        }}
                      />
                    </label>
                    <label className="field">
                      Purchase date
                      <input
                        type="date"
                        value={piece.purchaseDate ?? ""}
                        onChange={(event) => {
                          setPiece((current) => ({
                            ...current,
                            purchaseDate: event.target.value || null,
                          }));
                        }}
                      />
                    </label>
                    <label className="field">
                      Copies
                      <input
                        inputMode="numeric"
                        min="0"
                        step="1"
                        type="number"
                        value={copiesInput}
                        onChange={(event) => {
                          setCopiesInput(event.target.value);
                        }}
                      />
                    </label>
                    <label className="field">
                      Duration (minutes:seconds)
                      <input
                        placeholder="4:05 or 4"
                        value={durationInput}
                        onBlur={() => {
                          const normalized = normalizeDurationInput(durationInput);
                          if (normalized !== durationInput) setDurationValue(normalized, true);
                        }}
                        onChange={(event) => {
                          setDurationValue(event.target.value, true);
                        }}
                      />
                      {durationAutoFillLabel ? (
                        <small className="field-hint">
                          Auto-detected from “{durationAutoFillLabel}” track.
                        </small>
                      ) : null}
                      {durationDetectionNotice ? (
                        <small className="field-hint">{durationDetectionNotice}</small>
                      ) : null}
                      {durationMismatch ? (
                        <small className="music-duration-mismatch">
                          Tracks suggest {durationMismatch.suggested}.
                          {durationMismatch.current
                            ? ` Current: ${durationMismatch.current}. `
                            : " "}
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => {
                              setDurationValue(durationMismatch.suggested, true);
                            }}
                          >
                            Update
                          </button>
                        </small>
                      ) : null}
                    </label>
                    <label className="field music-field--wide">
                      Genres
                      <MusicGenrePicker
                        availableGenres={availableGenres}
                        selected={uniqueLabels(genresInput)}
                        onChange={(genres) => {
                          setGenresInput(genres.join(", "));
                        }}
                      />
                    </label>
                    <label className="field music-field--wide">
                      Parent work
                      <select
                        value={piece.parentId ?? ""}
                        onChange={(event) => {
                          setPiece((current) => ({
                            ...current,
                            parentId: event.target.value || null,
                          }));
                        }}
                      >
                        <option value="">Top-level work</option>
                        {topLevelPieces.map((parent) => (
                          <option key={parent.id} value={parent.id}>
                            {parent.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field music-field--wide">
                      Notes
                      <textarea
                        maxLength={100_000}
                        rows={4}
                        value={piece.notes}
                        onChange={(event) => {
                          setPiece((current) => ({ ...current, notes: event.target.value }));
                        }}
                      />
                    </label>
                  </div>
                  {!editingId ? (
                    <MusicTuttiTrackDropzone
                      disabled={busy}
                      file={pendingTuttiFile}
                      onChange={handlePendingTuttiFileChange}
                    />
                  ) : null}
                  <SectionBuckets
                    configuration={roster}
                    selected={piece.sectionBuckets}
                    onChange={(sectionBuckets) => {
                      setPiece((current) => ({ ...current, sectionBuckets }));
                    }}
                  />
                </div>
              ) : editorTab === "tracks" ? (
                selectedPiece ? (
                  <div
                    aria-labelledby="music-piece-tracks-tab"
                    id="music-piece-tracks"
                    role="tabpanel"
                  >
                    <MusicAudioTracks
                      configuration={roster}
                      key={selectedPiece.id}
                      piece={selectedPiece}
                      onTrackDurationDetected={handleTrackDurationDetected}
                      onSaved={(saved, successMessage) => {
                        setPieces((current) =>
                          current.map((candidate) =>
                            candidate.id === saved.id ? saved : candidate,
                          ),
                        );
                        setEditorPiece(saved, "tracks");
                        setMessage(successMessage);
                      }}
                    />
                  </div>
                ) : (
                  <p className="notice">Save the piece first, then add practice tracks.</p>
                )
              ) : selectedPiece ? (
                <div
                  aria-labelledby="music-piece-performances-tab"
                  id="music-piece-performances"
                  role="tabpanel"
                >
                  <MusicPiecePerformances
                    allEvents={events}
                    allPieces={pieces}
                    onEventChanged={handlePerformanceChanged}
                    piece={selectedPiece}
                    timezone={timezone}
                    venues={venues}
                  />
                </div>
              ) : (
                <p className="notice">Save the piece first, then link performances.</p>
              )}
              {editingId ? (
                <p className="field-help">
                  Learning tracks linked: {String(Object.keys(piece.trackFileIds).length)} ·
                  Movements: {String(childCount)}
                </p>
              ) : null}
              <MusicDeleteControls
                busy={busy}
                childCount={childCount}
                deleteConfirm={deleteConfirm}
                editingId={editingId}
                unlinkChildren={unlinkChildren}
                onAddMovement={() => {
                  beginNew(editingId);
                }}
                onCancel={() => {
                  setDeleteConfirm(false);
                }}
                onConfirm={() => void remove()}
                onRequest={() => {
                  setDeleteConfirm(true);
                }}
                onUnlinkChildren={(selected) => {
                  setUnlinkChildren(selected);
                }}
              />
            </form>
          </Dialog>
          <MusicBulkEditDialog
            busy={busy}
            configuration={roster}
            error={bulkError}
            onApply={(changes) => {
              void applyBulkChanges(changes);
            }}
            onClose={closeBulkDialog}
            open={bulkDialogOpen}
            personNameOptions={personNameOptions}
            selectedCount={selectedPieces.length}
            key={bulkDialogOpen ? "open" : "closed"}
          />
          <CsvImportDialog
            busy={busy || musicImportInspecting}
            columnWarnings={musicImportInspection?.warnings ?? []}
            columnMappings={musicImportMappings.map((mapping) => ({
              ...mapping,
              header: musicImportHeaders[mapping.sourceIndex] ?? "",
            }))}
            confirmed={musicImportConfirmed}
            description="Import up to 500 top-level works atomically. Existing catalog entries are retained."
            error={error}
            file={importFile}
            invalid={Boolean(musicImportInspection?.fatalError)}
            mappingOptions={musicCsvColumnOptions.map((value) => ({
              label: value,
              required: value === "Title",
              value,
            }))}
            onClose={closeImportDialog}
            onConfirmationChange={setMusicImportConfirmed}
            onFileChange={handleMusicImportFile}
            onImport={() => {
              void importCsv();
            }}
            onMapColumn={handleMusicColumnMap}
            open={importDialogOpen}
            title="Import music CSV"
          />
        </div>
      )}
    </section>
  );
}
