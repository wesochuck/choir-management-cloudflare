import { useEffect, useMemo, useState } from "react";

import {
  PlayerHeader,
  PublicPracticePlayer,
  createTokenTrackSource,
  fetchPlayerDetails,
  fetchPublicPlayerPlaylist,
  type PageStatus,
} from "./player";

export type { PlayerDetails, PlayerPlaylistItem } from "./player";

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

  useEffect(() => {
    if (!token) return;
    const load = isSetListPlayer ? fetchPublicPlayerPlaylist(token) : fetchPlayerDetails(token);
    void load
      .then((details) => {
        setPageStatus({ details, type: "ready" });
      })
      .catch(() => {
        setPageStatus({ type: "not_found" });
      });
  }, [isSetListPlayer, token]);

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
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
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
        <PublicPracticePlayer details={details} source={source} />
      </section>
    </main>
  );
}
