import type { OrganizationMusicPiece } from "@choir/contracts";
import {
  calculateSetListTiming,
  hasSetListPiece,
  normalizeSetListDuration,
  parseSetListDuration,
} from "@choir/domain";
import {
  durationFromSeconds,
  effectiveSetListItemDurationSeconds,
  emptyResources,
  eventRequestFrom,
  moveItemToIndex,
  normalizeItems,
  setListItemEditError,
  setListItemForEdit,
  setListDocumentText,
} from "./utils";
import type { Resources, SetListItem } from "./types";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AuthApiError,
  generatePublicPlayerToken,
  listOrganizationEvents,
  listOrganizationMusic,
  listOrganizationProfiles,
  listOrganizationVenues,
  rotatePublicPlayerToken,
  updateOrganizationEvent,
} from "../../../auth/api";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";

export function useSetListManagerController({
  enabled,
  initialEventId = null,
}: {
  readonly enabled: boolean;
  readonly initialEventId?: string | null | undefined;
}) {
  const { performerLabelPlural } = useOrganizationTerminology();
  const [resources, setResources] = useState<Resources>(emptyResources);
  const [loaded, setLoaded] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [copyEventId, setCopyEventId] = useState("");
  const [items, setItems] = useState<SetListItem[]>([]);
  const [approved, setApproved] = useState(false);
  const [defaultTransitionSeconds, setDefaultTransitionSeconds] = useState(0);
  const [customType, setCustomType] = useState<"intermission" | "song">("song");
  const [customTitle, setCustomTitle] = useState("");
  const [customComposer, setCustomComposer] = useState("");
  const [customDuration, setCustomDuration] = useState("");
  const [customNotes, setCustomNotes] = useState("");
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<SetListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [playerBusy, setPlayerBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [musicQuery, setMusicQuery] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const draftRevisionRef = useRef(0);
  const lastSaveRevisionRef = useRef(-1);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationEvents(controller.signal),
      listOrganizationMusic(controller.signal),
      listOrganizationProfiles(controller.signal),
      listOrganizationVenues(controller.signal),
    ])
      .then(([events, music, profiles, venues]) => {
        setResources({ events, music, profiles, venues });
        const requestedEventId =
          initialEventId ?? new URLSearchParams(window.location.search).get("eventId");
        const selectedPerformance =
          events.find(({ id, type }) => type === "Performance" && id === requestedEventId) ??
          events.find(({ type }) => type === "Performance");
        setSelectedEventId(selectedPerformance?.id ?? "");
        setItems(normalizeItems(selectedPerformance?.setList ?? []));
        setApproved(selectedPerformance?.setListApproved ?? false);
        setDefaultTransitionSeconds(selectedPerformance?.setListDefaultTransitionSeconds ?? 0);
        setDirty(false);
        setLoaded(true);
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError("Set-list resources could not be loaded.");
          setLoaded(true);
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled, initialEventId]);

  const performances = useMemo(
    () =>
      resources.events
        .filter(({ type }) => type === "Performance")
        .toSorted((left, right) => left.startsAt.localeCompare(right.startsAt)),
    [resources.events],
  );
  const selectedEvent = performances.find(({ id }) => id === selectedEventId) ?? null;
  const selectedEventIdForAutosave = selectedEvent?.id ?? null;

  const timing = useMemo(
    () =>
      calculateSetListTiming(items, defaultTransitionSeconds, (item) =>
        effectiveSetListItemDurationSeconds(item, resources.music),
      ),
    [items, defaultTransitionSeconds, resources.music],
  );
  const {
    songsDuration,
    intermissionsDuration,
    defaultTransitionCount,
    defaultTransitionDuration,
    estimatedRuntime,
    missingDurationCustomCount,
  } = timing;
  const totalDuration = estimatedRuntime;

  const filteredMusic = useMemo(() => {
    const query = musicQuery.trim().toLocaleLowerCase();
    if (!query) return resources.music;
    return resources.music.filter(({ composer, title }) =>
      `${title} ${composer}`.toLocaleLowerCase().includes(query),
    );
  }, [musicQuery, resources.music]);

  function updateDraftItems(updater: (current: SetListItem[]) => SetListItem[]): void {
    setItems(updater);
    draftRevisionRef.current += 1;
    setDirty(true);
  }

  function markDraftDirty(): void {
    draftRevisionRef.current += 1;
    setDirty(true);
  }

  function updateItem(index: number, updated: SetListItem): void {
    updateDraftItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? updated : item)),
    );
  }

  function addMusicPiece(piece: OrganizationMusicPiece): void {
    if (hasSetListPiece(items, piece.id)) {
      setError("That music piece is already in this set list.");
      return;
    }
    updateDraftItems((current) => [
      ...current,
      {
        composer: piece.composer || undefined,
        duration: durationFromSeconds(piece.durationSeconds),
        id: crypto.randomUUID(),
        pieceId: piece.id,
        title: piece.title,
        type: "song",
      },
    ]);
    setMusicQuery("");
    setError(null);
  }

  function addCustomItem(): void {
    if (!customTitle.trim()) {
      setError("Enter a title for the set-list item.");
      return;
    }
    if (customDuration.trim() && parseSetListDuration(customDuration) === null) {
      setError("Duration must be minutes, minutes:seconds, hours:minutes:seconds, or named units.");
      return;
    }
    updateDraftItems((current) => [
      ...current,
      {
        composer: customType === "song" ? customComposer.trim() || undefined : undefined,
        duration: normalizeSetListDuration(customDuration),
        id: crypto.randomUUID(),
        notes: customNotes.trim() || undefined,
        title: customTitle.trim(),
        type: customType,
      },
    ]);
    setCustomTitle("");
    setCustomComposer("");
    setCustomDuration("");
    setCustomNotes("");
    setError(null);
    setCustomDialogOpen(false);
  }

  function openCustomItem(title = "", duration = "", type: "intermission" | "song" = "song"): void {
    setCustomType(type);
    setCustomTitle(type === "intermission" && !title.trim() ? "Intermission" : title);
    setCustomComposer("");
    setCustomDuration(duration);
    setCustomNotes("");
    setError(null);
    setCustomDialogOpen(true);
  }

  function insertCustomItem(index: number): void {
    const item: SetListItem = {
      id: crypto.randomUUID(),
      title: "Intermission",
      type: "intermission",
    };
    updateDraftItems((current) => [...current.slice(0, index), item, ...current.slice(index)]);
    setEditingItemIndex(index);
    setEditingItem(item);
    setError(null);
  }

  function openItemEditor(index: number): void {
    const item = items[index];
    if (!item) return;
    setEditingItemIndex(index);
    setEditingItem({ ...item });
    setError(null);
  }

  function closeItemEditor(): void {
    setEditingItemIndex(null);
    setEditingItem(null);
  }

  function saveItemEdit(): void {
    if (editingItemIndex === null || !editingItem) return;
    const validationError = setListItemEditError(editingItem, resources.music);
    if (validationError) {
      setError(validationError);
      return;
    }
    updateItem(editingItemIndex, setListItemForEdit(editingItem, resources.music));
    closeItemEditor();
    setError(null);
  }

  function copyMissingItems(): void {
    const source = performances.find(({ id }) => id === copyEventId);
    if (!source) return;
    let copied = 0;
    const additions = source.setList.flatMap((sourceItem) => {
      if (sourceItem.pieceId && hasSetListPiece(items, sourceItem.pieceId)) return [];
      copied += 1;
      return [{ ...sourceItem, id: crypto.randomUUID() }];
    });
    updateDraftItems((current) => [...current, ...additions]);
    setMessage(`${String(copied)} item(s) copied; linked duplicates were skipped.`);
    setCopyEventId("");
  }

  async function save(): Promise<void> {
    if (!selectedEvent || busy) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (items.some((item) => item.duration && parseSetListDuration(item.duration) === null)) {
      setError("Correct invalid item durations before saving.");
      return;
    }
    const eventId = selectedEvent.id;
    const saveRevision = draftRevisionRef.current;
    const request = eventRequestFrom(selectedEvent, items, approved, defaultTransitionSeconds);
    lastSaveRevisionRef.current = saveRevision;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await updateOrganizationEvent(eventId, request);
      setResources((current) => ({
        ...current,
        events: current.events.map((event) => (event.id === saved.id ? saved : event)),
      }));
      if (draftRevisionRef.current === saveRevision && selectedEventId === eventId) {
        setItems(normalizeItems(saved.setList));
        setApproved(saved.setListApproved);
        setDefaultTransitionSeconds(saved.setListDefaultTransitionSeconds);
        setDirty(false);
        setMessage("Set list saved.");
      } else {
        setDirty(true);
        setMessage("Set list saved; newer edits remain unsaved.");
      }
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError ? caught.message : "The set list could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (
      !dirty ||
      busy ||
      selectedEventIdForAutosave === null ||
      draftRevisionRef.current === lastSaveRevisionRef.current
    )
      return;
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveRef.current();
    }, 900);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [busy, dirty, items, approved, defaultTransitionSeconds, selectedEventIdForAutosave]);

  function updateDefaultTransitionSeconds(value: number): void {
    const safe = Math.max(0, Math.min(3_600, Math.floor(value) || 0));
    setDefaultTransitionSeconds(safe);
    draftRevisionRef.current += 1;
    setDirty(true);
  }

  async function copyListText(): Promise<void> {
    if (!selectedEvent) return;
    const text = setListDocumentText(
      selectedEvent,
      items,
      resources.music,
      showNotes,
      defaultTransitionSeconds,
      resources.venues,
    );
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Set list copied as text.");
    } catch {
      setError("The set list could not be copied. Check clipboard permissions.");
    }
  }

  async function openPracticePlayer(): Promise<void> {
    if (!selectedEvent || busy || playerBusy) return;
    setPlayerBusy(true);
    setError(null);
    try {
      const link = await generatePublicPlayerToken(selectedEvent.id);
      window.location.assign(link.url);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The no-login practice player could not be opened.",
      );
    } finally {
      setPlayerBusy(false);
    }
  }

  async function rotatePracticePlayer(): Promise<void> {
    if (!selectedEvent || busy || playerBusy) return;
    setPlayerBusy(true);
    setError(null);
    try {
      const link = await rotatePublicPlayerToken(selectedEvent.id);
      await navigator.clipboard.writeText(link.url);
      setMessage("Practice player link rotated and copied. The previous link no longer works.");
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The practice player link could not be rotated or copied.",
      );
    } finally {
      setPlayerBusy(false);
    }
  }

  function moveDraggedItem(toIndex: number): void {
    if (dragIndex === null || dragIndex === toIndex) return;
    const moved = items[dragIndex];
    updateDraftItems((current) => moveItemToIndex(current, dragIndex, toIndex));
    setDragIndex(null);
    if (moved) setMessage(`Moved ${moved.title} to position ${String(toIndex + 1)}.`);
  }
  return {
    addCustomItem,
    addMusicPiece,
    approved,
    busy,
    closeItemEditor,
    copyEventId,
    copyListText,
    copyMissingItems,
    customComposer,
    customDialogOpen,
    customDuration,
    customNotes,
    customTitle,
    customType,
    defaultTransitionCount,
    defaultTransitionDuration,
    defaultTransitionSeconds,
    dirty,
    dragIndex,
    editingItem,
    enabled,
    error,
    estimatedRuntime,
    filteredMusic,
    intermissionsDuration,
    items,
    loaded,
    markDraftDirty,
    message,
    missingDurationCustomCount,
    moveDraggedItem,
    musicQuery,
    openCustomItem,
    insertCustomItem,
    openItemEditor,
    openPracticePlayer,
    rotatePracticePlayer,
    performances,
    performerLabelPlural,
    playerBusy,
    resources,
    save,
    saveItemEdit,
    selectedEvent,
    selectedEventId,
    setApproved,
    setCopyEventId,
    setCustomComposer,
    setCustomDialogOpen,
    setCustomDuration,
    setCustomNotes,
    setCustomTitle,
    setCustomType,
    setDefaultTransitionSeconds,
    setDirty,
    setDragIndex,
    setEditingItem,
    setError,
    setItems,
    setMessage,
    setMusicQuery,
    setSelectedEventId,
    setShowNotes,
    showNotes,
    songsDuration,
    totalDuration,
    updateDefaultTransitionSeconds,
    updateDraftItems,
  };
}

export type SetListManagerModel = ReturnType<typeof useSetListManagerController>;
