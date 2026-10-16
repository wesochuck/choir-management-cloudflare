import type { SingerLearningTrackPiece } from "@choir/contracts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@choir/ui";
import { useEffect, useMemo, useState } from "react";

import { listOrganizationEvents } from "../api/events";
import { getMySchedule } from "../api/singer";
import { AuthApiError, listSingerLearningTracks } from "../auth/api";
import {
  PublicPracticePlayer,
  createSessionTrackSource,
  resolveTrack,
  type PracticeTrackSource,
} from "../public/player";
import { useRosterPart } from "../public/player/useRosterPart";
import {
  filterLibraryPieces,
  filterPlaylistItems,
  getApprovedPerformanceSetLists,
  isPiecePlayableForPart,
  mapSetListToPlaylistItems,
  resolveEventCanonicalId,
  singerPiecesToPlaylistItems,
  type ApprovedSetListOption,
  type SelectableEvent,
} from "./memberPracticeLibrary";
import type { PlayerPlaylistItem } from "../public/player/types";

function formatPerformanceDate(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
  } catch {
    return iso;
  }
}

interface InitialNavigationContext {
  readonly activeTab: "set-lists" | "all-tracks";
  readonly selectedEventId: string;
  readonly staleNotice: string | null;
}

function resolveInitialNavigation(
  approved: readonly ApprovedSetListOption[],
  loadedEvents: readonly SelectableEvent[],
  eventIdParam: string | null,
  pieceIdParam: string | null,
): InitialNavigationContext {
  if (eventIdParam) {
    const matched = approved.find(
      (opt) =>
        opt.eventId === eventIdParam ||
        loadedEvents.some((e) => {
          const canonicalId = resolveEventCanonicalId(e);
          return (
            (e.id === eventIdParam || canonicalId === eventIdParam) && canonicalId === opt.eventId
          );
        }),
    );
    if (matched) {
      return { activeTab: "set-lists", selectedEventId: matched.eventId, staleNotice: null };
    }
    return {
      activeTab: "all-tracks",
      selectedEventId: approved[0]?.eventId ?? "",
      staleNotice: "The requested set list is no longer available.",
    };
  }

  if (pieceIdParam) {
    const matched = approved.find((opt) =>
      opt.setList.some((item) => item.pieceId === pieceIdParam),
    );
    if (matched) {
      return { activeTab: "set-lists", selectedEventId: matched.eventId, staleNotice: null };
    }
    return {
      activeTab: "all-tracks",
      selectedEventId: approved[0]?.eventId ?? "",
      staleNotice: null,
    };
  }

  if (approved[0]) {
    return { activeTab: "set-lists", selectedEventId: approved[0].eventId, staleNotice: null };
  }

  return { activeTab: "all-tracks", selectedEventId: "", staleNotice: null };
}

function PublishedSetListsTabContent({
  approvedSetLists,
  currentSetList,
  effectivePart,
  filteredSetListItems,
  onPlayableOnlyChange,
  onSelectEventId,
  onSetListQueryChange,
  onTrackKeyChange,
  pieceIdParam,
  playableOnly,
  setListPlayableCount,
  setListQuery,
  setListTotalMusicCount,
  source,
}: {
  readonly approvedSetLists: readonly ApprovedSetListOption[];
  readonly currentSetList: ApprovedSetListOption | null;
  readonly effectivePart: string;
  readonly filteredSetListItems: PlayerPlaylistItem[];
  readonly onPlayableOnlyChange: (checked: boolean) => void;
  readonly onSelectEventId: (id: string) => void;
  readonly onSetListQueryChange: (query: string) => void;
  readonly onTrackKeyChange: (key: string) => void;
  readonly pieceIdParam: string | null;
  readonly playableOnly: boolean;
  readonly setListPlayableCount: number;
  readonly setListQuery: string;
  readonly setListTotalMusicCount: number;
  readonly source: PracticeTrackSource;
}) {
  if (approvedSetLists.length === 0) {
    return (
      <p className="empty-state">
        No published performance set lists are currently available. Switch to All tracks to browse
        the full practice library.
      </p>
    );
  }

  if (!currentSetList) return null;

  return (
    <>
      <div className="practice-player__performance-picker">
        <label className="field" htmlFor="practice-set-list-picker">
          Choose a performance
          <select
            id="practice-set-list-picker"
            onChange={(e) => {
              onSelectEventId(e.target.value);
            }}
            value={currentSetList.eventId}
          >
            {approvedSetLists.map((opt) => (
              <option key={opt.eventId} value={opt.eventId}>
                {opt.title} ({formatPerformanceDate(opt.startsAt)})
              </option>
            ))}
          </select>
        </label>
        <div className="practice-player__performance-meta">
          <span className="practice-player__performance-date">
            {formatPerformanceDate(currentSetList.startsAt)}
          </span>
          <span aria-hidden="true" className="practice-player__meta-separator">
            |
          </span>
          <span aria-live="polite" className="practice-player__count-badge" role="status">
            {setListPlayableCount} playable of {setListTotalMusicCount} music selections
          </span>
        </div>
      </div>

      <div className="practice-player__filters">
        <div className="practice-player__filters-row">
          <label className="field">
            Search this set list
            <input
              onChange={(e) => {
                onSetListQueryChange(e.target.value);
              }}
              placeholder="Search this set list"
              type="search"
              value={setListQuery}
            />
          </label>
          <label className="field-checkbox practice-player__playable-toggle">
            <input
              checked={playableOnly}
              onChange={(e) => {
                onPlayableOnlyChange(e.target.checked);
              }}
              type="checkbox"
            />
            <span>Playable only</span>
          </label>
        </div>
      </div>

      {filteredSetListItems.length === 0 ? (
        <p className="empty-state">
          {playableOnly
            ? "No playable tracks match the current filters."
            : "No tracks match the current search."}
        </p>
      ) : (
        <PublicPracticePlayer
          details={{
            eventArtworkFileId: currentSetList.publicGraphicFileId,
            eventId: currentSetList.eventId,
            eventStartsAt: currentSetList.startsAt,
            eventTitle: currentSetList.title,
            items: filteredSetListItems,
          }}
          initialPieceId={pieceIdParam ?? undefined}
          initialTrackKey={effectivePart || undefined}
          onTrackKeyChange={onTrackKeyChange}
          source={source}
        />
      )}
    </>
  );
}

function AllTracksTabContent({
  allTracksPlayableCount,
  allTracksPlaylistItems,
  allTracksQuery,
  allTracksTotalCount,
  effectivePart,
  onAllTracksQueryChange,
  onPlayableOnlyChange,
  onTrackKeyChange,
  pieceIdParam,
  playableOnly,
  source,
}: {
  readonly allTracksPlayableCount: number;
  readonly allTracksPlaylistItems: PlayerPlaylistItem[];
  readonly allTracksQuery: string;
  readonly allTracksTotalCount: number;
  readonly effectivePart: string;
  readonly onAllTracksQueryChange: (query: string) => void;
  readonly onPlayableOnlyChange: (checked: boolean) => void;
  readonly onTrackKeyChange: (key: string) => void;
  readonly pieceIdParam: string | null;
  readonly playableOnly: boolean;
  readonly source: PracticeTrackSource;
}) {
  return (
    <>
      <div className="practice-player__filters">
        <div className="practice-player__filters-row">
          <label className="field">
            Search tracks
            <input
              onChange={(event) => {
                onAllTracksQueryChange(event.target.value);
              }}
              placeholder="Search title or composer"
              type="search"
              value={allTracksQuery}
            />
          </label>
          <label className="field-checkbox practice-player__playable-toggle">
            <input
              checked={playableOnly}
              onChange={(event) => {
                onPlayableOnlyChange(event.target.checked);
              }}
              type="checkbox"
            />
            <span>Playable only</span>
          </label>
        </div>
        <div aria-live="polite" className="practice-player__count-badge" role="status">
          Showing {allTracksPlayableCount} playable of {allTracksTotalCount} total pieces
        </div>
      </div>

      {allTracksPlaylistItems.length === 0 ? (
        <p className="empty-state">
          {playableOnly
            ? "No playable tracks match the current filters."
            : "No tracks match the current search."}
        </p>
      ) : (
        <PublicPracticePlayer
          details={{
            eventArtworkFileId: null,
            eventId: "",
            eventStartsAt: "",
            eventTitle: "Practice library",
            items: allTracksPlaylistItems,
          }}
          initialPieceId={pieceIdParam ?? undefined}
          initialTrackKey={effectivePart || undefined}
          onTrackKeyChange={onTrackKeyChange}
          source={source}
        />
      )}
    </>
  );
}

export function MemberPracticeView({ enabled }: { readonly enabled: boolean }) {
  const params = useMemo(
    () => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
  const eventIdParam = params.get("eventId");
  const pieceIdParam = params.get("pieceId");
  const rosterPart = useRosterPart();
  const source = useMemo(() => createSessionTrackSource(), []);

  const [pieces, setPieces] = useState<readonly SingerLearningTrackPiece[]>([]);
  const [events, setEvents] = useState<readonly SelectableEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleEventNotice, setStaleEventNotice] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"set-lists" | "all-tracks">("set-lists");
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [userSelectedPart, setUserSelectedPart] = useState<string | null>(null);

  const [setListQuery, setSetListQuery] = useState("");
  const [allTracksQuery, setAllTracksQuery] = useState("");
  const [playableOnly, setPlayableOnly] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    const schedulePromise = getMySchedule(controller.signal, true, true)
      .then(async (res) => {
        const approved = getApprovedPerformanceSetLists(res.events);
        if (approved.length > 0) return res.events;
        try {
          const orgEvents = await listOrganizationEvents(controller.signal);
          return orgEvents.length > 0 ? orgEvents : res.events;
        } catch {
          return res.events;
        }
      })
      .catch(async () => {
        return listOrganizationEvents(controller.signal).catch(() => []);
      });

    void Promise.allSettled([listSingerLearningTracks(controller.signal), schedulePromise]).then(
      ([piecesResult, eventsResult]) => {
        if (controller.signal.aborted) return;
        if (piecesResult.status !== "fulfilled") {
          const caught: unknown = piecesResult.reason;
          setError(
            caught instanceof AuthApiError
              ? caught.message
              : "The Organization practice library could not be loaded.",
          );
          setLoaded(true);
          return;
        }
        setPieces(piecesResult.value);

        const loadedEvents = eventsResult.status === "fulfilled" ? eventsResult.value : [];
        setEvents(loadedEvents);

        const approved = getApprovedPerformanceSetLists(loadedEvents);
        const nav = resolveInitialNavigation(approved, loadedEvents, eventIdParam, pieceIdParam);
        setSelectedEventId(nav.selectedEventId);
        setActiveTab(nav.activeTab);
        if (nav.staleNotice) {
          setStaleEventNotice(nav.staleNotice);
        }

        setLoaded(true);
      },
    );

    return () => {
      controller.abort();
    };
  }, [enabled, eventIdParam, pieceIdParam]);

  const approvedSetLists = useMemo(() => getApprovedPerformanceSetLists(events), [events]);

  const currentSetList: ApprovedSetListOption | null = useMemo(() => {
    if (approvedSetLists.length === 0) return null;
    return (
      approvedSetLists.find((opt) => opt.eventId === selectedEventId) ?? approvedSetLists[0] ?? null
    );
  }, [approvedSetLists, selectedEventId]);

  const effectivePart = userSelectedPart ?? rosterPart ?? "";

  const currentSetListAllItems = useMemo(
    () => (currentSetList ? mapSetListToPlaylistItems(currentSetList.setList, pieces) : []),
    [currentSetList, pieces],
  );

  const currentSetListMusicSelections = useMemo(
    () => currentSetListAllItems.filter((item) => item.type !== "intermission"),
    [currentSetListAllItems],
  );

  const setListPlayableCount = useMemo(
    () =>
      currentSetListMusicSelections.filter((item) => resolveTrack(item, effectivePart) !== null)
        .length,
    [currentSetListMusicSelections, effectivePart],
  );

  const filteredSetListItems = useMemo(
    () => filterPlaylistItems(currentSetListAllItems, setListQuery, playableOnly, effectivePart),
    [currentSetListAllItems, effectivePart, playableOnly, setListQuery],
  );

  const allTracksPieces = useMemo(
    () =>
      filterLibraryPieces(pieces, allTracksQuery, null, pieceIdParam, playableOnly, effectivePart),
    [allTracksQuery, effectivePart, pieceIdParam, pieces, playableOnly],
  );

  const allTracksPlaylistItems = useMemo(
    () => singerPiecesToPlaylistItems(allTracksPieces),
    [allTracksPieces],
  );

  const allTracksPlayableCount = useMemo(
    () => pieces.filter((piece) => isPiecePlayableForPart(piece, effectivePart)).length,
    [effectivePart, pieces],
  );

  if (!enabled) return null;

  return (
    <section aria-label="Practice library" className="account-section practice-player">
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {staleEventNotice ? (
        <p className="notice notice--info" role="status">
          {staleEventNotice}
        </p>
      ) : null}

      {!loaded ? <p>Loading learning tracks…</p> : null}

      {loaded && pieces.length === 0 ? (
        <p className="empty-state">No learning tracks are available yet.</p>
      ) : null}

      {loaded && pieces.length > 0 ? (
        <Tabs onValueChange={setActiveTab} value={activeTab}>
          <TabsList
            aria-label="Practice library views"
            as="nav"
            className="ticketing-tabs practice-player__tabs-list"
          >
            <TabsTrigger value="set-lists">Published set lists</TabsTrigger>
            <TabsTrigger value="all-tracks">All tracks</TabsTrigger>
          </TabsList>

          <TabsContent className="grid gap-(--spacing-md) md:gap-(--spacing-lg)" value="set-lists">
            <PublishedSetListsTabContent
              approvedSetLists={approvedSetLists}
              currentSetList={currentSetList}
              effectivePart={effectivePart}
              filteredSetListItems={filteredSetListItems}
              onPlayableOnlyChange={setPlayableOnly}
              onSelectEventId={setSelectedEventId}
              onSetListQueryChange={setSetListQuery}
              onTrackKeyChange={setUserSelectedPart}
              pieceIdParam={pieceIdParam}
              playableOnly={playableOnly}
              setListPlayableCount={setListPlayableCount}
              setListQuery={setListQuery}
              setListTotalMusicCount={currentSetListMusicSelections.length}
              source={source}
            />
          </TabsContent>

          <TabsContent className="grid gap-(--spacing-md) md:gap-(--spacing-lg)" value="all-tracks">
            <AllTracksTabContent
              allTracksPlayableCount={allTracksPlayableCount}
              allTracksPlaylistItems={allTracksPlaylistItems}
              allTracksQuery={allTracksQuery}
              allTracksTotalCount={pieces.length}
              effectivePart={effectivePart}
              onAllTracksQueryChange={setAllTracksQuery}
              onPlayableOnlyChange={setPlayableOnly}
              onTrackKeyChange={setUserSelectedPart}
              pieceIdParam={pieceIdParam}
              playableOnly={playableOnly}
              source={source}
            />
          </TabsContent>
        </Tabs>
      ) : null}
    </section>
  );
}
