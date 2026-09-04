import type { OrganizationEvent, SingerLearningTrackPiece } from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";

import { AuthApiError, listOrganizationEvents, listSingerLearningTracks } from "../auth/api";
import {
  PublicPracticePlayer,
  createSessionTrackSource,
  type PlayerDetails,
} from "../public/player";
import { useRosterPart } from "../public/player/useRosterPart";
import {
  filterLibraryPieces,
  pieceIdsForEvent,
  singerPiecesToPlaylistItems,
} from "./memberPracticeLibrary";

export function MemberPracticeView({ enabled }: { readonly enabled: boolean }) {
  const params = useMemo(
    () => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
  const eventId = params.get("eventId");
  const pieceId = params.get("pieceId");
  const rosterPart = useRosterPart();
  const source = useMemo(() => createSessionTrackSource(), []);
  const [pieces, setPieces] = useState<readonly SingerLearningTrackPiece[]>([]);
  const [eventTitle, setEventTitle] = useState<string | null>(null);
  const [focusedPieceIds, setFocusedPieceIds] = useState<ReadonlySet<string> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const eventsRequest = eventId
      ? listOrganizationEvents(controller.signal)
      : Promise.resolve<readonly OrganizationEvent[]>([]);
    void Promise.allSettled([listSingerLearningTracks(controller.signal), eventsRequest]).then(
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
        if (eventId && eventsResult.status === "fulfilled") {
          const event = eventsResult.value.find(({ id }) => id === eventId);
          if (event) {
            setEventTitle(event.title);
            setFocusedPieceIds(pieceIdsForEvent(event));
          }
        }
        setLoaded(true);
      },
    );
    return () => {
      controller.abort();
    };
  }, [enabled, eventId]);

  const items = useMemo(
    () => singerPiecesToPlaylistItems(filterLibraryPieces(pieces, query, focusedPieceIds, pieceId)),
    [focusedPieceIds, pieceId, pieces, query],
  );
  const details: PlayerDetails = useMemo(
    () => ({
      eventId: eventId ?? "",
      eventStartsAt: "",
      eventTitle: eventTitle ?? "Practice library",
      items,
    }),
    [eventId, eventTitle, items],
  );

  if (!enabled) return null;
  const title = eventTitle ? `Practice player · ${eventTitle}` : "Practice player";
  return (
    <section className="account-section practice-player" aria-label={title}>
      {eventTitle ? (
        <p className="notice notice--info" role="status">
          Showing practice tracks for <strong>{eventTitle}</strong>.
        </p>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {!loaded ? <p>Loading learning tracks…</p> : null}
      {loaded && pieces.length === 0 ? (
        <p className="empty-state">No learning tracks are available yet.</p>
      ) : null}
      {loaded && pieces.length > 0 ? (
        <>
          <div className="practice-player__filters">
            <label className="field">
              Search tracks
              <input
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Search title or composer"
                type="search"
                value={query}
              />
            </label>
          </div>
          {items.length === 0 ? (
            <p className="empty-state">No tracks match the current search.</p>
          ) : (
            <PublicPracticePlayer
              details={details}
              initialTrackKey={rosterPart ?? undefined}
              source={source}
            />
          )}
        </>
      ) : null}
    </section>
  );
}
