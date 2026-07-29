import type {
  OrganizationEvent,
  OrganizationEventRequest,
  OrganizationMusicPiece,
  OrganizationProfile,
} from "@choir/contracts";
import {
  calculateSetListDuration,
  formatSetListDuration,
  hasSetListPiece,
  moveSetListItem,
  parseSetListDuration,
} from "@choir/domain";
import { Dialog } from "@choir/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AuthApiError,
  listOrganizationEvents,
  listOrganizationMusic,
  listOrganizationProfiles,
  updateOrganizationEvent,
} from "../auth/api";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

type SetListItem = OrganizationEvent["setList"][number];
type PerformerCredit = NonNullable<SetListItem["performerCredits"]>[number];

interface Resources {
  readonly events: readonly OrganizationEvent[];
  readonly music: readonly OrganizationMusicPiece[];
  readonly profiles: readonly OrganizationProfile[];
}

const emptyResources: Resources = { events: [], music: [], profiles: [] };

function eventRequestFrom(event: OrganizationEvent, setList: SetListItem[], approved: boolean) {
  return {
    advancePriceCents: event.advancePriceCents,
    callTime: event.callTime,
    dayOfPriceCents: event.dayOfPriceCents,
    details: event.details,
    doorsOpenTime: event.doorsOpenTime,
    durationMinutes: event.durationMinutes,
    isTicketingEnabled: event.isTicketingEnabled,
    location: event.location,
    parentPerformanceId: event.parentPerformanceId,
    publicDetails: event.publicDetails,
    publicGraphicFileId: event.publicGraphicFileId,
    publishOnWebsite: event.publishOnWebsite,
    setList,
    setListApproved: approved,
    startsAt: event.startsAt,
    ticketCapacity: event.ticketCapacity,
    title: event.title,
    type: event.type,
    venueId: event.venueId,
  } satisfies OrganizationEventRequest;
}

function itemType(item: SetListItem): "intermission" | "song" {
  return item.type === "intermission" ? "intermission" : "song";
}

function durationFromSeconds(seconds: number | null): string | undefined {
  return seconds && seconds > 0 ? formatSetListDuration(seconds) : undefined;
}

function normalizeItems(items: readonly SetListItem[]): SetListItem[] {
  return items.map((item) => ({ ...item, id: item.id ?? crypto.randomUUID() }));
}

function moveItemToIndex(
  items: readonly SetListItem[],
  fromIndex: number,
  toIndex: number,
): SetListItem[] {
  let next = [...items];
  const direction: 1 | -1 = fromIndex < toIndex ? 1 : -1;
  for (let index = fromIndex; index !== toIndex; index += direction) {
    next = [...moveSetListItem(next, index, direction)];
  }
  return next;
}

function displayEvent(event: OrganizationEvent): string {
  return `${event.title} — ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(event.startsAt))}`;
}

function SetListCreditEditor({
  item,
  onChange,
  profiles,
}: {
  readonly item: SetListItem;
  readonly onChange: (item: SetListItem) => void;
  readonly profiles: readonly OrganizationProfile[];
}) {
  const { performerLabel } = useOrganizationTerminology();
  const [guestName, setGuestName] = useState("");
  const credits = item.performerCredits ?? [];

  function addCredit(credit: PerformerCredit): void {
    if (
      credit.kind === "profile" &&
      credits.some(
        (candidate) => candidate.kind === "profile" && candidate.profileId === credit.profileId,
      )
    ) {
      return;
    }
    onChange({ ...item, performerCredits: [...credits, credit] });
  }

  return (
    <div className="set-list-credits">
      <p className="field-help">{performerLabel} credits are saved as display-name snapshots.</p>
      <div className="set-list-credit-controls">
        <label className="field">
          Add Organization Profile
          <select
            value=""
            onChange={(event) => {
              const profile = profiles.find(({ id }) => id === event.target.value);
              if (profile) {
                addCredit({
                  displayName: profile.displayName,
                  kind: "profile",
                  profileId: profile.id,
                });
              }
            }}
          >
            <option value="">Choose a Profile…</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Add guest {performerLabel.toLowerCase()}
          <span className="set-list-inline-control">
            <input
              maxLength={200}
              value={guestName}
              onChange={(event) => {
                setGuestName(event.target.value);
              }}
            />
            <button
              className="button button--secondary"
              disabled={!guestName.trim()}
              type="button"
              onClick={() => {
                addCredit({ displayName: guestName.trim(), kind: "guest" });
                setGuestName("");
              }}
            >
              Add
            </button>
          </span>
        </label>
      </div>
      {credits.length > 0 ? (
        <ul className="set-list-credit-list">
          {credits.map((credit, index) => (
            <li key={`${credit.kind}-${credit.displayName}-${String(index)}`}>
              <span>
                {credit.displayName} {credit.kind === "guest" ? "(guest)" : ""}
              </span>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  onChange({
                    ...item,
                    performerCredits: credits.filter(
                      (_, candidateIndex) => candidateIndex !== index,
                    ),
                  });
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// eslint-disable-next-line complexity -- this editor coordinates ordering, drafts, and modal forms.
export function SetListManager({ enabled }: { readonly enabled: boolean }) {
  const { performerLabelPlural } = useOrganizationTerminology();
  const [resources, setResources] = useState<Resources>(emptyResources);
  const [loaded, setLoaded] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [copyEventId, setCopyEventId] = useState("");
  const [items, setItems] = useState<SetListItem[]>([]);
  const [approved, setApproved] = useState(false);
  const [customType, setCustomType] = useState<"intermission" | "song">("song");
  const [customTitle, setCustomTitle] = useState("");
  const [customComposer, setCustomComposer] = useState("");
  const [customDuration, setCustomDuration] = useState("");
  const [customNotes, setCustomNotes] = useState("");
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<SetListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [musicQuery, setMusicQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationEvents(controller.signal),
      listOrganizationMusic(controller.signal),
      listOrganizationProfiles(controller.signal),
    ])
      .then(([events, music, profiles]) => {
        setResources({ events, music, profiles });
        const firstPerformance = events.find(({ type }) => type === "Performance");
        setSelectedEventId(firstPerformance?.id ?? "");
        setItems(normalizeItems(firstPerformance?.setList ?? []));
        setApproved(firstPerformance?.setListApproved ?? false);
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
  }, [enabled]);

  const performances = useMemo(
    () =>
      resources.events
        .filter(({ type }) => type === "Performance")
        .toSorted((left, right) => left.startsAt.localeCompare(right.startsAt)),
    [resources.events],
  );
  const selectedEvent = performances.find(({ id }) => id === selectedEventId) ?? null;
  const songsDuration = items
    .filter((item) => item.type !== "intermission")
    .reduce(
      (total, item) => total + (item.duration ? (parseSetListDuration(item.duration) ?? 0) : 0),
      0,
    );
  const intermissionsDuration = items
    .filter((item) => item.type === "intermission")
    .reduce(
      (total, item) => total + (item.duration ? (parseSetListDuration(item.duration) ?? 0) : 0),
      0,
    );
  const filteredMusic = useMemo(() => {
    const query = musicQuery.trim().toLocaleLowerCase();
    if (!query) return resources.music;
    return resources.music.filter(({ composer, title }) =>
      `${title} ${composer}`.toLocaleLowerCase().includes(query),
    );
  }, [musicQuery, resources.music]);

  function updateDraftItems(updater: (current: SetListItem[]) => SetListItem[]): void {
    setItems(updater);
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
        duration: customDuration.trim() || undefined,
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

  function openCustomItem(title = "", duration = ""): void {
    setCustomTitle(title);
    setCustomComposer("");
    setCustomDuration(duration);
    setCustomNotes("");
    setError(null);
    setCustomDialogOpen(true);
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
    if (!editingItem.title.trim()) {
      setError("Enter a title for the set-list item.");
      return;
    }
    if (editingItem.duration && parseSetListDuration(editingItem.duration) === null) {
      setError("Duration must be minutes, minutes:seconds, hours:minutes:seconds, or named units.");
      return;
    }
    updateItem(editingItemIndex, {
      ...editingItem,
      title: editingItem.title.trim(),
      composer:
        itemType(editingItem) === "song"
          ? editingItem.composer?.trim()
            ? editingItem.composer.trim()
            : undefined
          : undefined,
      duration: editingItem.duration?.trim() ? editingItem.duration.trim() : undefined,
      notes: editingItem.notes?.trim() ? editingItem.notes.trim() : undefined,
    });
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
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await updateOrganizationEvent(
        selectedEvent.id,
        eventRequestFrom(selectedEvent, items, approved),
      );
      setResources((current) => ({
        ...current,
        events: current.events.map((event) => (event.id === saved.id ? saved : event)),
      }));
      setItems(normalizeItems(saved.setList));
      setDirty(false);
      setMessage("Set list saved.");
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError ? caught.message : "The set list could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  saveRef.current = save;

  useEffect(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!dirty || !selectedEvent) return;
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
  }, [dirty, items, approved, selectedEvent?.id]);

  async function copyListText(): Promise<void> {
    if (!selectedEvent) return;
    const text = items
      .map((item, index) => {
        const duration = item.duration ? ` (${item.duration})` : "";
        const composer = item.composer ? ` — ${item.composer}` : "";
        return `${String(index + 1)}. ${item.title}${composer}${duration}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Set list copied as text.");
    } catch {
      setError("The set list could not be copied. Check clipboard permissions.");
    }
  }

  function moveDraggedItem(toIndex: number): void {
    if (dragIndex === null || dragIndex === toIndex) return;
    const moved = items[dragIndex];
    updateDraftItems((current) => moveItemToIndex(current, dragIndex, toIndex));
    setDragIndex(null);
    if (moved) setMessage(`Moved ${moved.title} to position ${String(toIndex + 1)}.`);
  }

  if (!enabled) return null;

  return (
    <section className="account-section set-list-section" aria-label="Set list editor">
      <div className="section-heading section-heading--compact set-list-page-intro">
        <p className="section-description">
          Manage performance set lists, timings, and {performerLabelPlural.toLowerCase()}{" "}
          visibility.
        </p>
        {selectedEvent ? (
          <div className="button-row" aria-label="Set-list tools">
            <a
              className="button button--secondary"
              href={`/practice?eventId=${encodeURIComponent(selectedEvent.id)}`}
            >
              Practice Player
            </a>
            <button
              className="button button--secondary"
              onClick={() => {
                void copyListText();
                window.print();
              }}
              type="button"
            >
              Print &amp; Copy
            </button>
          </div>
        ) : null}
      </div>
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
      {!loaded ? <p>Loading set lists…</p> : null}
      {loaded && performances.length === 0 ? (
        <p className="empty-state">Create a Performance before building a set list.</p>
      ) : null}
      {selectedEvent ? (
        <div className="set-list-layout">
          <div className="set-list-toolbar">
            <label className="field">
              Select event
              <select
                value={selectedEventId}
                onChange={(event) => {
                  const nextEvent = performances.find(({ id }) => id === event.target.value);
                  setSelectedEventId(nextEvent?.id ?? "");
                  setItems(normalizeItems(nextEvent?.setList ?? []));
                  setApproved(nextEvent?.setListApproved ?? false);
                  setDirty(false);
                  setMusicQuery("");
                  setCopyEventId("");
                  setError(null);
                  setMessage(null);
                }}
              >
                {performances.map((performance) => (
                  <option key={performance.id} value={performance.id}>
                    {displayEvent(performance)}
                  </option>
                ))}
              </select>
            </label>
            <div className="set-list-copy-row">
              <label className="field">
                Copy from previous
                <select
                  value={copyEventId}
                  onChange={(event) => {
                    setCopyEventId(event.target.value);
                  }}
                >
                  <option value="">Choose another Performance…</option>
                  {performances
                    .filter(({ id }) => id !== selectedEvent.id)
                    .map((performance) => (
                      <option key={performance.id} value={performance.id}>
                        {displayEvent(performance)}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="button button--secondary"
                disabled={!copyEventId}
                type="button"
                onClick={copyMissingItems}
              >
                Copy items
              </button>
            </div>
            <label className="set-list-visibility checkbox-field">
              <input
                checked={approved}
                type="checkbox"
                onChange={(event) => {
                  setApproved(event.target.checked);
                  setDirty(true);
                }}
              />
              <span>
                <strong>Approved for {performerLabelPlural.toLowerCase()}</strong>
                <small>Members can see this set list.</small>
              </span>
            </label>
          </div>

          <div className="set-list-add-panel">
            <div className="set-list-add-bar">
              <div className="set-list-add-type" aria-label="Set-list item type" role="group">
                <button
                  className={`button button--small${customType === "song" ? " is-active" : ""}`}
                  type="button"
                  onClick={() => {
                    setCustomType("song");
                  }}
                >
                  Song
                </button>
                <button
                  className={`button button--small${customType === "intermission" ? " is-active" : ""}`}
                  type="button"
                  onClick={() => {
                    setCustomType("intermission");
                  }}
                >
                  Intermission
                </button>
              </div>
              <div className="field set-list-music-search">
                <label className="sr-only" htmlFor="set-list-music-search">
                  Search music library or enter a title
                </label>
                <input
                  aria-controls="set-list-music-results"
                  aria-expanded={Boolean(musicQuery.trim())}
                  aria-autocomplete="list"
                  id="set-list-music-search"
                  onChange={(event) => {
                    setMusicQuery(event.target.value);
                  }}
                  placeholder="Search music library or enter a title…"
                  type="search"
                  value={musicQuery}
                />
                {musicQuery.trim() ? (
                  <div
                    aria-label="Matching music"
                    className="set-list-music-results"
                    id="set-list-music-results"
                    role="listbox"
                  >
                    {filteredMusic.length > 0 ? (
                      filteredMusic.slice(0, 50).map((piece) => (
                        <button
                          className="set-list-music-result"
                          key={piece.id}
                          onClick={() => {
                            addMusicPiece(piece);
                          }}
                          role="option"
                          type="button"
                        >
                          <strong>{piece.title}</strong>
                          <span>{piece.composer || "Composer not listed"}</span>
                        </button>
                      ))
                    ) : (
                      <p className="set-list-music-results__empty">No matching music pieces.</p>
                    )}
                  </div>
                ) : null}
                <p className="field-help" aria-live="polite">
                  {musicQuery.trim()
                    ? `${String(filteredMusic.length)} matching piece${filteredMusic.length === 1 ? "" : "s"}${filteredMusic.length > 50 ? " · showing first 50" : ""}. Select a result to add it.`
                    : `${String(resources.music.length)} pieces available. Start typing to search.`}
                </p>
              </div>
              <label className="field set-list-duration-input">
                <span className="sr-only">Duration</span>
                <input
                  onChange={(event) => {
                    setCustomDuration(event.target.value);
                  }}
                  placeholder="Duration"
                  type="text"
                  value={customDuration}
                />
              </label>
              <button
                className="button button--primary"
                type="button"
                onClick={() => {
                  openCustomItem(musicQuery.trim(), customDuration.trim());
                }}
              >
                + Add
              </button>
            </div>
            <p className="field-help set-list-add-tip">
              Select an existing library item from the suggestions, or use + Add for a custom song
              or intermission.
            </p>
          </div>

          <div className="set-list-summary" aria-live="polite">
            <span>
              <strong>Songs</strong> {formatSetListDuration(songsDuration)}
            </span>
            <span>
              <strong>Intermissions</strong> {formatSetListDuration(intermissionsDuration)}
            </span>
            <span>
              <strong>Items</strong> {String(items.length)}
            </span>
            <span className="set-list-summary__total">
              <strong>Total</strong> {formatSetListDuration(calculateSetListDuration(items))}
            </span>
          </div>

          {items.length === 0 ? (
            <p className="empty-state">This Performance does not have set-list items yet.</p>
          ) : (
            <>
              <p className="field-help" aria-live="polite">
                Drag an item to reorder it, or use Move up and Move down for keyboard control.
              </p>
              <ol className="set-list-items" aria-label="Ordered set-list items">
                {items.map((item, index) => (
                  <li
                    className={`set-list-item${dragIndex === index ? " set-list-item--dragging" : ""}${item.type === "intermission" ? " set-list-item--intermission" : ""}`}
                    draggable
                    key={item.id}
                    onDragEnd={() => {
                      setDragIndex(null);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDragStart={() => {
                      setDragIndex(index);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      moveDraggedItem(index);
                    }}
                    onPointerCancel={(event) => {
                      if (event.pointerType === "touch") setDragIndex(null);
                    }}
                    onPointerDown={(event) => {
                      if (event.pointerType === "touch") setDragIndex(index);
                    }}
                    onPointerUp={(event) => {
                      if (event.pointerType === "touch") moveDraggedItem(index);
                    }}
                  >
                    <div className="set-list-item-heading">
                      <div className="set-list-item-title">
                        <span
                          className="set-list-drag-handle"
                          aria-hidden="true"
                          title="Drag to reorder"
                        />
                        {item.type === "intermission" ? (
                          <span className="set-list-item-type">Intermission</span>
                        ) : null}
                        <strong>
                          {String(index + 1)}. {item.title}
                        </strong>
                      </div>
                      <div className="button-row set-list-item-actions">
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => {
                            openItemEditor(index);
                          }}
                        >
                          Set list details
                        </button>
                        {item.pieceId &&
                        resources.music.some(
                          (piece) =>
                            (piece.id === item.pieceId || piece.parentId === item.pieceId) &&
                            Object.keys(piece.trackFileIds).length > 0,
                        ) ? (
                          <a
                            className="text-button"
                            href={`/practice?pieceId=${encodeURIComponent(item.pieceId)}`}
                          >
                            Play
                          </a>
                        ) : null}
                        <button
                          aria-label={`Move ${item.title} up`}
                          className="text-button"
                          disabled={index === 0}
                          type="button"
                          onClick={() => {
                            updateDraftItems((current) => [...moveSetListItem(current, index, -1)]);
                          }}
                        >
                          Move up
                        </button>
                        <button
                          aria-label={`Move ${item.title} down`}
                          className="text-button"
                          disabled={index === items.length - 1}
                          type="button"
                          onClick={() => {
                            updateDraftItems((current) => [...moveSetListItem(current, index, 1)]);
                          }}
                        >
                          Move down
                        </button>
                        <button
                          className="text-button text-button--danger"
                          type="button"
                          onClick={() => {
                            updateDraftItems((current) =>
                              current.filter((_, itemIndex) => itemIndex !== index),
                            );
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="set-list-item-summary">
                      <span>
                        {[item.composer, item.duration].filter(Boolean).join(" · ") ||
                          (item.notes ? "Notes added" : "No additional details")}
                      </span>
                      {item.isFeaturedNumber ? <span className="status-pill">Featured</span> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}

          <Dialog
            description="Add a song or intermission to this Performance without expanding the editor."
            onClose={() => {
              setCustomDialogOpen(false);
            }}
            open={customDialogOpen}
            title="Add custom set-list item"
          >
            <form
              className="form-stack set-list-item-dialog"
              onSubmit={(event) => {
                event.preventDefault();
                addCustomItem();
              }}
            >
              {error ? (
                <p className="notice notice--error" role="alert">
                  {error}
                </p>
              ) : null}
              <label className="field">
                Type
                <select
                  value={customType}
                  onChange={(event) => {
                    setCustomType(event.target.value === "intermission" ? "intermission" : "song");
                  }}
                >
                  <option value="song">Song</option>
                  <option value="intermission">Intermission</option>
                </select>
              </label>
              <label className="field">
                Title
                <input
                  autoFocus
                  maxLength={300}
                  required
                  value={customTitle}
                  onChange={(event) => {
                    setCustomTitle(event.target.value);
                  }}
                />
              </label>
              {customType === "song" ? (
                <label className="field">
                  Composer
                  <input
                    maxLength={300}
                    value={customComposer}
                    onChange={(event) => {
                      setCustomComposer(event.target.value);
                    }}
                  />
                </label>
              ) : null}
              <label className="field">
                Duration
                <input
                  maxLength={20}
                  placeholder="4:05"
                  value={customDuration}
                  onChange={(event) => {
                    setCustomDuration(event.target.value);
                  }}
                />
              </label>
              <label className="field">
                Notes
                <textarea
                  maxLength={10_000}
                  rows={3}
                  value={customNotes}
                  onChange={(event) => {
                    setCustomNotes(event.target.value);
                  }}
                />
              </label>
              <div className="dialog__actions">
                <button
                  className="button button--secondary"
                  onClick={() => {
                    setCustomDialogOpen(false);
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button className="button button--primary" type="submit">
                  Add item
                </button>
              </div>
            </form>
          </Dialog>

          <Dialog
            description={`Update the item details and ${performerLabelPlural.toLowerCase()} assignments, then close when finished.`}
            onClose={closeItemEditor}
            open={editingItem !== null}
            title="Edit set-list item"
          >
            {editingItem ? (
              <form
                className="form-stack set-list-item-dialog"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveItemEdit();
                }}
              >
                {error ? (
                  <p className="notice notice--error" role="alert">
                    {error}
                  </p>
                ) : null}
                <label className="field">
                  Title
                  <input
                    autoFocus
                    maxLength={300}
                    required
                    value={editingItem.title}
                    onChange={(event) => {
                      setEditingItem({ ...editingItem, title: event.target.value });
                    }}
                  />
                </label>
                {itemType(editingItem) === "song" ? (
                  <label className="field">
                    Composer
                    <input
                      maxLength={300}
                      value={editingItem.composer ?? ""}
                      onChange={(event) => {
                        setEditingItem({ ...editingItem, composer: event.target.value });
                      }}
                    />
                  </label>
                ) : null}
                <label className="field">
                  Duration
                  <input
                    aria-invalid={
                      Boolean(editingItem.duration) &&
                      parseSetListDuration(editingItem.duration) === null
                    }
                    maxLength={20}
                    value={editingItem.duration ?? ""}
                    onChange={(event) => {
                      setEditingItem({ ...editingItem, duration: event.target.value });
                    }}
                  />
                </label>
                <label className="field">
                  Notes
                  <textarea
                    maxLength={10_000}
                    rows={3}
                    value={editingItem.notes ?? ""}
                    onChange={(event) => {
                      setEditingItem({ ...editingItem, notes: event.target.value });
                    }}
                  />
                </label>
                {itemType(editingItem) === "song" ? (
                  <label className="checkbox-field">
                    <input
                      checked={editingItem.isFeaturedNumber ?? editingItem.soloSmallGroup ?? false}
                      type="checkbox"
                      onChange={(event) => {
                        const isFeaturedNumber = event.target.checked;
                        const updated = { ...editingItem, isFeaturedNumber };
                        delete updated.soloSmallGroup;
                        if (!isFeaturedNumber) updated.performerCredits = [];
                        setEditingItem(updated);
                      }}
                    />
                    Featured number
                  </label>
                ) : null}
                {itemType(editingItem) === "song" && editingItem.isFeaturedNumber ? (
                  <SetListCreditEditor
                    item={editingItem}
                    profiles={resources.profiles}
                    onChange={setEditingItem}
                  />
                ) : null}
                <div className="dialog__actions">
                  <button
                    className="button button--secondary"
                    onClick={closeItemEditor}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button className="button button--primary" type="submit">
                    Save item
                  </button>
                </div>
              </form>
            ) : null}
          </Dialog>

          <div className="set-list-save-row">
            <span className="field-help" role="status">
              {busy
                ? "Saving automatically…"
                : dirty
                  ? "Changes save automatically."
                  : "All changes saved."}
            </span>
            <label className="checkbox-field">
              <input
                checked={approved}
                type="checkbox"
                onChange={(event) => {
                  setApproved(event.target.checked);
                  setDirty(true);
                }}
              />
              Set list approved for member use
            </label>
            <button
              className="button button--primary"
              disabled={busy || items.some((item) => !item.title.trim())}
              type="button"
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save now"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
