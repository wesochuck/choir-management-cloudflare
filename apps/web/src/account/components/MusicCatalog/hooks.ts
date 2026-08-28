import { useCallback, useEffect, useRef, useState } from "react";
import type { OrganizationMusicPiece } from "@choir/contracts";
import { useMusicBulk } from "./hooks/useMusicBulk";
import { useMusicData } from "./hooks/useMusicData";
import { useMusicDerived } from "./hooks/useMusicDerived";
import { useMusicEditor } from "./hooks/useMusicEditor";
import { useMusicFilters } from "./hooks/useMusicFilters";
import { useMusicImport } from "./hooks/useMusicImport";
export function useMusicCatalogController({
  enabled,
  initialPieceId,
}: {
  readonly enabled: boolean;
  readonly initialPieceId?: string | null | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const data = useMusicData({ enabled, setError });
  const filters = useMusicFilters();
  const editor = useMusicEditor({
    busy,
    pieces: data.pieces,
    roster: data.roster,
    setBusy,
    setError,
    setMessage,
    setPieces: data.setPieces,
  });
  const derived = useMusicDerived({
    editingId: editor.editingId,
    piece: editor.piece,
    pieces: data.pieces,
    selectedPieceIds: filters.selectedPieceIds,
  });
  const bulk = useMusicBulk({
    busy,
    events: data.events,
    pieces: data.pieces,
    selectedPieces: derived.selectedPieces,
    selectedPieceIds: filters.selectedPieceIds,
    setBusy,
    setError,
    setEvents: data.setEvents,
    setMessage,
    setPieces: data.setPieces,
    setSelectedPieceIds: filters.setSelectedPieceIds,
    timezone: data.timezone,
  });
  const importer = useMusicImport({
    busy,
    setBusy,
    setError,
    setMessage,
    setPieces: data.setPieces,
  });
  const openedInitialPieceIdRef = useRef<string | null>(null);
  const selectPiece = useCallback(
    (selected: OrganizationMusicPiece): void => {
      editor.setEditorPiece(selected);
      editor.setDialogOpen(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editor.set* stable, editor object unstable
    [editor.setDialogOpen, editor.setEditorPiece],
  );
  useEffect(() => {
    if (!enabled || !initialPieceId || openedInitialPieceIdRef.current === initialPieceId) return;
    const initialPiece = data.pieces.find(({ id }) => id === initialPieceId);
    if (!initialPiece) return;
    openedInitialPieceIdRef.current = initialPieceId;
    const timeoutId = window.setTimeout(() => {
      selectPiece(initialPiece);
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [data.pieces, enabled, initialPieceId, selectPiece]);
  return {
    addSelectedPiecesToSetList: bulk.addSelectedPiecesToSetList,
    applyBulkChanges: bulk.applyBulkChanges,
    applyBulkDelete: bulk.applyBulkDelete,
    availableGenres: derived.availableGenres,
    beginNew: editor.beginNew,
    bulkDialogOpen: bulk.bulkDialogOpen,
    bulkError: bulk.bulkError,
    busy,
    childCount: derived.childCount,
    closeBulkDialog: bulk.closeBulkDialog,
    closeDialog: editor.closeDialog,
    closeImportDialog: importer.closeImportDialog,
    copiesInput: editor.copiesInput,
    deleteConfirm: editor.deleteConfirm,
    dialogOpen: editor.dialogOpen,
    durationAutoFillLabel: editor.durationAutoFillLabel,
    durationDetectionNotice: editor.durationDetectionNotice,
    durationInput: editor.durationInput,
    durationMismatch: editor.durationMismatch,
    editingId: editor.editingId,
    editorTab: editor.editorTab,
    error,
    events: data.events,
    genreCounts: derived.genreCounts,
    genreFilterMode: filters.genreFilterMode,
    uncategorizedCount: derived.uncategorizedCount,
    genreFilterSearch: filters.genreFilterSearch,
    genresInput: editor.genresInput,
    setShowUncategorized: filters.setShowUncategorized,
    showUncategorized: filters.showUncategorized,
    toggleUncategorized: filters.toggleUncategorized,
    handleMusicColumnMap: importer.handleMusicColumnMap,
    handleMusicImportFile: importer.handleMusicImportFile,
    handlePendingTuttiFileChange: editor.handlePendingTuttiFileChange,
    handlePerformanceChanged: bulk.handlePerformanceChanged,
    handleTrackDurationDetected: editor.handleTrackDurationDetected,
    downloadImportErrors: importer.downloadImportErrors,
    importCsv: importer.importCsv,
    importDialogOpen: importer.importDialogOpen,
    importFile: importer.importFile,
    lastImportErrors: importer.lastImportErrors,
    message,
    musicImportConfirmed: importer.musicImportConfirmed,
    musicImportHeaders: importer.musicImportHeaders,
    musicImportInspecting: importer.musicImportInspecting,
    musicImportInspection: importer.musicImportInspection,
    musicImportMappings: importer.musicImportMappings,
    pendingTuttiFile: editor.pendingTuttiFile,
    personNameOptions: derived.personNameOptions,
    piece: editor.piece,
    pieces: data.pieces,
    publisherSearchTemplate: data.publisherSearchTemplate,
    renameCredit: bulk.renameCredit,
    remove: editor.remove,
    roster: data.roster,
    save: editor.save,
    search: filters.search,
    selectManyPieces: filters.selectManyPieces,
    selectPiece,
    selectedGenres: filters.selectedGenres,
    selectedPiece: derived.selectedPiece,
    selectedPieceIds: filters.selectedPieceIds,
    selectedPieces: derived.selectedPieces,
    setBulkDialogOpen: bulk.setBulkDialogOpen,
    setBulkError: bulk.setBulkError,
    setCopiesInput: editor.setCopiesInput,
    setDeleteConfirm: editor.setDeleteConfirm,
    setDurationValue: editor.setDurationValue,
    setEditorPiece: editor.setEditorPiece,
    setEditorTab: editor.setEditorTab,
    setError,
    setGenreFilterMode: filters.setGenreFilterMode,
    setGenreFilterSearch: filters.setGenreFilterSearch,
    setGenresInput: editor.setGenresInput,
    setImportDialogOpen: importer.setImportDialogOpen,
    setListDialogOpen: bulk.setListDialogOpen,
    setListError: bulk.setListError,
    setMessage,
    setMusicImportConfirmed: importer.setMusicImportConfirmed,
    setPiece: editor.setPiece,
    setPieces: data.setPieces,
    setSearch: filters.setSearch,
    setSetListDialogOpen: bulk.setSetListDialogOpen,
    setSetListError: bulk.setSetListError,
    setUnlinkChildren: editor.setUnlinkChildren,
    timezone: data.timezone,
    toggleGenre: filters.toggleGenre,
    togglePieceSelection: filters.togglePieceSelection,
    topLevelPieces: derived.topLevelPieces,
    unlinkChildren: editor.unlinkChildren,
    venues: data.venues,
  };
}
export type MusicCatalogModel = ReturnType<typeof useMusicCatalogController>;
