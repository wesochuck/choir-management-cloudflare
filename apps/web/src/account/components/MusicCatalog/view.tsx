import { type CsvColumnMapping, musicCsvColumnOptions } from "@choir/domain";
import { Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from "@choir/ui";
import { MusicGenreFilter, MusicGenrePicker } from "./shared";
import { normalizeDurationInput, uniqueLabels } from "./utils";
import { MusicCatalogTable, SectionBuckets } from "./table";
import { performanceContainsPiece, pieceIdsForPerformance } from "./tableUtils";
import { MusicPiecePerformances, MusicTuttiTrackDropzone } from "./performances";
import { MusicAudioTracks, MusicBulkEditDialog, MusicDeleteControls } from "./tracksAndBulkEdit";
import { MusicCredits } from "./credits";
import { AddToSetListDialog } from "./AddToSetListDialog";
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
    addSelectedPiecesToSetList,
    applyBulkChanges,
    applyBulkDelete,
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
    defaultPageSize,
    deleteConfirm,
    deselectManyPieces,
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
    uncategorizedCount,
    genreFilterSearch,
    genresInput,
    showUncategorized,
    toggleUncategorized,
    handleMusicColumnMap,
    handleMusicImportFile,
    handlePendingTuttiFileChange,
    handlePerformanceChanged,
    handleTrackDurationDetected,
    downloadImportErrors,
    importCsv,
    importDialogOpen,
    importFile,
    lastImportErrors,
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
    setListDialogOpen,
    setListError,
    setMessage,
    setMusicImportConfirmed,
    setPiece,
    setPieces,
    setSearch,
    setSetListDialogOpen,
    setSetListError,
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
      {lastImportErrors.length > 0 && !dialogOpen && !importDialogOpen && !bulkDialogOpen ? (
        <div className="notice notice--warning" role="status">
          <p>
            {String(lastImportErrors.length)} row(s) were skipped.{" "}
            <button className="text-button" onClick={downloadImportErrors} type="button">
              Download error CSV
            </button>
          </p>
          <ul>
            {lastImportErrors.slice(0, 5).map(({ reason, row }) => (
              <li key={row}>
                Row {String(row)}: {reason}
              </li>
            ))}
            {lastImportErrors.length > 5 ? (
              <li>...and {String(lastImportErrors.length - 5)} more</li>
            ) : null}
          </ul>
        </div>
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
                showUncategorized={showUncategorized}
                uncategorizedCount={uncategorizedCount}
                onModeChange={setGenreFilterMode}
                onSearchChange={setGenreFilterSearch}
                onToggle={toggleGenre}
                onToggleUncategorized={toggleUncategorized}
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
                disabled={selectedPieces.length === 0}
                type="button"
                onClick={() => {
                  setSetListError(null);
                  setSetListDialogOpen(true);
                }}
              >
                Add to set list
                {selectedPieces.length > 0 ? ` (${String(selectedPieces.length)})` : ""}
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
              defaultPageSize={defaultPageSize}
              genreFilterMode={genreFilterMode}
              showUncategorized={showUncategorized}
              onError={setError}
              onPieceSaved={(saved, successMessage) => {
                setPieces((current) =>
                  current.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
                );
                setMessage(successMessage);
              }}
              onEdit={selectPiece}
              onDeselectMany={deselectManyPieces}
              onSelectMany={selectManyPieces}
              onToggleSelection={togglePieceSelection}
              pieces={pieces}
              publisherSearchTemplate={publisherSearchTemplate}
              rosterConfiguration={roster}
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
              editingId
                ? piece.title.trim()
                  ? `Edit music piece: ${piece.title.trim()}`
                  : "Edit music piece"
                : piece.parentId
                  ? "Add movement"
                  : "Add music piece"
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
              <Tabs onValueChange={setEditorTab} value={editorTab}>
                <div className="music-piece-tabs">
                  <TabsList aria-label="Music piece editor">
                    <TabsTrigger
                      aria-controls="music-piece-details"
                      id="music-piece-details-tab"
                      value="details"
                    >
                      Piece details
                    </TabsTrigger>
                    <TabsTrigger
                      aria-controls="music-piece-tracks"
                      disabled={!selectedPiece}
                      id="music-piece-tracks-tab"
                      value="tracks"
                    >
                      Practice tracks
                      {selectedPiece && Object.values(selectedPiece.trackFileIds).some(Boolean)
                        ? ` (${String(Object.values(selectedPiece.trackFileIds).filter(Boolean).length)})`
                        : ""}
                    </TabsTrigger>
                    <TabsTrigger
                      aria-controls="music-piece-performances"
                      disabled={!selectedPiece}
                      id="music-piece-performances-tab"
                      value="performances"
                    >
                      Linked performances
                      {selectedPiece
                        ? ` (${String(events.filter((event) => event.type === "Performance" && performanceContainsPiece(event, pieceIdsForPerformance(selectedPiece, pieces))).length)})`
                        : ""}
                    </TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent
                  aria-labelledby="music-piece-details-tab"
                  id="music-piece-details"
                  value="details"
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
                </TabsContent>
                <TabsContent
                  aria-labelledby="music-piece-tracks-tab"
                  id="music-piece-tracks"
                  value="tracks"
                >
                  {selectedPiece ? (
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
                  ) : (
                    <p className="notice">Save the piece first, then add practice tracks.</p>
                  )}
                </TabsContent>
                <TabsContent
                  aria-labelledby="music-piece-performances-tab"
                  id="music-piece-performances"
                  value="performances"
                >
                  {selectedPiece ? (
                    <MusicPiecePerformances
                      allEvents={events}
                      allPieces={pieces}
                      onEventChanged={handlePerformanceChanged}
                      piece={selectedPiece}
                      timezone={timezone}
                      venues={venues}
                    />
                  ) : (
                    <p className="notice">Save the piece first, then link performances.</p>
                  )}
                </TabsContent>
              </Tabs>
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
            onBulkDelete={(unlink) => {
              void applyBulkDelete(unlink);
            }}
            onClose={closeBulkDialog}
            open={bulkDialogOpen}
            personNameOptions={personNameOptions}
            pieces={pieces}
            selectedCount={selectedPieces.length}
            selectedPieceIds={selectedPieceIds}
            key={bulkDialogOpen ? "open" : "closed"}
          />
          <AddToSetListDialog
            busy={busy}
            error={setListError}
            events={events}
            onApply={(payload) => {
              void addSelectedPiecesToSetList(payload);
            }}
            onClose={() => {
              setSetListDialogOpen(false);
              setSetListError(null);
            }}
            open={setListDialogOpen}
            selectedPieces={selectedPieces}
            timezone={timezone}
            venues={venues}
            key={setListDialogOpen ? "open" : "closed"}
          />
          <CsvImportDialog
            busy={busy || musicImportInspecting}
            columnMappings={musicImportMappings.map((mapping: CsvColumnMapping) => ({
              ...mapping,
              header: musicImportHeaders[mapping.sourceIndex] ?? "",
            }))}
            confirmed={musicImportConfirmed}
            description="Import up to 500 works. Existing catalog entries are preserved."
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
            title="Import music catalog"
          />
        </div>
      )}
    </section>
  );
}
