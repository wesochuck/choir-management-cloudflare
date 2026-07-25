import { useEffect, useState } from "react";

interface PlayerPlaylistItem {
  readonly arranger?: string;
  readonly composer?: string;
  readonly durationSeconds?: number;
  readonly isFeaturedNumber?: boolean;
  readonly notes?: string;
  readonly pieceId?: string;
  readonly title: string;
  readonly trackFileIds: Record<string, string>;
}

interface PlayerDetails {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventStartsAt: string;
  readonly items: PlayerPlaylistItem[];
  readonly profileId: string;
  readonly profileName: string;
}

type PageStatus =
  | { type: "loading" }
  | { type: "no_token" }
  | { type: "not_found" }
  | { type: "ready"; details: PlayerDetails }
  | { type: "error" };

function isPlayerDetails(value: unknown): value is PlayerDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    "eventTitle" in value &&
    "items" in value &&
    "profileName" in value &&
    "eventId" in value
  );
}

function fetchPlayerDetails(token: string): Promise<PlayerDetails> {
  return fetch("/api/public/player-details", {
    body: JSON.stringify({ token }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then((response) => {
    if (!response.ok) throw new Error("not_found");
    return response.json().then((data: unknown) => {
      if (isPlayerDetails(data)) return data;
      throw new Error("invalid_response");
    });
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m)}:${s.toString().padStart(2, "0")}`;
}

function TrackPlayer({
  fileId,
  token,
  trackLabel,
}: {
  readonly fileId: string;
  readonly token: string;
  readonly trackLabel: string;
}) {
  const [playing, setPlaying] = useState(false);
  const audioUrl = `/api/public/player/media/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`;

  return (
    <div className="flex items-center gap-2">
      <audio
        className="flex-1"
        controls
        onPlay={() => {
          setPlaying(true);
        }}
        onPause={() => {
          setPlaying(false);
        }}
        preload="none"
        src={audioUrl}
      >
        <track kind="captions" label={trackLabel} src="" />
      </audio>
      {playing && <span className="text-xs text-muted-foreground">Playing</span>}
    </div>
  );
}

function PlaylistItemHeader({ item }: { readonly item: PlayerPlaylistItem }) {
  return (
    <div className="min-w-0 flex-1">
      <h3 className="font-semibold">{item.title}</h3>
      {(item.composer ?? item.arranger) && (
        <p className="text-sm text-muted-foreground">
          {item.composer && <span>{item.composer}</span>}
          {item.composer && item.arranger && <span> &middot; </span>}
          {item.arranger && <span>arr. {item.arranger}</span>}
        </p>
      )}
      {item.durationSeconds !== undefined && (
        <p className="text-xs text-muted-foreground">{formatDuration(item.durationSeconds)}</p>
      )}
      {item.isFeaturedNumber && (
        <p className="mt-1 text-xs font-medium text-primary">Featured Number</p>
      )}
    </div>
  );
}

function PlaylistItem({
  item,
  token,
}: {
  readonly item: PlayerPlaylistItem;
  readonly token: string;
}) {
  const trackEntries = Object.entries(item.trackFileIds);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border p-4">
      <div className="flex items-start justify-between gap-4">
        <PlaylistItemHeader item={item} />
        {trackEntries.length > 0 && (
          <button
            className="button button--secondary button--small shrink-0"
            onClick={() => {
              setExpanded(!expanded);
            }}
            type="button"
          >
            {expanded
              ? "Hide tracks"
              : `${String(trackEntries.length)} track${trackEntries.length > 1 ? "s" : ""}`}
          </button>
        )}
      </div>

      {item.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{item.notes}</p>}

      {expanded && trackEntries.length > 0 && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {trackEntries.map(([trackLabel, fileId]) => (
            <TrackPlayer fileId={fileId} key={fileId} token={token} trackLabel={trackLabel} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PublicPlayerView() {
  const token = new URLSearchParams(window.location.search).get("token");
  const [pageStatus, setPageStatus] = useState<PageStatus>({
    type: token ? "loading" : "no_token",
  });

  useEffect(() => {
    window.history.replaceState(null, "", "/player");
    if (!token) return;
    fetchPlayerDetails(token)
      .then((details) => {
        setPageStatus({ type: "ready", details });
      })
      .catch(() => {
        setPageStatus({ type: "not_found" });
      });
  }, [token]);

  if (pageStatus.type === "no_token") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="player-title">
          <h1 id="player-title">Player Link Required</h1>
          <p className="notice notice--info" role="status">
            Please use the link from your email to access the player.
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
        <section className="auth-card" aria-labelledby="player-title">
          <h1 id="player-title">Loading Player...</h1>
        </section>
      </main>
    );
  }

  if (pageStatus.type === "not_found") {
    return (
      <main className="auth-layout">
        <section className="auth-card" aria-labelledby="player-title">
          <h1 id="player-title">Link Not Found</h1>
          <p className="notice notice--error" role="alert">
            This player link is invalid or expired. Contact an Organization manager for a new link.
          </p>
          <a className="button button--secondary" href="/">
            Return to the Organization site
          </a>
        </section>
      </main>
    );
  }

  if (pageStatus.type !== "ready") {
    return null;
  }
  const details = pageStatus.details;

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="player-title">
        <p className="eyebrow">Player</p>
        <h1 id="player-title">{details.eventTitle}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(details.eventStartsAt)} at {formatTime(details.eventStartsAt)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome, <strong>{details.profileName}</strong>.
        </p>

        <hr className="my-4" />

        {details.items.length === 0 ? (
          <p className="notice notice--info" role="status">
            No music has been assigned to this event yet.
          </p>
        ) : (
          <div className="space-y-3">
            {details.items.map((item, index) => (
              <PlaylistItem item={item} key={index} token={token ?? ""} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
