import type { OrganizationMusicPiece } from "@choir/contracts";
import { type CsvColumnMapping, musicCsvColumnOptions, sortMusicMovements } from "@choir/domain";
import { Dialog, Tabs, TabsContent } from "@choir/ui";
import { useMemo, useState } from "react";
import { listOrganizationMusic } from "../../../auth/api";
import { MusicGenreFilter, MusicGenrePicker } from "./shared";
import { formatParentWorkOption, normalizeDurationInput, uniqueLabels } from "./utils";
import { MusicCatalogTable, SectionBuckets } from "./table";
import { MusicPiecePerformances, MusicTuttiTrackDropzone } from "./performances";
import { MusicAudioTracks, MusicBulkEditDialog, MusicDeleteControls } from "./tracksAndBulkEdit";
import { MusicEditorNav } from "./MusicEditorNav";
import { MusicMovementList } from "./MusicMovementList";
import { MusicDigitalScores } from "./MusicDigitalScores";
import { MusicCredits } from "./credits";
import { AddToSetListDialog } from "./AddToSetListDialog";
import { CsvImportDialog } from "../../CsvImportDialog";
import { AppLink } from "../AuthenticatedShell/navigation";
import { BulkPracticeTrackImportDialog } from "./bulkTrackImport";
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
    backToParent,
    confirmationDialog,
    editorBodyRef,
    editorDirty,
    editorDirtySections,
    openMovement,
    parentEditorTitle,
    addSelectedPiecesToSetList,
    applyBulkChanges,
    applyBulkDelete,
    availableGenres,
    beginNew,
    bulkDialogOpen,
    bulkError,
    busy,
    childCount,
    clearCreditFilter,
    closeBulkDialog,
    closeDialog,
    closeImportDialog,
    copiesInput,
    creditFilter,
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
  const [bulkTrackImportOpen, setBulkTrackImportOpen] = useState(false);
  const [setListTargetPieces, setSetListTargetPieces] = useState<
    readonly OrganizationMusicPiece[] | null
  >(null);
  const movements = useMemo(
    () =>
      sortMusicMovements(
        pieces.filter((candidate) => candidate.parentId === editingId),
        piece.movementOrder,
      ),
    [editingId, piece.movementOrder, pieces],
  );
  async function openImportedPiece(pieceId: string): Promise<void> {
    setBulkTrackImportOpen(false);
    try {
      const updated = await listOrganizationMusic();
      setPieces(updated);
      const selected = updated.find((candidate) => candidate.id === pieceId);
      if (!selected) {
        setError("This music piece is no longer in the library.");
        return;
      }
      selectPiece(selected);
    } catch {
      setError("The music piece could not be loaded. Try opening it from the Music Library.");
    }
  }
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
          <MusicCredits busy={busy} onNavigate={navigate} onRename={renameCredit} pieces={pieces} />
        )}
      </section>
    );
  }
  return (
    <section className="account-section music-catalog-section" aria-label="Music catalog">
      {returnTo && !dialogOpen ? (
        <div className="music-library-return">
          <AppLink className="button button--secondary" href={returnTo} onNavigate={navigate}>
            ←{" "}
            {returnTo === "/admin/library/settings"
              ? "Back to Library Settings"
              : "Back to set list"}
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
      {error && !dialogOpen && !importDialogOpen && !bulkDialogOpen && !bulkTrackImportOpen ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {message && !dialogOpen && !importDialogOpen && !bulkDialogOpen && !bulkTrackImportOpen ? (
        <p className="notice notice--success" role="status">
          {message}
        </p>
      ) : null}
      {lastImportErrors.length > 0 &&
      !dialogOpen &&
      !importDialogOpen &&
      !bulkDialogOpen &&
      !bulkTrackImportOpen ? (
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
                className="button button--secondary button--control-height"
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
                className="button button--secondary button--control-height"
                disabled={selectedPieces.length === 0}
                type="button"
                onClick={() => {
                  setSetListTargetPieces(null);
                  setSetListError(null);
                  setSetListDialogOpen(true);
                }}
              >
                Add to set list
                {selectedPieces.length > 0 ? ` (${String(selectedPieces.length)})` : ""}
              </button>
              <button
                className="button button--secondary button--control-height"
                type="button"
                onClick={() => {
                  beginNew();
                }}
              >
                Add music piece
              </button>
              <button
                className="button button--secondary button--control-height"
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
                className="button button--secondary button--control-height"
                download
                href="/api/organization/music/export"
              >
                Export CSV
              </a>
              <button
                className="button button--secondary button--control-height"
                type="button"
                onClick={() => {
                  setError(null);
                  setMessage(null);
                  setBulkTrackImportOpen(true);
                }}
              >
                Bulk upload practice tracks
              </button>
            </div>
            {creditFilter ? (
              <div className="music-catalog-active-filter" role="status">
                <span>
                  Filtered by{" "}
                  {creditFilter.role === "composer"
                    ? "composer"
                    : creditFilter.role === "arranger"
                      ? "arranger"
                      : "composer or arranger"}
                  : <strong>{creditFilter.name}</strong>
                </span>
                <button
                  aria-label={`Clear filter for ${creditFilter.name}`}
                  className="button button--secondary button--small"
                  onClick={clearCreditFilter}
                  type="button"
                >
                  Clear
                </button>
              </div>
            ) : null}
            <MusicCatalogTable
              creditFilter={creditFilter}
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
            className="dialog--music-editor"
            bodyClassName="music-editor-body"
            dirty={editorDirty}
            description={
              editingId
                ? `${piece.composer || "Composer not set"}${childCount ? ` · ${String(childCount)} movements` : ""}`
                : "Catalog metadata, sections, movements, learning tracks, and linked performances."
            }
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
            {parentEditorTitle ? (
              <div className="music-editor-return">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    void backToParent();
                  }}
                  type="button"
                >
                  Back to {parentEditorTitle}
                </button>
              </div>
            ) : null}
            {returnTo ? (
              <div className="music-library-return">
                <AppLink className="button button--secondary" href={returnTo} onNavigate={navigate}>
                  ←{" "}
                  {returnTo === "/admin/library/settings"
                    ? "Back to Library Settings"
                    : "Back to set list"}
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
              <Tabs
                className="music-editor-layout"
                onValueChange={setEditorTab}
                orientation="vertical"
                value={editorTab}
              >
                <MusicEditorNav
                  dirtySections={editorDirtySections}
                  value={editorTab}
                  onChange={setEditorTab}
                  saved={Boolean(selectedPiece)}
                  isMovement={Boolean(piece.parentId)}
                  movementCount={childCount}
                />
                <div className="music-editor-content" ref={editorBodyRef} tabIndex={-1}>
                  <TabsContent
                    aria-labelledby="music-piece-movements-tab"
                    id="music-piece-movements"
                    value="movements"
                  >
                    <MusicMovementList
                      busy={busy}
                      movements={movements}
                      onAdd={() => {
                        beginNew(editingId);
                      }}
                      onOpen={openMovement}
                      onReorder={(movementOrder) => {
                        setPiece((current) => ({ ...current, movementOrder }));
                      }}
                    />
                  </TabsContent>
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
                              {formatParentWorkOption(parent, topLevelPieces)}
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
                    aria-labelledby="music-piece-scores-tab"
                    id="music-piece-scores"
                    value="scores"
                  >
                    {selectedPiece ? (
                      <MusicDigitalScores
                        configuration={roster}
                        key={selectedPiece.id}
                        onSaved={(saved, successMessage) => {
                          setPieces((current) =>
                            current.map((candidate) =>
                              candidate.id === saved.id ? saved : candidate,
                            ),
                          );
                          setEditorPiece(saved, "scores");
                          setMessage(successMessage);
                        }}
                        parentPiece={
                          selectedPiece.parentId
                            ? (pieces.find(
                                (candidate) => candidate.id === selectedPiece.parentId,
                              ) ?? null)
                            : null
                        }
                        piece={selectedPiece}
                      />
                    ) : (
                      <p className="notice">Save the piece first, then add digital scores.</p>
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
                </div>
              </Tabs>
              <MusicDeleteControls
                canAddMovement={!piece.parentId && editorTab !== "movements"}
                saveLabel={
                  parentEditorTitle
                    ? "Save and return"
                    : editorTab === "movements"
                      ? "Save order"
                      : "Save music piece"
                }
                busy={busy}
                childCount={childCount}
                deleteConfirm={deleteConfirm}
                editingId={editingId}
                unlinkChildren={unlinkChildren}
                onAddMovement={() => {
                  beginNew(editingId);
                }}
                onAddToSetList={() => {
                  if (selectedPiece) {
                    const pieceForSetList = piece.title.trim()
                      ? { ...selectedPiece, title: piece.title.trim() }
                      : selectedPiece;
                    setSetListTargetPieces([pieceForSetList]);
                    setSetListError(null);
                    setSetListDialogOpen(true);
                  }
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
          {confirmationDialog}
          <MusicBulkEditDialog
            availableGenres={availableGenres}
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
            key={bulkDialogOpen ? "bulk-open" : "bulk-closed"}
          />
          <AddToSetListDialog
            busy={busy}
            error={setListError}
            events={events}
            onApply={(payload) => {
              void addSelectedPiecesToSetList(payload, setListTargetPieces ?? undefined);
            }}
            onClose={() => {
              setSetListDialogOpen(false);
              setSetListTargetPieces(null);
              setSetListError(null);
            }}
            open={setListDialogOpen}
            selectedPieces={setListTargetPieces ?? selectedPieces}
            timezone={timezone}
            venues={venues}
            key={setListDialogOpen ? "setlist-open" : "setlist-closed"}
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
          <BulkPracticeTrackImportDialog
            onOpenPiece={(pieceId) => {
              void openImportedPiece(pieceId);
            }}
            events={events}
            onClose={() => {
              setBulkTrackImportOpen(false);
            }}
            onTracksAttached={() => {
              void (async () => {
                try {
                  const updated = await listOrganizationMusic();
                  setPieces(updated);
                } catch {
                  // Keep current pieces if reload fails
                }
              })();
            }}
            open={bulkTrackImportOpen}
            pieces={pieces}
            roster={roster}
            key={bulkTrackImportOpen ? "bulk-track-open" : "bulk-track-closed"}
          />
        </div>
      )}
    </section>
  );
}
