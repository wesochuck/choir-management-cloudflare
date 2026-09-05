import { useEffect, useMemo, useState } from "react";

import {
  PlayerHeader,
  PublicPracticePlayer,
  createTokenTrackSource,
  fetchPlayerDetails,
  fetchPublicPlayerPlaylist,
  type PageStatus,
} from "./player";
import { useRosterPart } from "./player/useRosterPart";

export type { PlayerDetails, PlayerPlaylistItem } from "./player";

function classifyOffline(error: unknown): boolean {
  return (
    (typeof navigator !== "undefined" && !navigator.onLine) ||
    (error instanceof Error && error.message === "offline")
  );
}

export function PublicPlayerView() {
  const location = useMemo(
    () => new URLSearchParams(typeof window !== "undefined" ? window.location.search : ""),
    [],
  );
  const token = location.get("token");
  const isSetListPlayer = location.get("mode") === "set-list";
  const [pageStatus, setPageStatus] = useState<PageStatus>({
    type: token ? "loading" : "no_token",
  });
  const rosterPart = useRosterPart();
  const currentToken = token;

  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!currentToken) return;
    let cancelled = false;

    const runFetch = () => {
      const fetchPromise = isSetListPlayer
        ? fetchPublicPlayerPlaylist(currentToken)
        : fetchPlayerDetails(currentToken);

      fetchPromise
        .then((details) => {
          if (!cancelled) {
            setPageStatus({ details, type: "ready" });
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setPageStatus({
              type: classifyOffline(error) ? "offline" : "not_found",
            });
          }
        });
    };

    runFetch();

    const handleOnline = () => {
      setPageStatus({ type: "loading" });
      runFetch();
    };

    // We only listen for "online" here so when connection is restored, we auto-retry.
    // If the browser transitions offline while already "ready", we intentionally do not tear down
    // the UI so playback of already-cached audio can continue uninterrupted without network.
    window.addEventListener("online", handleOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
    };
  }, [currentToken, isSetListPlayer, retryCount]);

  const source = useMemo(() => createTokenTrackSource(token ?? ""), [token]);

  if (pageStatus.type === "no_token") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="player-title" className="auth-card">
          <h1 id="player-title">Player Link Required</h1>
          <p className="notice notice--info" role="status">
            Please use the practice-player link from your Organization.
          </p>
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "loading") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="player-title" className="auth-card">
          <h1 id="player-title">Loading practice player…</h1>
          <p className="notice notice--info" role="status">
            Loading player playlist…
          </p>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "offline") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="player-title" className="auth-card">
          <h1 id="player-title">You Are Offline</h1>
          <p className="notice notice--info" role="status">
            This practice player has not been cached on this device yet. Connect to the internet to
            download it for offline rehearsal.
          </p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              setPageStatus({ type: "loading" });
              setRetryCount((count) => count + 1);
            }}
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "not_found") {
    return (
      <main className="auth-layout">
        <section aria-labelledby="player-title" className="auth-card">
          <h1 id="player-title">Link Not Found</h1>
          <p className="notice notice--error" role="alert">
            This practice-player link is invalid or expired. Ask an Organization manager for a new
            link.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              className="button button--primary"
              onClick={() => {
                setPageStatus({ type: "loading" });
                setRetryCount((count) => count + 1);
              }}
              type="button"
            >
              Try again
            </button>
            <a className="button button--secondary" href="/">
              Return to the Organization site
            </a>
          </div>
        </section>
      </main>
    );
  }

  if (pageStatus.type !== "ready") return null;
  const details = pageStatus.details;

  return (
    <main className="public-player-layout">
      <section aria-labelledby="player-title" className="public-player">
        <PlayerHeader details={details} />
        <PublicPracticePlayer
          details={details}
          initialTrackKey={rosterPart ?? undefined}
          source={source}
        />
      </section>
    </main>
  );
}
