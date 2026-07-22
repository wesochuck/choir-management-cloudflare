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
import { useEffect, useMemo, useState } from "react";

import {
  AuthApiError,
  listOrganizationEvents,
  listOrganizationMusic,
  listOrganizationProfiles,
  updateOrganizationEvent,
} from "../auth/api";

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
      <p className="field-help">Performer credits are saved as display-name snapshots.</p>
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
          Add guest performer
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

export function SetListManager({ enabled }: { readonly enabled: boolean }) {
  const [resources, setResources] = useState<Resources>(emptyResources);
  const [loaded, setLoaded] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [copyEventId, setCopyEventId] = useState("");
  const [items, setItems] = useState<SetListItem[]>([]);
  const [approved, setApproved] = useState(false);
  const [musicPieceId, setMusicPieceId] = useState("");
  const [customType, setCustomType] = useState<"intermission" | "song">("song");
  const [customTitle, setCustomTitle] = useState("");
  const [customComposer, setCustomComposer] = useState("");
  const [customDuration, setCustomDuration] = useState("");
  const [customNotes, setCustomNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  function updateItem(index: number, updated: SetListItem): void {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? updated : item)));
  }

  function addMusicPiece(): void {
    const piece = resources.music.find(({ id }) => id === musicPieceId);
    if (!piece) return;
    if (hasSetListPiece(items, piece.id)) {
      setError("That music piece is already in this set list.");
      return;
    }
    setItems((current) => [
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
    setMusicPieceId("");
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
    setItems((current) => [
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
    setItems((current) => [...current, ...additions]);
    setMessage(`${String(copied)} item(s) copied; linked duplicates were skipped.`);
    setCopyEventId("");
  }

  async function save(): Promise<void> {
    if (!selectedEvent) return;
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
      setMessage("Set list saved.");
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError ? caught.message : "The set list could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;

  return (
    <section className="account-section" aria-labelledby="set-list-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Performances</p>
        <h2 id="set-list-title">Set lists</h2>
        <p className="section-description">
          Build an ordered program from the music catalog or custom items, then approve it when it
          is ready for members.
        </p>
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
          <div className="form-stack">
            <label className="field">
              Performance
              <select
                value={selectedEventId}
                onChange={(event) => {
                  const nextEvent = performances.find(({ id }) => id === event.target.value);
                  setSelectedEventId(nextEvent?.id ?? "");
                  setItems(normalizeItems(nextEvent?.setList ?? []));
                  setApproved(nextEvent?.setListApproved ?? false);
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
                Copy missing items from
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
          </div>

          <div className="set-list-add-grid">
            <div className="form-stack">
              <h3>Add from music catalog</h3>
              <label className="field">
                Music piece
                <select
                  value={musicPieceId}
                  onChange={(event) => {
                    setMusicPieceId(event.target.value);
                  }}
                >
                  <option value="">Choose music…</option>
                  {resources.music.map((piece) => (
                    <option key={piece.id} value={piece.id}>
                      {piece.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button button--secondary"
                disabled={!musicPieceId}
                type="button"
                onClick={addMusicPiece}
              >
                Add music
              </button>
            </div>
            <div className="form-stack">
              <h3>Add a custom item</h3>
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
                  maxLength={300}
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
                  rows={2}
                  value={customNotes}
                  onChange={(event) => {
                    setCustomNotes(event.target.value);
                  }}
                />
              </label>
              <button className="button button--secondary" type="button" onClick={addCustomItem}>
                Add custom item
              </button>
            </div>
          </div>

          <div className="set-list-summary" aria-live="polite">
            <strong>{String(items.length)} items</strong>
            <span>Total duration {formatSetListDuration(calculateSetListDuration(items))}</span>
          </div>

          {items.length === 0 ? (
            <p className="empty-state">This Performance does not have set-list items yet.</p>
          ) : (
            <ol className="set-list-items">
              {items.map((item, index) => (
                <li className="set-list-item" key={item.id}>
                  <div className="set-list-item-heading">
                    <strong>
                      {String(index + 1)}. {item.title}
                    </strong>
                    <div className="button-row">
                      <button
                        aria-label={`Move ${item.title} up`}
                        className="text-button"
                        disabled={index === 0}
                        type="button"
                        onClick={() => {
                          setItems((current) => [...moveSetListItem(current, index, -1)]);
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
                          setItems((current) => [...moveSetListItem(current, index, 1)]);
                        }}
                      >
                        Move down
                      </button>
                      <button
                        className="text-button text-button--danger"
                        type="button"
                        onClick={() => {
                          setItems((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          );
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="set-list-item-fields">
                    <label className="field">
                      Title
                      <input
                        maxLength={300}
                        required
                        value={item.title}
                        onChange={(event) => {
                          updateItem(index, { ...item, title: event.target.value });
                        }}
                      />
                    </label>
                    {itemType(item) === "song" ? (
                      <label className="field">
                        Composer
                        <input
                          maxLength={300}
                          value={item.composer ?? ""}
                          onChange={(event) => {
                            updateItem(index, {
                              ...item,
                              composer: event.target.value || undefined,
                            });
                          }}
                        />
                      </label>
                    ) : null}
                    <label className="field">
                      Duration
                      <input
                        aria-invalid={
                          Boolean(item.duration) && parseSetListDuration(item.duration) === null
                        }
                        maxLength={20}
                        value={item.duration ?? ""}
                        onChange={(event) => {
                          updateItem(index, { ...item, duration: event.target.value || undefined });
                        }}
                      />
                    </label>
                    <label className="field set-list-notes-field">
                      Notes
                      <textarea
                        maxLength={10_000}
                        rows={2}
                        value={item.notes ?? ""}
                        onChange={(event) => {
                          updateItem(index, { ...item, notes: event.target.value || undefined });
                        }}
                      />
                    </label>
                  </div>
                  {itemType(item) === "song" ? (
                    <label className="checkbox-field">
                      <input
                        checked={item.isFeaturedNumber ?? item.soloSmallGroup ?? false}
                        type="checkbox"
                        onChange={(event) => {
                          const isFeaturedNumber = event.target.checked;
                          const updated = { ...item, isFeaturedNumber };
                          delete updated.soloSmallGroup;
                          if (!isFeaturedNumber) updated.performerCredits = [];
                          updateItem(index, updated);
                        }}
                      />
                      Featured number
                    </label>
                  ) : null}
                  {itemType(item) === "song" && item.isFeaturedNumber ? (
                    <SetListCreditEditor
                      item={item}
                      profiles={resources.profiles}
                      onChange={(updated) => {
                        updateItem(index, updated);
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          <div className="set-list-save-row">
            <label className="checkbox-field">
              <input
                checked={approved}
                type="checkbox"
                onChange={(event) => {
                  setApproved(event.target.checked);
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
              {busy ? "Saving…" : "Save set list"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
