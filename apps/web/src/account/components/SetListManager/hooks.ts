import type { OrganizationMusicPiece } from "@choir/contracts";
import {
  canInsertSetListCustomEntryAt,
  expandMusicSelections,
  hasSetListPiece,
  normalizeSetListDuration,
  parseSetListDuration,
  selectDefaultPerformance,
} from "@choir/domain";
import {
  durationFromSeconds,
  setListTiming,
  emptyResources,
  eventRequestFrom,
  moveItemToIndex,
  normalizeItems,
  setListHasLearningTrack,
  setListItemEditError,
  setListItemForEdit,
  setListDocumentText,
} from "./utils";
import type { PlayerAction, Resources, SetListItem } from "./types";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AuthApiError,
  generatePublicPlayerToken,
  getOrganizationCalendarSettings,
  getPublicPlayerLinkStatus,
  listOrganizationEvents,
  listOrganizationMusic,
  listOrganizationProfiles,
  listOrganizationVenues,
  type PublicPlayerLink,
  type PublicPlayerLinkStatus,
  updateOrganizationEvent,
} from "../../../auth/api";
import { copyPlainTextUrl } from "../../../shared/clipboard";
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
  const [selectedEventId, setSelectedEventIdState] = useState("");
  const [copyEventId, setCopyEventId] = useState("");
  const [items, setItems] = useState<SetListItem[]>([]);
  const [approved, setApproved] = useState(false);
  const [defaultTransitionSeconds, setDefaultTransitionSeconds] = useState(0);
  const [customType, setCustomType] = useState<"intermission" | "song">("song");
  const [customTitle, setCustomTitle] = useState("");
  const [customComposer, setCustomComposer] = useState("");
  const [customDuration, setCustomDuration] = useState("");
  const [customCueKind, setCustomCueKind] = useState<"timed" | "quick">("timed");
  const [customCueInstruction, setCustomCueInstruction] = useState("");
  const [customNotes, setCustomNotes] = useState("");
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<SetListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [playerAction, setPlayerAction] = useState<PlayerAction>(null);
  const [linkStatus, setLinkStatus] = useState<PublicPlayerLinkStatus | null>(null);
  const [linkStatusError, setLinkStatusError] = useState<string | null>(null);
  const [activePlayerLink, setActivePlayerLink] = useState<PublicPlayerLink | null>(null);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [musicQuery, setMusicQuery] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const inFlightSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const draftRevisionRef = useRef(0);
  const lastSaveRevisionRef = useRef(-1);
  const hasInitializedSelectionRef = useRef(false);
  const selectedEventIdRef = useRef("");
  const lastRequestedEventIdsRef = useRef<string | null>(null);

  function setSelectedEventId(eventId: string): void {
    selectedEventIdRef.current = eventId;
    setSelectedEventIdState(eventId);
    setLinkStatus(null);
    setLinkStatusError(null);
    setActivePlayerLink(null);
    setQrDialogOpen(false);
    setQrUrl("");
  }

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    function initializeDraftForEvent(event: Resources["events"][number] | null): void {
      const eventId = event?.id ?? "";
      selectedEventIdRef.current = eventId;
      setSelectedEventIdState(eventId);
      setItems(normalizeItems(event?.setList ?? []));
      setApproved(event?.setListApproved ?? false);
      setDefaultTransitionSeconds(event?.setListDefaultTransitionSeconds ?? 0);
      setMusicQuery("");
      setCopyEventId("");
      setError(null);
      setMessage(null);
      setDirty(false);
      setLinkStatus(null);
      setLinkStatusError(null);
      setActivePlayerLink(null);
      setQrDialogOpen(false);
      setQrUrl("");
    }

    Promise.all([
      listOrganizationEvents(controller.signal),
      listOrganizationMusic(controller.signal),
      listOrganizationProfiles(controller.signal),
      listOrganizationVenues(controller.signal),
      getOrganizationCalendarSettings(controller.signal),
    ])
      .then(([events, music, profiles, venues, calendarSettings]) => {
        setResources({ events, music, profiles, venues });

        const explicitEventIds = [
          initialEventId,
          new URLSearchParams(window.location.search).get("eventId"),
        ].filter((eventId): eventId is string => Boolean(eventId));
        const performancesById = new Map(
          events
            .filter(({ type }) => type === "Performance")
            .map((event) => [event.id, event] as const),
        );
        const requestedEventIdsKey =
          explicitEventIds.length > 0 ? explicitEventIds.join("\u0000") : null;
        const explicitPerformance = explicitEventIds
          .map((eventId) => performancesById.get(eventId))
          .find((event) => event !== undefined);
        const isFirstResourceLoad = !hasInitializedSelectionRef.current;
        const hasNewExplicitRequest = requestedEventIdsKey !== lastRequestedEventIdsRef.current;

        if (isFirstResourceLoad) {
          if (explicitEventIds.length > 0) {
            if (explicitPerformance) {
              initializeDraftForEvent(explicitPerformance);
            } else {
              initializeDraftForEvent(null);
              setError(
                "The requested performance could not be found or is not an active performance.",
              );
            }
          } else {
            initializeDraftForEvent(
              selectDefaultPerformance(events, new Date(), calendarSettings.timezone),
            );
          }
          hasInitializedSelectionRef.current = true;
        } else if (hasNewExplicitRequest) {
          if (explicitPerformance) {
            if (explicitPerformance.id !== selectedEventIdRef.current) {
              initializeDraftForEvent(explicitPerformance);
            }
          } else if (explicitEventIds.length > 0) {
            initializeDraftForEvent(null);
            setError(
              "The requested performance could not be found or is not an active performance.",
            );
          }
        }
        lastRequestedEventIdsRef.current = requestedEventIdsKey;
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
  const selectedEventIdForStatus = selectedEvent?.id ?? null;

  useEffect(() => {
    if (!enabled || !selectedEventIdForStatus) return;

    const controller = new AbortController();

    getPublicPlayerLinkStatus(selectedEventIdForStatus, controller.signal)
      .then((status) => {
        setLinkStatus(status);
        setLinkStatusError(null);
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setLinkStatusError("Practice player link status could not be loaded.");
        }
      });

    return () => {
      controller.abort();
    };
  }, [enabled, selectedEventIdForStatus]);

  const timing = useMemo(
    () => setListTiming(items, resources.music, defaultTransitionSeconds),
    [items, defaultTransitionSeconds, resources.music],
  );
  const {
    songsDuration,
    intermissionsDuration,
    defaultTransitionCount,
    defaultTransitionDuration,
    estimatedRuntime,
    missingDurationCustomCount,
    quickCueCount,
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
    const existingIds = new Set(items.map(({ pieceId }) => pieceId));
    const additions = expandMusicSelections([piece], resources.music).filter(
      (candidate) => !existingIds.has(candidate.id),
    );
    if (additions.length === 0) {
      setError("That music piece is already in this set list.");
      return;
    }
    updateDraftItems((current) => [
      ...current,
      ...additions.map((candidate) => ({
        composer: candidate.composer || undefined,
        duration: durationFromSeconds(candidate.durationSeconds),
        id: crypto.randomUUID(),
        pieceId: candidate.id,
        title: candidate.title,
        type: "song" as const,
      })),
    ]);
    setMusicQuery("");
    setError(null);
  }

  function addCustomItem(): void {
    if (customType === "intermission" && !canInsertSetListCustomEntryAt(items, items.length)) {
      setError("A custom entry cannot be placed directly before or after a Quick Cue.");
      return;
    }
    if (!customTitle.trim()) {
      setError("Enter a title for the set-list item.");
      return;
    }
    const isIntermission = customType === "intermission";
    const isQuick = isIntermission && customCueKind === "quick";
    if (!isQuick && customDuration.trim() && parseSetListDuration(customDuration) === null) {
      setError("Duration must be minutes, minutes:seconds, hours:minutes:seconds, or named units.");
      return;
    }
    updateDraftItems((current) => [
      ...current,
      {
        composer: customType === "song" ? customComposer.trim() || undefined : undefined,
        cueInstruction: isQuick ? customCueInstruction.trim() || undefined : undefined,
        cueKind: isIntermission ? customCueKind : undefined,
        duration: isQuick ? undefined : normalizeSetListDuration(customDuration),
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
    setCustomCueInstruction("");
    setCustomCueKind("timed");
    setError(null);
    setCustomDialogOpen(false);
  }

  function openCustomItem(title = "", duration = "", type: "intermission" | "song" = "song"): void {
    setCustomType(type);
    setCustomTitle(type === "intermission" && !title.trim() ? "Intermission" : title);
    setCustomComposer("");
    setCustomDuration(duration);
    setCustomNotes("");
    setCustomCueKind("timed");
    setCustomCueInstruction("");
    setError(null);
    setCustomDialogOpen(true);
  }

  function insertCustomItem(index: number): void {
    if (!canInsertSetListCustomEntryAt(items, index)) {
      setError("A custom entry cannot be placed directly before or after a Quick Cue.");
      return;
    }
    const item: SetListItem = {
      cueKind: "timed",
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

  async function save(): Promise<boolean> {
    if (inFlightSavePromiseRef.current) {
      return inFlightSavePromiseRef.current;
    }
    if (!selectedEvent) return true;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (items.some((item) => item.duration && parseSetListDuration(item.duration) === null)) {
      setError("Correct invalid item durations before saving.");
      return false;
    }
    const eventId = selectedEvent.id;
    const saveRevision = draftRevisionRef.current;
    const request = eventRequestFrom(selectedEvent, items, approved, defaultTransitionSeconds);
    lastSaveRevisionRef.current = saveRevision;
    setBusy(true);
    setError(null);
    setMessage(null);

    const savePromise = (async () => {
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
        return true;
      } catch (caught: unknown) {
        setError(
          caught instanceof AuthApiError ? caught.message : "The set list could not be saved.",
        );
        return false;
      } finally {
        setBusy(false);
        inFlightSavePromiseRef.current = null;
      }
    })();

    inFlightSavePromiseRef.current = savePromise;
    return savePromise;
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

  async function copyListText(): Promise<boolean> {
    if (!selectedEvent) return false;
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
      return true;
    } catch {
      setError("The set list could not be copied. Check clipboard permissions.");
      return false;
    }
  }

  const isPracticePlayerEligible = Boolean(
    selectedEvent && approved && setListHasLearningTrack(items, resources.music),
  );

  async function ensureActiveLink(): Promise<PublicPlayerLink | null> {
    if (!selectedEvent || !isPracticePlayerEligible) return null;
    const expiresAtMs =
      activePlayerLink && activePlayerLink.expiresAt < 10_000_000_000
        ? activePlayerLink.expiresAt * 1000
        : (activePlayerLink?.expiresAt ?? 0);
    if (activePlayerLink && expiresAtMs > Date.now()) {
      return activePlayerLink;
    }
    const link = await generatePublicPlayerToken(selectedEvent.id);
    setActivePlayerLink(link);
    setLinkStatus({
      active: true,
      eventId: selectedEvent.id,
      expiresAt: link.expiresAt,
      issuedAt: link.issuedAt,
      status: "active",
    });
    return link;
  }

  async function openPracticePlayer(): Promise<void> {
    if (!selectedEvent || busy || playerAction !== null || !isPracticePlayerEligible) return;
    if (linkStatus?.status === "expired") {
      setError("The practice player link has expired. Renew the link before opening.");
      return;
    }
    setPlayerAction("open");
    setError(null);
    try {
      const link = await ensureActiveLink();
      if (!link) return;
      window.location.assign(link.url);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The no-login practice player could not be opened.",
      );
    } finally {
      setPlayerAction(null);
    }
  }

  async function copyPracticePlayerLink(): Promise<void> {
    if (!selectedEvent || busy || playerAction !== null || !isPracticePlayerEligible) return;
    if (linkStatus?.status === "expired") {
      setError("The practice player link has expired. Renew the link before copying.");
      return;
    }
    setPlayerAction("copy");
    setError(null);
    try {
      const link = await ensureActiveLink();
      if (!link) return;
      const absoluteUrl = new URL(link.url, window.location.origin).toString();
      await copyPlainTextUrl(absoluteUrl);
      setMessage("Practice player link copied.");
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The practice player link could not be copied.",
      );
    } finally {
      setPlayerAction(null);
    }
  }

  async function openPlayerQrCode(): Promise<void> {
    if (!selectedEvent || busy || playerAction !== null || !isPracticePlayerEligible) return;
    if (linkStatus?.status === "expired") {
      setError("The practice player link has expired. Renew the link before viewing QR code.");
      return;
    }
    setPlayerAction("qr");
    setError(null);
    try {
      const link = await ensureActiveLink();
      if (!link) return;
      const absoluteUrl = new URL(link.url, window.location.origin).toString();
      setQrUrl(absoluteUrl);
      setQrDialogOpen(true);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The practice player QR code could not be prepared.",
      );
    } finally {
      setPlayerAction(null);
    }
  }

  async function renewPracticePlayerLink(): Promise<void> {
    if (!selectedEvent || busy || playerAction !== null || !isPracticePlayerEligible) return;
    setPlayerAction("renew");
    setError(null);
    try {
      const link = await generatePublicPlayerToken(selectedEvent.id);
      setActivePlayerLink(link);
      setLinkStatus({
        active: true,
        eventId: selectedEvent.id,
        expiresAt: link.expiresAt,
        issuedAt: link.issuedAt,
        status: "active",
      });
      setMessage("Practice player link renewed.");
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The practice player link could not be renewed.",
      );
    } finally {
      setPlayerAction(null);
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
    customCueInstruction,
    customCueKind,
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
    copyPracticePlayerLink,
    linkStatus,
    linkStatusError,
    openPlayerQrCode,
    openPracticePlayer,
    performances,
    performerLabelPlural,
    playerAction,
    playerBusy: playerAction !== null,
    qrDialogOpen,
    qrUrl,
    quickCueCount,
    renewPracticePlayerLink,
    resources,
    save,
    saveItemEdit,
    selectedEvent,
    selectedEventId,
    setApproved,
    setCopyEventId,
    setCustomComposer,
    setCustomCueInstruction,
    setCustomCueKind,
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
    setQrDialogOpen,
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
