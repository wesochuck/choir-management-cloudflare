import type {
  OrganizationMusicPiece,
  OrganizationMusicPieceRequest,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  AuthApiError,
  createOrganizationMusicPiece,
  deleteOrganizationMusicPiece,
  deletePrivateOrganizationFile,
  updateOrganizationMusicPiece,
  uploadPrivateOrganizationFile,
} from "../../../../auth/api";
import { extractAudioDuration, extractAudioDurationFromUrl } from "../../../audioDuration";
import {
  computeDurationAutoFillDecision,
  computeExpectedTrackDuration,
  formatDetectedDuration,
  initialDurationAutoFillState,
  type DurationAutoFillState,
} from "../../../durationAutoFill";
import { learningTrackFileName } from "../../../learningTrackFilename";
import {
  durationText,
  emptyPiece,
  normalizeDurationInput,
  parseDuration,
  requestFrom,
  uniqueLabels,
  type MusicEditorTab,
} from "../utils";
export function useMusicEditor({
  busy,
  pieces,
  roster,
  setBusy,
  setError,
  setMessage,
  setPieces,
}: {
  readonly busy: boolean;
  readonly pieces: readonly OrganizationMusicPiece[];
  readonly roster: OrganizationRosterConfiguration | null;
  readonly setBusy: (value: boolean) => void;
  readonly setError: (value: string | null) => void;
  readonly setMessage: (value: string | null) => void;
  readonly setPieces: Dispatch<SetStateAction<readonly OrganizationMusicPiece[]>>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  void pieces;
  const [piece, setPiece] = useState<OrganizationMusicPieceRequest>(emptyPiece);
  const [pendingTuttiFile, setPendingTuttiFile] = useState<File | null>(null);
  const [durationInput, setDurationInput] = useState("");
  const [durationAutoFillLabel, setDurationAutoFillLabel] = useState<string | null>(null);
  const [durationDetectionNotice, setDurationDetectionNotice] = useState<string | null>(null);
  const [trackDurationCache, setTrackDurationCache] = useState<Record<string, number | null>>({});
  const [genresInput, setGenresInput] = useState("");
  const [copiesInput, setCopiesInput] = useState("");
  const [editorTab, setEditorTab] = useState<MusicEditorTab>("details");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [unlinkChildren, setUnlinkChildren] = useState(false);
  const durationAutoFillStateRef = useRef<DurationAutoFillState>(initialDurationAutoFillState);
  const durationInputRef = useRef("");
  const durationDetectionRequestRef = useRef(0);
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
      for (const [trackKey, durationSeconds] of durations)
        handleTrackDurationDetected(trackKey, durationSeconds);
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
    [resetDurationDetection, setDurationValue, setError, setMessage],
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
  return {
    beginNew,
    closeDialog,
    copiesInput,
    deleteConfirm,
    dialogOpen,
    durationAutoFillLabel,
    durationDetectionNotice,
    durationInput,
    durationMismatch,
    editingId,
    editorTab,
    genresInput,
    handlePendingTuttiFileChange,
    handleTrackDurationDetected,
    pendingTuttiFile,
    piece,
    remove,
    save,
    setCopiesInput,
    setDeleteConfirm,
    setDialogOpen,
    setDurationValue,
    setEditingId,
    setEditorPiece,
    setEditorTab,
    setGenresInput,
    setPiece,
    setUnlinkChildren,
    unlinkChildren,
  };
}
