import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "@choir/ui";
import { getPublicPlayerDetails, getPublicPlayerPlaylist } from "../api";
import { formatVoicePartName, sortVoiceParts } from "./playerVoiceParts";

declare global {
  interface Navigator {
    readonly audioSession?: {
      type: string;
    };
  }
}

export interface PlayerPlaylistItem {
  readonly arranger?: string | null | undefined;
  readonly composer?: string | null | undefined;
  readonly durationSeconds?: number | null | undefined;
  readonly isFeaturedNumber?: boolean | null | undefined;
  readonly notes?: string | null | undefined;
  readonly pieceId?: string | null | undefined;
  readonly title: string;
  readonly trackFileIds: Record<string, string>;
}

export interface PlayerDetails {
  readonly eventArtworkFileId?: string | null | undefined;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventStartsAt: string;
  readonly items: PlayerPlaylistItem[];
  readonly organizationName?: string | undefined;
  readonly performerLabel?: string | undefined;
  readonly profileName?: string | undefined;
}

interface ResolvedTrack {
  readonly fallback: boolean;
  readonly fileId: string;
  readonly key: string;
}

type PageStatus =
  | { readonly type: "loading" }
  | { readonly type: "no_token" }
  | { readonly type: "not_found" }
  | { readonly type: "ready"; readonly details: PlayerDetails }
  | { readonly type: "error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "number";
}

function isNullableBoolean(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "boolean";
}

function isPlayerPlaylistItem(value: unknown): value is PlayerPlaylistItem {
  if (!isRecord(value) || typeof value.title !== "string") {
    return false;
  }
  const trackFileIds = value.trackFileIds ?? {};
  if (!isStringRecord(trackFileIds)) {
    return false;
  }
  return (
    isNullableString(value.arranger) &&
    isNullableString(value.composer) &&
    isNullableNumber(value.durationSeconds) &&
    isNullableBoolean(value.isFeaturedNumber) &&
    isNullableString(value.notes) &&
    isNullableString(value.pieceId)
  );
}

function isPlayerDetails(value: unknown): value is PlayerDetails {
  return (
    isRecord(value) &&
    isNullableString(value.eventArtworkFileId) &&
    typeof value.eventId === "string" &&
    typeof value.eventTitle === "string" &&
    typeof value.eventStartsAt === "string" &&
    Array.isArray(value.items) &&
    value.items.every(isPlayerPlaylistItem) &&
    isNullableString(value.organizationName) &&
    isNullableString(value.performerLabel) &&
    isNullableString(value.profileName)
  );
}

async function fetchPlayerDetails(token: string): Promise<PlayerDetails> {
  try {
    const data = await getPublicPlayerDetails(token);
    if (!isPlayerDetails(data)) throw new Error("invalid_response");
    return {
      eventArtworkFileId:
        typeof data.eventArtworkFileId === "string" ? data.eventArtworkFileId : null,
      eventId: data.eventId,
      eventTitle: data.eventTitle,
      eventStartsAt: data.eventStartsAt,
      items: data.items.map((item) => ({
        arranger: typeof item.arranger === "string" ? item.arranger : undefined,
        composer: typeof item.composer === "string" ? item.composer : undefined,
        durationSeconds:
          typeof item.durationSeconds === "number" ? item.durationSeconds : undefined,
        isFeaturedNumber:
          typeof item.isFeaturedNumber === "boolean" ? item.isFeaturedNumber : undefined,
        notes: typeof item.notes === "string" ? item.notes : undefined,
        pieceId: typeof item.pieceId === "string" ? item.pieceId : undefined,
        title: item.title,
        trackFileIds: isStringRecord(item.trackFileIds) ? item.trackFileIds : {},
      })),
      organizationName:
        typeof data.organizationName === "string" ? data.organizationName : undefined,
      performerLabel: typeof data.performerLabel === "string" ? data.performerLabel : "Performer",
      profileName: typeof data.profileName === "string" ? data.profileName : undefined,
    };
  } catch {
    throw new Error("not_found");
  }
}

async function fetchPublicPlayerPlaylist(token: string): Promise<PlayerDetails> {
  try {
    const data = await getPublicPlayerPlaylist(token);
    if (!isRecord(data) || !isRecord(data.event) || !Array.isArray(data.pieces)) {
      throw new Error("invalid_response");
    }
    const { event } = data;
    if (
      typeof event.id !== "string" ||
      typeof event.title !== "string" ||
      typeof event.date !== "string" ||
      !data.pieces.every(isPlayerPlaylistItem)
    ) {
      throw new Error("invalid_response");
    }
    return {
      eventArtworkFileId: typeof event.artworkFileId === "string" ? event.artworkFileId : null,
      eventId: event.id,
      eventTitle: event.title,
      eventStartsAt: event.date,
      items: data.pieces.map((item) => ({
        arranger: typeof item.arranger === "string" ? item.arranger : undefined,
        composer: typeof item.composer === "string" ? item.composer : undefined,
        durationSeconds:
          typeof item.durationSeconds === "number" ? item.durationSeconds : undefined,
        isFeaturedNumber:
          typeof item.isFeaturedNumber === "boolean" ? item.isFeaturedNumber : undefined,
        notes: typeof item.notes === "string" ? item.notes : undefined,
        pieceId: typeof item.pieceId === "string" ? item.pieceId : undefined,
        title: item.title,
        trackFileIds: isStringRecord(item.trackFileIds) ? item.trackFileIds : {},
      })),
      organizationName:
        typeof data.organizationName === "string" ? data.organizationName : undefined,
      performerLabel: typeof data.performerLabel === "string" ? data.performerLabel : "Performer",
    };
  } catch {
    throw new Error("not_found");
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  });
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const wholeSeconds = Math.floor(seconds);
  return `${String(Math.floor(wholeSeconds / 60))}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function formatTrackKey(key: string): string {
  if (key === "tutti") return "Tutti";
  return key.toUpperCase();
}

function availableTrackKeys(items: readonly PlayerPlaylistItem[]): string[] {
  const keys = new Set(items.flatMap((item) => Object.keys(item.trackFileIds)));
  return [...keys].sort((left, right) => {
    if (left === right) return 0;
    if (left === "tutti") return -1;
    if (right === "tutti") return 1;
    return left.localeCompare(right);
  });
}

function resolveTrack(item: PlayerPlaylistItem, requestedKey: string): ResolvedTrack | null {
  const requestedFileId = item.trackFileIds[requestedKey];
  if (requestedFileId) {
    return { fallback: false, fileId: requestedFileId, key: requestedKey };
  }
  const tuttiFileId = item.trackFileIds.tutti;
  if (tuttiFileId) {
    return { fallback: requestedKey !== "tutti", fileId: tuttiFileId, key: "tutti" };
  }
  return null;
}

function playerMediaUrl(fileId: string, token: string): string {
  return `/api/public/player/media/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`;
}

export function PlayerHeader({ details }: { readonly details: PlayerDetails }) {
  return (
    <header className="public-player__header">
      <h1 id="player-title">{details.eventTitle}</h1>
      <p>{formatDate(details.eventStartsAt)}</p>
      {details.profileName ? <p>Welcome, {details.profileName}.</p> : null}
    </header>
  );
}

export function PlayerArtwork({
  artworkUrl,
  eventTitle,
}: {
  readonly artworkUrl: string | null;
  readonly eventTitle: string;
}) {
  const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(null);
  const isImageValid = Boolean(artworkUrl && failedArtworkUrl !== artworkUrl);

  return (
    <div className="public-player__artwork-container">
      {isImageValid && artworkUrl ? (
        <img
          alt={`${eventTitle} artwork`}
          className="public-player__artwork"
          onError={() => {
            setFailedArtworkUrl(artworkUrl);
          }}
          src={artworkUrl}
        />
      ) : (
        <div
          aria-hidden="true"
          className="public-player__artwork public-player__artwork--placeholder"
        >
          <svg
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}
    </div>
  );
}

export function PlayerTrackMetadata({
  activeTrackKey,
  currentTrack,
  item,
}: {
  readonly activeTrackKey: string;
  readonly currentTrack: ResolvedTrack;
  readonly item: PlayerPlaylistItem;
}) {
  return (
    <div className="public-player__metadata">
      <div className="public-player__metadata-header">
        <h2 id="public-player-now-playing">{item.title}</h2>
        <span className="public-player__track-badge">{formatTrackKey(currentTrack.key)}</span>
      </div>
      {item.composer || item.arranger ? (
        <p className="public-player__artist">
          {item.composer ?? ""}
          {item.composer && item.arranger
            ? ` / arr. ${item.arranger}`
            : item.arranger
              ? `arr. ${item.arranger}`
              : ""}
        </p>
      ) : null}
      {currentTrack.fallback ? (
        <p className="notice notice--info public-player__fallback-status" role="status">
          Playing Tutti — {formatTrackKey(activeTrackKey)} track unavailable
        </p>
      ) : null}
    </div>
  );
}

export function PlayerPartSelector({
  activeTrackKey,
  defaultOpen = false,
  onSelectTrackKey,
  trackKeys,
  voicePartKeys,
}: {
  readonly activeTrackKey: string;
  readonly defaultOpen?: boolean;
  readonly onSelectTrackKey: (key: string) => void;
  readonly trackKeys: readonly string[];
  readonly voicePartKeys?: readonly string[] | undefined;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedOptionRef = useRef<HTMLButtonElement | null>(null);

  const allKeys = useMemo(() => {
    const combined = new Set([...trackKeys, ...(voicePartKeys ?? [])]);
    return sortVoiceParts([...combined]);
  }, [trackKeys, voicePartKeys]);

  useEffect(() => {
    if (isOpen) {
      selectedOptionRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleClose = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="public-player__part-selector-container">
      <button
        aria-controls="voice-part-sheet"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="public-player__part-trigger"
        onClick={() => {
          setIsOpen((prev) => !prev);
        }}
        ref={triggerRef}
        type="button"
      >
        <span className="public-player__part-trigger-lead">
          <svg
            aria-hidden="true"
            className="public-player__part-trigger-icon"
            fill="none"
            height="18"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="18"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span className="public-player__part-trigger-label">Voice Part</span>
        </span>
        <span className="public-player__part-trigger-value">
          <span>{formatVoicePartName(activeTrackKey)}</span>
          <svg
            aria-hidden="true"
            className={`public-player__part-trigger-chevron ${isOpen ? "is-open" : ""}`}
            fill="none"
            height="16"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="16"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {isOpen ? (
        <div
          aria-labelledby="choose-voice-part-title"
          aria-modal="true"
          className="public-player__part-sheet-backdrop"
          id="voice-part-sheet"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleClose();
            }
          }}
          role="dialog"
        >
          <div className="public-player__part-sheet">
            <div aria-hidden="true" className="public-player__part-sheet-handle" />
            <div className="public-player__part-sheet-header">
              <h3 id="choose-voice-part-title">Choose Voice Part</h3>
              <button
                aria-label="Close voice part selector"
                className="public-player__part-sheet-close"
                onClick={handleClose}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="18"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="18"
                >
                  <line x1="18" x2="6" y1="6" y2="18" />
                  <line x1="6" x2="18" y1="6" y2="18" />
                </svg>
              </button>
            </div>
            <div
              aria-labelledby="choose-voice-part-title"
              className="public-player__part-options"
              role="radiogroup"
            >
              {allKeys.map((key) => {
                const isSelected = activeTrackKey === key;
                return (
                  <button
                    aria-checked={isSelected}
                    className={`public-player__part-option ${isSelected ? "is-selected" : ""}`}
                    key={key}
                    onClick={() => {
                      onSelectTrackKey(key);
                      setIsOpen(false);
                      triggerRef.current?.focus();
                    }}
                    ref={isSelected ? selectedOptionRef : undefined}
                    role="radio"
                    type="button"
                  >
                    <span aria-hidden="true" className="public-player__part-option-radio">
                      {isSelected ? (
                        <span className="public-player__part-option-radio-dot" />
                      ) : null}
                    </span>
                    <span className="public-player__part-option-label">
                      {formatVoicePartName(key)}
                    </span>
                    {isSelected ? (
                      <svg
                        aria-hidden="true"
                        className="public-player__part-option-check"
                        fill="none"
                        height="18"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2.5"
                        viewBox="0 0 24 24"
                        width="18"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PlayerProgress({
  currentTime,
  duration,
  onSeek,
  title,
}: {
  readonly currentTime: number;
  readonly duration: number;
  readonly onSeek: (nextTime: number) => void;
  readonly title: string;
}) {
  return (
    <div className="public-player__progress">
      <input
        aria-label={`Seek ${title}`}
        aria-valuemax={Math.round(duration)}
        aria-valuemin={0}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
        max={duration || 1}
        min={0}
        onChange={(event) => {
          onSeek(Number(event.target.value));
        }}
        step={0.1}
        type="range"
        value={Math.min(currentTime, duration || 0)}
      />
      <div className="public-player__progress-times">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

export function PlayerTransport({
  currentIndex,
  loopMode,
  onNext,
  onPrevious,
  onTogglePlay,
  playableCount,
  playing,
}: {
  readonly currentIndex: number;
  readonly loopMode: "all" | "none" | "one";
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onTogglePlay: () => void;
  readonly playableCount: number;
  readonly playing: boolean;
}) {
  return (
    <div className="public-player__transport">
      <button
        aria-label="Previous track"
        className="button button--secondary public-player__transport-btn"
        disabled={currentIndex <= 0 && loopMode !== "all"}
        onClick={onPrevious}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="24"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="24"
        >
          <polygon points="19 20 9 12 19 4 19 20" />
          <line x1="5" x2="5" y1="19" y2="5" />
        </svg>
        <span className="sr-only">Previous track</span>
      </button>
      <button
        aria-label={playing ? "Pause" : "Play"}
        className="button button--primary public-player__play"
        onClick={onTogglePlay}
        type="button"
      >
        {playing ? (
          <svg aria-hidden="true" fill="currentColor" height="24" viewBox="0 0 24 24" width="24">
            <rect height="16" rx="1.5" width="4.5" x="5" y="4" />
            <rect height="16" rx="1.5" width="4.5" x="14.5" y="4" />
          </svg>
        ) : (
          <svg aria-hidden="true" fill="currentColor" height="24" viewBox="0 0 24 24" width="24">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        )}
        <span>{playing ? "Pause" : "Play"}</span>
      </button>
      <button
        aria-label="Next track"
        className="button button--secondary public-player__transport-btn"
        disabled={currentIndex >= playableCount - 1 && loopMode !== "all"}
        onClick={onNext}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="24"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="24"
        >
          <polygon points="5 4 15 12 5 20 5 4" />
          <line x1="19" x2="19" y1="5" y2="19" />
        </svg>
        <span className="sr-only">Next track</span>
      </button>
    </div>
  );
}

export function PlayerSecondaryControls({
  loopMode,
  onOpenQueue,
  onOpenSettings,
  onToggleLoop,
  queueButtonRef,
  queueCount,
  settingsButtonRef,
}: {
  readonly loopMode: "all" | "none" | "one";
  readonly onOpenQueue: () => void;
  readonly onOpenSettings: () => void;
  readonly onToggleLoop: () => void;
  readonly queueButtonRef?: React.RefObject<HTMLButtonElement | null>;
  readonly queueCount: number;
  readonly settingsButtonRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const repeatLabel =
    loopMode === "none" ? "No repeat" : loopMode === "all" ? "Repeat all" : "Repeat one";

  return (
    <div className="public-player__secondary-controls">
      <button
        aria-label={repeatLabel}
        aria-pressed={loopMode !== "none"}
        className="public-player__repeat"
        onClick={onToggleLoop}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <polyline points="17 1 21 5 17 9" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
        <span>{repeatLabel}</span>
      </button>

      <button
        aria-label={`Set list (${String(queueCount)} tracks)`}
        className="public-player__secondary-btn"
        onClick={onOpenQueue}
        ref={queueButtonRef}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <line x1="8" x2="21" y1="6" y2="6" />
          <line x1="8" x2="21" y1="12" y2="12" />
          <line x1="8" x2="21" y1="18" y2="18" />
          <line x1="3" x2="3.01" y1="6" y2="6" />
          <line x1="3" x2="3.01" y1="12" y2="12" />
          <line x1="3" x2="3.01" y1="18" y2="18" />
        </svg>
        <span>Set List ({String(queueCount)})</span>
      </button>

      <button
        aria-label="Rehearsal settings"
        className="public-player__secondary-btn"
        onClick={onOpenSettings}
        ref={settingsButtonRef}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span>Settings</span>
      </button>
    </div>
  );
}

export function PlayerRehearsalOptions({
  countdown,
  currentTrackFileId,
  gapSeconds,
  onChangeGapSeconds,
  onChangeStartAt,
  onChangeVolume,
  onToggleGuide,
  showGuide,
  showVolume = true,
  startAt,
  token,
  volume = 100,
}: {
  readonly countdown: number | null;
  readonly currentTrackFileId?: string;
  readonly gapSeconds: number;
  readonly onChangeGapSeconds: (gap: number) => void;
  readonly onChangeStartAt: (start: string) => void;
  readonly onChangeVolume?: (volume: number) => void;
  readonly onToggleGuide?: () => void;
  readonly showGuide?: boolean;
  readonly showVolume?: boolean;
  readonly startAt: number;
  readonly token?: string;
  readonly volume?: number;
}) {
  return (
    <div className="public-player__options-container">
      <div className="public-player__options">
        <label className="public-player__option">
          <span>Start track at</span>
          <span className="public-player__inline-input">
            <input
              inputMode="decimal"
              min={0}
              onChange={(event) => {
                onChangeStartAt(event.target.value);
              }}
              step={1}
              type="number"
              value={startAt}
            />
            <small>seconds</small>
          </span>
          <small>Skips the beginning of this track every time you play it.</small>
        </label>
        {showVolume && onChangeVolume ? (
          <label className="public-player__option">
            <span className="public-player__option-heading">
              <span>Volume</span>
              <small>{String(volume)}%</small>
            </span>
            <input
              aria-label="Volume"
              max={100}
              min={0}
              onChange={(event) => {
                onChangeVolume(Number(event.target.value));
              }}
              type="range"
              value={volume}
            />
          </label>
        ) : null}
        <label className="public-player__option">
          <span>Gap between tracks</span>
          <select
            aria-label="Gap between tracks"
            onChange={(event) => {
              onChangeGapSeconds(Number(event.target.value));
            }}
            value={gapSeconds}
          >
            <option value={0}>None</option>
            <option value={2}>2 seconds</option>
            <option value={5}>5 seconds</option>
            <option value={10}>10 seconds</option>
          </select>
          <small>Adds silence before the next track starts.</small>
        </label>

        {currentTrackFileId && token ? (
          <div className="public-player__download-action">
            <a
              className="button button--secondary public-player__full-width-btn"
              download
              href={playerMediaUrl(currentTrackFileId, token)}
            >
              Download Current Track
            </a>
          </div>
        ) : null}
      </div>

      {countdown !== null ? (
        <p className="notice notice--info" role="status">
          Next track starts in {countdown} seconds.
        </p>
      ) : null}

      {onToggleGuide !== undefined ? (
        <button
          aria-expanded={showGuide}
          className="public-player__guide-toggle"
          onClick={onToggleGuide}
          type="button"
        >
          {showGuide ? "Hide control guide" : "Show control guide"}
        </button>
      ) : null}

      {showGuide ? (
        <div className="public-player__guide">
          <div>
            <strong>Start track at</strong>
            <span>Skips the beginning of this track every time you play it.</span>
          </div>
          <div>
            <strong>Gap between tracks</strong>
            <span>Adds silence before the next track starts.</span>
          </div>
          <div>
            <strong>Repeat</strong>
            <span>Choose whether to stop, repeat the set list, or repeat one track.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PlayerSetList({
  activeTrackKey,
  currentIndex,
  items,
  onSelectItem,
  playableItems,
  token,
}: {
  readonly activeTrackKey: string;
  readonly currentIndex: number;
  readonly items: readonly PlayerPlaylistItem[];
  readonly onSelectItem: (itemIndex: number) => void;
  readonly playableItems: readonly PlayerPlaylistItem[];
  readonly token: string;
}) {
  return (
    <section aria-labelledby="public-player-set-list" className="public-player__set-list">
      <div className="public-player__set-list-heading">
        <div>
          <h2 id="public-player-set-list">Set List</h2>
          <p>{String(items.length)} tracks</p>
        </div>
      </div>
      <p className="public-player__set-list-help">
        Choose a track to start practicing. Part and section tracks fall back to Tutti when a
        specific recording is not available.
      </p>
      <ol className="public-player__queue-list">
        {items.map((item, index) => {
          const track = resolveTrack(item, activeTrackKey);
          const itemIndex = playableItems.indexOf(item);
          const active = itemIndex === currentIndex && currentIndex !== -1;
          return (
            <li
              className={active ? "is-active" : undefined}
              key={item.pieceId ?? `${item.title}-${String(index)}`}
            >
              <button
                className="public-player__set-list-item"
                disabled={track === null}
                onClick={() => {
                  onSelectItem(itemIndex);
                }}
                type="button"
              >
                <span className="public-player__set-list-item-main">
                  <strong>{item.title}</strong>
                  {item.composer ? <small>{item.composer}</small> : null}
                </span>
                <span className="public-player__set-list-item-status">
                  {active ? (
                    <span className="public-player__now-playing-pill">Now Playing</span>
                  ) : null}
                  {track ? (
                    <span className="public-player__item-track">
                      {track.fallback ? "Tutti fallback" : formatTrackKey(track.key)}
                    </span>
                  ) : (
                    <span className="public-player__item-track public-player__item-track--unavailable">
                      Unavailable
                    </span>
                  )}
                </span>
              </button>
              {track ? (
                <a
                  aria-label={`Download ${item.title}`}
                  className="button button--secondary button--small public-player__download-btn"
                  download
                  href={playerMediaUrl(track.fileId, token)}
                >
                  Download
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function updateMediaSessionPosition(
  currentTime: number,
  duration: number,
  audio: HTMLAudioElement | null,
): void {
  if (
    "mediaSession" in navigator &&
    typeof navigator.mediaSession.setPositionState === "function" &&
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(currentTime) &&
    currentTime >= 0 &&
    currentTime <= duration
  ) {
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: audio?.playbackRate ?? 1,
        position: currentTime,
      });
    } catch {
      // Gracefully ignore position sync errors
    }
  }
}

export function PublicPracticePlayer({
  details,
  token,
}: {
  readonly details: PlayerDetails;
  readonly token: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoplayRef = useRef(false);
  const gapTimerRef = useRef<number | null>(null);
  const queueButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);

  const [selectedTrackKey, setSelectedTrackKey] = useState("tutti");
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startAt, setStartAt] = useState(0);
  const [volume, setVolume] = useState(100);
  const [gapSeconds, setGapSeconds] = useState(0);
  const [loopMode, setLoopMode] = useState<"all" | "none" | "one">("none");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showGuide, setShowGuide] = useState(true);
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const allTrackKeys = useMemo(() => availableTrackKeys(details.items), [details.items]);
  const activeTrackKey = allTrackKeys.includes(selectedTrackKey)
    ? selectedTrackKey
    : (allTrackKeys[0] ?? "tutti");
  const playableItems = useMemo(
    () => details.items.filter((item) => resolveTrack(item, activeTrackKey) !== null),
    [activeTrackKey, details.items],
  );
  const safeSelectedItemIndex = Math.min(selectedItemIndex, Math.max(playableItems.length - 1, 0));
  const currentItem = playableItems[safeSelectedItemIndex] ?? null;
  const currentTrack = currentItem ? resolveTrack(currentItem, activeTrackKey) : null;
  const currentIndex = currentItem ? playableItems.indexOf(currentItem) : -1;
  const source = currentTrack ? playerMediaUrl(currentTrack.fileId, token) : "";
  const eventArtworkUrl = details.eventArtworkFileId
    ? playerMediaUrl(details.eventArtworkFileId, token)
    : null;

  useEffect(() => {
    if ("audioSession" in navigator) {
      try {
        navigator.audioSession.type = "playback";
      } catch {
        // Non-blocking fallback
      }
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
    setCurrentTime(0);
    setDuration(0);
  }, [source]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  useEffect(() => {
    return () => {
      if (gapTimerRef.current !== null) window.clearInterval(gapTimerRef.current);
    };
  }, []);

  function playCurrent(): void {
    void audioRef.current?.play().then(
      () => {
        setPlaying(true);
      },
      () => {
        setPlaying(false);
      },
    );
  }

  function selectItem(index: number, autoplay = true): void {
    if (index < 0 || index >= playableItems.length) return;
    if (gapTimerRef.current !== null) {
      window.clearInterval(gapTimerRef.current);
      gapTimerRef.current = null;
    }
    autoplayRef.current = autoplay;
    setSelectedItemIndex(index);
    setPlaying(autoplay);
    setCountdown(null);
  }

  function selectTrackKey(key: string): void {
    if (key === selectedTrackKey) return;
    autoplayRef.current = playing;
    setSelectedTrackKey(key);
    setSelectedItemIndex(0);
    setCountdown(null);
  }

  function nextTrack(): void {
    if (currentIndex < playableItems.length - 1) {
      selectItem(currentIndex + 1);
    } else if (loopMode === "all" && playableItems.length > 0) {
      selectItem(0);
    }
  }

  function previousTrack(): void {
    if (currentIndex > 0) {
      selectItem(currentIndex - 1, false);
    } else if (loopMode === "all" && playableItems.length > 0) {
      selectItem(playableItems.length - 1, false);
    }
  }

  function startNextTrack(): void {
    if (gapSeconds === 0 || document.visibilityState === "hidden") {
      nextTrack();
      return;
    }
    setPlaying(false);
    setCountdown(gapSeconds);
    let remaining = gapSeconds;
    gapTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (gapTimerRef.current !== null) window.clearInterval(gapTimerRef.current);
        gapTimerRef.current = null;
        setCountdown(null);
        nextTrack();
      } else {
        setCountdown(remaining);
      }
    }, 1_000);
  }

  function handleEnded(): void {
    if (loopMode === "one") {
      if (audioRef.current) {
        audioRef.current.currentTime = startAt;
        playCurrent();
      }
      return;
    }
    if (currentIndex >= playableItems.length - 1 && loopMode !== "all") {
      setPlaying(false);
      return;
    }
    startNextTrack();
  }

  function togglePlay(): void {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }
    playCurrent();
  }

  function updateStartAt(value: string): void {
    const next = Math.max(0, Number(value) || 0);
    setStartAt(next);
    if (audioRef.current && duration > 0) {
      audioRef.current.currentTime = Math.min(next, duration);
      setCurrentTime(Math.min(next, duration));
    }
  }

  function handleSeek(nextTime: number): void {
    const bounded = Math.max(0, Math.min(nextTime, duration || 0));
    setCurrentTime(bounded);
    if (audioRef.current) {
      audioRef.current.currentTime = bounded;
    }
    updateMediaSessionPosition(bounded, duration, audioRef.current);
  }

  function seekRelative(deltaSeconds: number): void {
    const nextTime = Math.max(0, Math.min(currentTime + deltaSeconds, duration || 0));
    handleSeek(nextTime);
  }

  // Media Session Updates
  useEffect(() => {
    if (!currentItem || !("mediaSession" in navigator)) return;
    try {
      const artwork = eventArtworkUrl
        ? [{ sizes: "512x512", src: eventArtworkUrl, type: "image/jpeg" }]
        : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        album: details.eventTitle,
        artist: currentItem.composer ?? currentItem.arranger ?? details.performerLabel ?? "",
        artwork,
        title: currentItem.title,
      });
    } catch {
      // Non-blocking MediaSession error
    }
  }, [currentItem, details.eventTitle, details.performerLabel, eventArtworkUrl]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }
  }, [playing]);

  const playRef = useRef(playCurrent);
  const togglePlayRef = useRef(togglePlay);
  const nextTrackRef = useRef(nextTrack);
  const prevTrackRef = useRef(previousTrack);
  const seekRelativeRef = useRef(seekRelative);
  const handleSeekRef = useRef(handleSeek);

  useEffect(() => {
    playRef.current = playCurrent;
    togglePlayRef.current = togglePlay;
    nextTrackRef.current = nextTrack;
    prevTrackRef.current = previousTrack;
    seekRelativeRef.current = seekRelative;
    handleSeekRef.current = handleSeek;
  });

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const actionMap: [MediaSessionAction, (details: MediaSessionActionDetails) => void][] = [
      [
        "play",
        () => {
          playRef.current();
        },
      ],
      [
        "pause",
        () => {
          togglePlayRef.current();
        },
      ],
      [
        "previoustrack",
        () => {
          prevTrackRef.current();
        },
      ],
      [
        "nexttrack",
        () => {
          nextTrackRef.current();
        },
      ],
      [
        "seekbackward",
        (actDetails) => {
          seekRelativeRef.current(-(actDetails.seekOffset ?? 10));
        },
      ],
      [
        "seekforward",
        (actDetails) => {
          seekRelativeRef.current(actDetails.seekOffset ?? 10);
        },
      ],
      [
        "seekto",
        (actDetails) => {
          if (typeof actDetails.seekTime === "number") {
            handleSeekRef.current(actDetails.seekTime);
          }
        },
      ],
    ];

    for (const [action, handler] of actionMap) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Ignore unsupported action types
      }
    }

    return () => {
      for (const [action] of actionMap) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore errors during cleanup
        }
      }
    };
  }, []);

  if (!currentItem || !currentTrack) {
    return (
      <div className="public-player__container">
        <PlayerPartSelector
          activeTrackKey={activeTrackKey}
          onSelectTrackKey={selectTrackKey}
          trackKeys={allTrackKeys}
        />
        <p className="public-player__empty" role="status">
          No practice tracks are available for this set list yet.
        </p>
      </div>
    );
  }

  return (
    <div className="public-player__layout-grid">
      {/* Hidden Persistent Audio Element */}
      <audio
        aria-label={`${currentItem.title} ${formatTrackKey(currentTrack.key)} track`}
        className="public-player__audio"
        onEnded={handleEnded}
        onLoadedMetadata={(event) => {
          const nextDuration = Number.isFinite(event.currentTarget.duration)
            ? event.currentTarget.duration
            : 0;
          const initialTime = Math.min(startAt, nextDuration);
          setDuration(nextDuration);
          setCurrentTime(initialTime);
          event.currentTarget.currentTime = initialTime;
          updateMediaSessionPosition(initialTime, nextDuration, event.currentTarget);
          if (autoplayRef.current || playing) {
            autoplayRef.current = false;
            playCurrent();
          }
        }}
        onPause={() => {
          setPlaying(false);
        }}
        onPlay={() => {
          setPlaying(true);
        }}
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime;
          setCurrentTime(time);
          updateMediaSessionPosition(time, duration, event.currentTarget);
        }}
        preload="metadata"
        ref={audioRef}
        src={source}
      >
        <track kind="captions" />
      </audio>

      {/* Main Player Column */}
      <div className="public-player__main-column">
        <section
          aria-labelledby="public-player-now-playing"
          className="public-player__now-playing-card"
        >
          {/* Event artwork */}
          <PlayerArtwork artworkUrl={eventArtworkUrl} eventTitle={details.eventTitle} />

          {/* Now playing metadata & Tutti fallback status */}
          <PlayerTrackMetadata
            activeTrackKey={activeTrackKey}
            currentTrack={currentTrack}
            item={currentItem}
          />

          {/* Progress bar */}
          <PlayerProgress
            currentTime={currentTime}
            duration={duration}
            onSeek={handleSeek}
            title={currentItem.title}
          />

          {/* Transport controls */}
          <PlayerTransport
            currentIndex={currentIndex}
            loopMode={loopMode}
            onNext={nextTrack}
            onPrevious={previousTrack}
            onTogglePlay={togglePlay}
            playableCount={playableItems.length}
            playing={playing}
          />

          {/* Voice Part selection */}
          <PlayerPartSelector
            activeTrackKey={activeTrackKey}
            onSelectTrackKey={selectTrackKey}
            trackKeys={allTrackKeys}
          />

          {/* Secondary controls: Repeat, Set List, Settings */}
          <PlayerSecondaryControls
            loopMode={loopMode}
            onOpenQueue={() => {
              setQueueOpen(true);
            }}
            onOpenSettings={() => {
              setSettingsOpen(true);
            }}
            onToggleLoop={() => {
              setLoopMode((mode) => (mode === "none" ? "all" : mode === "all" ? "one" : "none"));
            }}
            queueButtonRef={queueButtonRef}
            queueCount={playableItems.length}
            settingsButtonRef={settingsButtonRef}
          />
        </section>
      </div>

      {/* Desktop side panel: Set list */}
      <div className="public-player__desktop-panel">
        <PlayerSetList
          activeTrackKey={activeTrackKey}
          currentIndex={currentIndex}
          items={details.items}
          onSelectItem={(itemIndex) => {
            selectItem(itemIndex);
          }}
          playableItems={playableItems}
          token={token}
        />
        <div className="public-player__desktop-options">
          <PlayerRehearsalOptions
            countdown={countdown}
            currentTrackFileId={currentTrack.fileId}
            gapSeconds={gapSeconds}
            onChangeGapSeconds={setGapSeconds}
            onChangeStartAt={updateStartAt}
            onChangeVolume={setVolume}
            onToggleGuide={() => {
              setShowGuide((current) => !current);
            }}
            showGuide={showGuide}
            startAt={startAt}
            token={token}
            volume={volume}
          />
        </div>
      </div>

      {/* Mobile Drawer: Set List */}
      <Sheet
        onClose={() => {
          setQueueOpen(false);
        }}
        open={queueOpen}
        restoreFocusRef={queueButtonRef}
        title="Set List"
      >
        <div className="public-player__sheet-container">
          <div className="public-player__sheet-header">
            <p className="public-player__sheet-title">Set List</p>
            <p>
              {details.eventTitle} · {playableItems.length} tracks
            </p>
          </div>
          <PlayerSetList
            activeTrackKey={activeTrackKey}
            currentIndex={currentIndex}
            items={details.items}
            onSelectItem={(itemIndex) => {
              selectItem(itemIndex);
              setQueueOpen(false);
            }}
            playableItems={playableItems}
            token={token}
          />
        </div>
      </Sheet>

      {/* Mobile Drawer: Settings */}
      <Sheet
        onClose={() => {
          setSettingsOpen(false);
        }}
        open={settingsOpen}
        restoreFocusRef={settingsButtonRef}
        title="Rehearsal Settings"
      >
        <div className="public-player__sheet-container">
          <div className="public-player__sheet-header">
            <p className="public-player__sheet-title">Rehearsal Settings</p>
            <p>Adjust playback options for practice</p>
          </div>
          <PlayerRehearsalOptions
            countdown={countdown}
            currentTrackFileId={currentTrack.fileId}
            gapSeconds={gapSeconds}
            onChangeGapSeconds={setGapSeconds}
            onChangeStartAt={updateStartAt}
            showVolume={false}
            startAt={startAt}
            token={token}
          />
        </div>
      </Sheet>
    </div>
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
        <PublicPracticePlayer details={details} token={token ?? ""} />
      </section>
    </main>
  );
}
