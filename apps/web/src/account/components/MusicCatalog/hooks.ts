import type {
  OrganizationEvent,
  OrganizationMusicBulkUpdateRequest,
  OrganizationMusicPiece,
  OrganizationMusicPieceRequest,
  OrganizationRosterConfiguration,
  OrganizationVenue,
} from "@choir/contracts";
import {
  inspectMusicCsv,
  mapMusicCsvColumns,
  musicCsvColumnForHeader,
  type CsvColumnMapping,
  type MusicCsvInspection,
} from "@choir/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  durationText,
  emptyPiece,
  genreKey,
  normalizeDurationInput,
  parseDuration,
  requestFrom,
  uniqueGenreLabels,
  uniqueLabels,
  type MusicEditorTab,
} from "./utils";
import {
  AuthApiError,
  bulkUpdateOrganizationMusicPieces,
  createOrganizationMusicPiece,
  deleteOrganizationMusicPiece,
  deletePrivateOrganizationFile,
  getOrganizationCalendarSettings,
  getOrganizationMusicLibrarySettings,
  getOrganizationRosterConfiguration,
  importOrganizationMusicCsv,
  listOrganizationMusic,
  listOrganizationEvents,
  listOrganizationVenues,
  renameOrganizationMusicCredit,
  uploadPrivateOrganizationFile,
  updateOrganizationMusicPiece,
} from "../../../auth/api";
import { learningTrackFileName } from "../../learningTrackFilename";
import { extractAudioDuration, extractAudioDurationFromUrl } from "../../audioDuration";
import {
  computeDurationAutoFillDecision,
  computeExpectedTrackDuration,
  formatDetectedDuration,
  initialDurationAutoFillState,
  type DurationAutoFillState,
} from "../../durationAutoFill";

export function useMusicCatalogController({
  enabled,
  initialPieceId,
}: {
  readonly enabled: boolean;
  readonly initialPieceId?: string | null | undefined;
}) {
  const [pieces, setPieces] = useState<readonly OrganizationMusicPiece[]>([]);
  const [roster, setRoster] = useState<OrganizationRosterConfiguration | null>(null);
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [venues, setVenues] = useState<readonly OrganizationVenue[]>([]);
  const [timezone, setTimezone] = useState("UTC");
  const [publisherSearchTemplate, setPublisherSearchTemplate] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [piece, setPiece] = useState<OrganizationMusicPieceRequest>(emptyPiece);
  const [pendingTuttiFile, setPendingTuttiFile] = useState<File | null>(null);
  const [durationInput, setDurationInput] = useState("");
  const [durationAutoFillLabel, setDurationAutoFillLabel] = useState<string | null>(null);
  const [durationDetectionNotice, setDurationDetectionNotice] = useState<string | null>(null);
  const [trackDurationCache, setTrackDurationCache] = useState<Record<string, number | null>>({});
  const [genresInput, setGenresInput] = useState("");
  const [copiesInput, setCopiesInput] = useState("");
  const [search, setSearch] = useState("");
  const [genreFilterSearch, setGenreFilterSearch] = useState("");
  const [genreFilterMode, setGenreFilterMode] = useState<"and" | "or">("or");
  const [selectedGenres, setSelectedGenres] = useState<readonly string[]>([]);
  const [selectedPieceIds, setSelectedPieceIds] = useState<readonly string[]>([]);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [unlinkChildren, setUnlinkChildren] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [musicImportCsv, setMusicImportCsv] = useState("");
  const [musicImportHeaders, setMusicImportHeaders] = useState<readonly string[]>([]);
  const [musicImportMappings, setMusicImportMappings] = useState<readonly CsvColumnMapping[]>([]);
  const [musicImportInspection, setMusicImportInspection] = useState<MusicCsvInspection | null>(
    null,
  );
  const [musicImportConfirmed, setMusicImportConfirmed] = useState(false);
  const [musicImportInspecting, setMusicImportInspecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<MusicEditorTab>("details");
  const openedInitialPieceIdRef = useRef<string | null>(null);
  const durationAutoFillStateRef = useRef<DurationAutoFillState>(initialDurationAutoFillState);
  const durationInputRef = useRef("");
  const durationDetectionRequestRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationMusic(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
      listOrganizationEvents(controller.signal),
      listOrganizationVenues(controller.signal),
      getOrganizationCalendarSettings(controller.signal),
      getOrganizationMusicLibrarySettings(controller.signal),
    ])
      .then(([catalog, configuration, nextEvents, nextVenues, calendarSettings, musicSettings]) => {
        setPieces(catalog);
        setRoster(configuration);
        setEvents(nextEvents);
        setVenues(nextVenues);
        setTimezone(calendarSettings.timezone);
        setPublisherSearchTemplate(musicSettings.publisherSearchTemplate);
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError("The music catalog could not be loaded.");
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  const topLevelPieces = useMemo(
    () => pieces.filter(({ id, parentId }) => !parentId && id !== editingId),
    [editingId, pieces],
  );
  const childCount = editingId ? pieces.filter(({ parentId }) => parentId === editingId).length : 0;
  const selectedPiece = pieces.find(({ id }) => id === editingId) ?? null;
  const availableGenres = useMemo(
    () =>
      uniqueGenreLabels(pieces.flatMap(({ genres }) => genres)).sort((a, b) => a.localeCompare(b)),
    [pieces],
  );
  const genreCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const musicPiece of pieces) {
      for (const genre of uniqueGenreLabels(musicPiece.genres)) {
        const key = genreKey(genre);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [pieces]);
  const personNameOptions = useMemo(
    () =>
      [
        ...new Set(
          [
            ...pieces.flatMap(({ arranger, composer }) => [arranger.trim(), composer.trim()]),
            piece.composer.trim(),
            piece.arranger.trim(),
          ].filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [piece.arranger, piece.composer, pieces],
  );
  const selectedPieces = useMemo(
    () => pieces.filter(({ id }) => selectedPieceIds.includes(id)),
    [pieces, selectedPieceIds],
  );

  function toggleGenre(genre: string): void {
    setSelectedGenres((current) =>
      current.some((item) => genreKey(item) === genreKey(genre))
        ? current.filter((item) => genreKey(item) !== genreKey(genre))
        : [...current, genre],
    );
  }

  function togglePieceSelection(pieceId: string): void {
    setSelectedPieceIds((current) =>
      current.includes(pieceId) ? current.filter((id) => id !== pieceId) : [...current, pieceId],
    );
  }

  function selectManyPieces(pieceIds: readonly string[]): void {
    if (pieceIds.length === 0) {
      setSelectedPieceIds([]);
      return;
    }
    setSelectedPieceIds((current) => [...new Set([...current, ...pieceIds])]);
  }

  const resetDurationDetection = useCallback((): void => {
    durationAutoFillStateRef.current = initialDurationAutoFillState;
    durationInputRef.current = "";
    durationDetectionRequestRef.current += 1;
    setDurationAutoFillLabel(null);
    setDurationDetectionNotice(null);
    setTrackDurationCache({});
  }, []);

  const setDurationValue = useCallback((value: string, manuallyEdited: boolean): void => {
    durationInputRef.current = value;
    setDurationInput(value);
    if (manuallyEdited) {
      durationAutoFillStateRef.current = {
        ...durationAutoFillStateRef.current,
        manuallyEdited: true,
      };
      setDurationAutoFillLabel(null);
      setDurationDetectionNotice(null);
    }
  }, []);

  const handleTrackDurationDetected = useCallback(
    (trackKey: string, durationSeconds: number | null): void => {
      setTrackDurationCache((current) => ({ ...current, [trackKey]: durationSeconds }));
      if (durationSeconds === null) return;
      setDurationDetectionNotice(null);
      const decision = computeDurationAutoFillDecision(
        durationAutoFillStateRef.current,
        durationInputRef.current,
        trackKey,
        durationSeconds,
      );
      if (!decision) return;
      durationAutoFillStateRef.current = decision.newState;
      durationInputRef.current = decision.newDuration;
      setDurationInput(decision.newDuration);
      setDurationAutoFillLabel(trackKey === "tutti" ? "Tutti" : trackKey);
    },
    [],
  );

  const handlePendingTuttiFileChange = useCallback(
    (file: File | null): void => {
      setPendingTuttiFile(file);
      const requestId = ++durationDetectionRequestRef.current;
      setDurationDetectionNotice(file ? "Reading track duration…" : null);
      if (!file) return;
      void extractAudioDuration(file).then((durationSeconds) => {
        if (requestId !== durationDetectionRequestRef.current) return;
        if (durationSeconds === null) {
          setDurationDetectionNotice(
            "The track duration could not be read automatically. Enter it manually.",
          );
          return;
        }
        handleTrackDurationDetected("tutti", durationSeconds);
      });
    },
    [handleTrackDurationDetected],
  );

  useEffect(() => {
    if (!dialogOpen || !editingId) return;
    const entries = Object.entries(piece.trackFileIds).filter(
      (entry): entry is [string, string] => entry[1].length > 0,
    );
    const requestId = ++durationDetectionRequestRef.current;
    if (entries.length === 0) return;
    let cancelled = false;
    void Promise.all(
      entries.map(async ([trackKey, fileId]) => {
        const durationSeconds = await extractAudioDurationFromUrl(
          `/api/organization/files/${encodeURIComponent(fileId)}`,
        );
        return [trackKey, durationSeconds] as const;
      }),
    ).then((durations) => {
      if (cancelled || requestId !== durationDetectionRequestRef.current) return;
      for (const [trackKey, durationSeconds] of durations) {
        handleTrackDurationDetected(trackKey, durationSeconds);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dialogOpen, editingId, handleTrackDurationDetected, piece.trackFileIds]);

  const expectedTrackDuration = useMemo(
    () => computeExpectedTrackDuration(trackDurationCache),
    [trackDurationCache],
  );
  const durationMismatch = useMemo(() => {
    if (expectedTrackDuration === null) return null;
    const currentSeconds = parseDuration(durationInput);
    if (currentSeconds === expectedTrackDuration) return null;
    return {
      current: durationInput.trim(),
      suggested: formatDetectedDuration(expectedTrackDuration),
    };
  }, [durationInput, expectedTrackDuration]);

  const setEditorPiece = useCallback(
    (selected: OrganizationMusicPiece, nextTab: MusicEditorTab = "details"): void => {
      setEditingId(selected.id);
      setPiece(requestFrom(selected));
      setPendingTuttiFile(null);
      setEditorTab(nextTab);
      resetDurationDetection();
      setDurationValue(durationText(selected.durationSeconds), false);
      setGenresInput(selected.genres.join(", "));
      setCopiesInput(selected.copies === null ? "" : String(selected.copies));
      setDeleteConfirm(false);
      setUnlinkChildren(false);
      setMessage(null);
      setError(null);
    },
    [resetDurationDetection, setDurationValue],
  );

  function closeDialog(): void {
    if (busy) return;
    setDialogOpen(false);
    setEditingId(null);
    setPiece(emptyPiece);
    setPendingTuttiFile(null);
    resetDurationDetection();
    setGenresInput("");
    setCopiesInput("");
    setDeleteConfirm(false);
    setUnlinkChildren(false);
    setError(null);
    setEditorTab("details");
  }

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

  function closeBulkDialog(): void {
    if (busy) return;
    setBulkDialogOpen(false);
    setBulkError(null);
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

  const selectPiece = useCallback(
    (selected: OrganizationMusicPiece): void => {
      setEditorPiece(selected);
      setDialogOpen(true);
    },
    [setEditorPiece],
  );

  useEffect(() => {
    if (!enabled || !initialPieceId || openedInitialPieceIdRef.current === initialPieceId) return;
    const initialPiece = pieces.find(({ id }) => id === initialPieceId);
    if (!initialPiece) return;
    openedInitialPieceIdRef.current = initialPieceId;
    const timeoutId = window.setTimeout(() => {
      selectPiece(initialPiece);
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [enabled, initialPieceId, pieces, selectPiece]);

  async function handlePerformanceChanged(event: OrganizationEvent): Promise<void> {
    setEvents((current) => {
      const exists = current.some((candidate) => candidate.id === event.id);
      return exists
        ? current.map((candidate) => (candidate.id === event.id ? event : candidate))
        : [...current, event].toSorted((left, right) =>
            left.startsAt.localeCompare(right.startsAt),
          );
    });
    try {
      setPieces(await listOrganizationMusic());
    } catch {
      // The event link is already saved; a later catalog refresh can recalculate its summary.
    }
  }

  function beginNew(parentId: string | null = null): void {
    setEditingId(null);
    setPiece({ ...emptyPiece, parentId });
    setPendingTuttiFile(null);
    resetDurationDetection();
    setGenresInput("");
    setCopiesInput("");
    setEditorTab("details");
    setDeleteConfirm(false);
    setMessage(null);
    setError(null);
    setDialogOpen(true);
  }

  function commitDurationInput(value: string): string {
    const normalized = normalizeDurationInput(value);
    if (normalized !== value) setDurationValue(normalized, true);
    return normalized;
  }

  async function save(): Promise<void> {
    const currentRoster = roster;
    if (!currentRoster) {
      setError("Roster configuration is still loading.");
      return;
    }
    const durationSeconds = parseDuration(commitDurationInput(durationInput));
    const copies = copiesInput.trim() ? Number(copiesInput) : null;
    if (durationSeconds === undefined) {
      setError("Duration must be a time such as 4:05 or a whole number of minutes such as 4.");
      return;
    }
    if (copies !== null && (!Number.isInteger(copies) || copies < 0 || copies > 1_000_000)) {
      setError("Copies must be a whole number from 0 through 1,000,000.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    let uploadedTuttiFileId: string | null = null;
    try {
      const request: OrganizationMusicPieceRequest = {
        ...piece,
        copies,
        durationSeconds,
        genres: uniqueLabels(genresInput),
      };
      if (!editingId && pendingTuttiFile) {
        const uploaded = await uploadPrivateOrganizationFile(
          pendingTuttiFile,
          learningTrackFileName(piece.title, "tutti", currentRoster),
        );
        uploadedTuttiFileId = uploaded.id;
        request.trackFileIds = { ...request.trackFileIds, tutti: uploaded.id };
      }
      const saved = editingId
        ? await updateOrganizationMusicPiece(editingId, request)
        : await createOrganizationMusicPiece(request);
      setPieces((current) =>
        editingId
          ? current.map((candidate) => (candidate.id === saved.id ? saved : candidate))
          : [...current, saved].sort((a, b) => a.title.localeCompare(b.title)),
      );
      setEditorPiece(saved);
      setMessage("Music piece saved.");
      setDialogOpen(false);
      setEditingId(null);
      setPiece(emptyPiece);
      setPendingTuttiFile(null);
      resetDurationDetection();
    } catch (caught: unknown) {
      let nextError =
        caught instanceof AuthApiError ? caught.message : "The music piece could not be saved.";
      if (uploadedTuttiFileId) {
        try {
          await deletePrivateOrganizationFile(uploadedTuttiFileId);
        } catch {
          nextError += " The temporary Tutti track could not be reclaimed automatically.";
        }
      }
      setError(nextError);
    } finally {
      setBusy(false);
    }
  }

  async function applyBulkChanges(
    changes: OrganizationMusicBulkUpdateRequest["changes"],
  ): Promise<void> {
    if (selectedPieces.length === 0) return;
    setBusy(true);
    setBulkError(null);
    setError(null);
    setMessage(null);
    try {
      const updated = await bulkUpdateOrganizationMusicPieces({
        changes,
        pieceIds: selectedPieces.map(({ id }) => id),
      });
      const updatedById = new Map(updated.map((candidate) => [candidate.id, candidate]));
      setPieces((current) =>
        current.map((candidate) => updatedById.get(candidate.id) ?? candidate),
      );
      setSelectedPieceIds([]);
      setBulkDialogOpen(false);
      setMessage(`${String(updated.length)} music piece(s) updated.`);
    } catch (caught: unknown) {
      setBulkError(
        caught instanceof AuthApiError ? caught.message : "The music pieces could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function renameCredit(currentName: string, newName: string): Promise<number> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await renameOrganizationMusicCredit({ currentName, newName });
      const updatedById = new Map(updated.map((candidate) => [candidate.id, candidate]));
      setPieces((current) =>
        current.map((candidate) => updatedById.get(candidate.id) ?? candidate),
      );
      setMessage(
        `Renamed ${currentName} to ${newName} across ${String(updated.length)} distinct music piece${updated.length === 1 ? "" : "s"}.`,
      );
      return updated.length;
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganizationMusicPiece(editingId, unlinkChildren);
      setPieces((current) =>
        current
          .filter(({ id }) => id !== editingId)
          .map((candidate) =>
            candidate.parentId === editingId ? { ...candidate, parentId: null } : candidate,
          ),
      );
      setDialogOpen(false);
      setEditingId(null);
      setPiece(emptyPiece);
      resetDurationDetection();
      setGenresInput("");
      setCopiesInput("");
      setDeleteConfirm(false);
      setUnlinkChildren(false);
      setMessage("Music piece deleted.");
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The music piece could not be deleted. It may still be referenced.",
      );
      setDeleteConfirm(false);
    } finally {
      setBusy(false);
    }
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
    genreFilterMode,
    genreCounts,
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
  };
}

export type MusicCatalogModel = ReturnType<typeof useMusicCatalogController>;
