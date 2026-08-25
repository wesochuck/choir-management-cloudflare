import type {
  OrganizationEvent,
  OrganizationMusicPiece,
  OrganizationVenue,
} from "@choir/contracts";
import { calculateRsvpDeadline, zonedLocalDateTimeToUtc } from "@choir/domain";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { AuthApiError, createOrganizationEvent, updateOrganizationEvent } from "../../../auth/api";

import { audioTimeText } from "./utils";

import {
  validateAudioFile,
  eventRequestFrom,
  performanceDateLabel,
  pieceIdsForPerformance,
  performanceContainsPiece,
  performanceSetListItem,
} from "./tableUtils";

export function MusicPiecePerformances({
  allEvents,
  allPieces,
  onEventChanged,
  piece,
  timezone,
  venues,
}: {
  readonly allEvents: readonly OrganizationEvent[];
  readonly allPieces: readonly OrganizationMusicPiece[];
  readonly onEventChanged: (event: OrganizationEvent) => Promise<void>;
  readonly piece: OrganizationMusicPiece;
  readonly timezone: string;
  readonly venues: readonly OrganizationVenue[];
}) {
  const [quickTitle, setQuickTitle] = useState("");
  const [quickDate, setQuickDate] = useState("");
  const [quickVenueId, setQuickVenueId] = useState("");
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pieceIds = useMemo(() => pieceIdsForPerformance(piece, allPieces), [allPieces, piece]);
  const performances = useMemo(
    () => allEvents.filter((event) => event.type === "Performance"),
    [allEvents],
  );
  const linkedPerformances = useMemo(
    () => performances.filter((event) => performanceContainsPiece(event, pieceIds)),
    [performances, pieceIds],
  );
  const availablePerformances = useMemo(
    () => performances.filter((event) => !performanceContainsPiece(event, pieceIds)),
    [performances, pieceIds],
  );

  async function togglePerformance(event: OrganizationEvent): Promise<void> {
    setBusyId(event.id);
    setError(null);
    try {
      const linked = performanceContainsPiece(event, pieceIds);
      const setList = linked
        ? event.setList.filter((item) => item.pieceId === undefined || !pieceIds.has(item.pieceId))
        : [...event.setList, performanceSetListItem(piece)];
      const saved = await updateOrganizationEvent(event.id, {
        ...eventRequestFrom(event),
        setList,
      });
      await onEventChanged(saved);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The performance link could not be updated.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function quickAddPerformance(): Promise<void> {
    const title = quickTitle.trim();
    const startsAt = zonedLocalDateTimeToUtc(quickDate, timezone);
    if (!title || !startsAt) {
      setError("Enter a performance title and a valid date and time.");
      return;
    }
    setBusyId("quick-add");
    setError(null);
    try {
      const saved = await createOrganizationEvent({
        advancePriceCents: 0,
        callTime: "",
        dayOfPriceCents: 0,
        details: "Quick added from music library historic performance links.",
        doorsOpenTime: "",
        durationMinutes: null,
        isTicketingEnabled: false,
        rsvpDeadlineDate:
          calculateRsvpDeadline({ startsAt, type: "Performance" }, 7, timezone)?.deadlineDate ??
          null,
        location: "",
        parentPerformanceId: null,
        publicDetails: "",
        publicGraphicFileId: null,
        publishOnWebsite: false,
        rsvpFollowUpLeadHours: null,
        rsvpFollowUpMode: "inherit",
        setList: [performanceSetListItem(piece)],
        setListApproved: false,
        startsAt,
        ticketCapacity: null,
        title,
        type: "Performance",
        venueId: quickVenueId || null,
      });
      await onEventChanged(saved);
      setQuickTitle("");
      setQuickDate("");
      setQuickVenueId("");
      setShowQuickAdd(false);
    } catch (caught: unknown) {
      setError(
        caught instanceof AuthApiError
          ? caught.message
          : "The historic performance could not be created.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="music-piece-performances">
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="field">
        <span className="field-label">Linked performances</span>
        <div className="music-piece-performance-links">
          {linkedPerformances.length === 0 ? (
            <span className="field-help">No performances linked.</span>
          ) : (
            linkedPerformances.map((event) => (
              <span className="music-piece-performance-link" key={event.id}>
                {event.title} ({performanceDateLabel(event.startsAt, timezone)})
                <button
                  aria-label={`Unlink ${event.title}`}
                  disabled={busyId !== null}
                  type="button"
                  onClick={() => void togglePerformance(event)}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
      </div>
      <div className="music-piece-performance-actions">
        <label className="field">
          Add a performance
          <select
            disabled={busyId !== null}
            value=""
            onChange={(event) => {
              const selected = availablePerformances.find(({ id }) => id === event.target.value);
              if (selected) void togglePerformance(selected);
            }}
          >
            <option value="">Choose a performance…</option>
            {availablePerformances.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} ({performanceDateLabel(event.startsAt, timezone)})
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button--secondary"
          disabled={busyId !== null}
          type="button"
          onClick={() => {
            setError(null);
            setShowQuickAdd((current) => !current);
          }}
        >
          {showQuickAdd ? "Cancel quick add" : "Quick add performance"}
        </button>
      </div>
      {showQuickAdd ? (
        <div className="music-piece-quick-performance">
          <h3>Quick add historic performance</h3>
          <p className="field-help">Times are entered in {timezone}.</p>
          <label className="field">
            Performance title
            <input
              autoFocus
              placeholder="e.g. Spring Concert 2018"
              value={quickTitle}
              onChange={(event) => {
                setQuickTitle(event.target.value);
              }}
            />
          </label>
          <div className="music-fields-grid">
            <label className="field">
              Date and time
              <input
                type="datetime-local"
                value={quickDate}
                onChange={(event) => {
                  setQuickDate(event.target.value);
                }}
              />
            </label>
            <label className="field">
              Venue (optional)
              <select
                value={quickVenueId}
                onChange={(event) => {
                  setQuickVenueId(event.target.value);
                }}
              >
                <option value="">No venue</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="dialog__actions">
            <button
              className="button button--primary"
              disabled={busyId !== null}
              type="button"
              onClick={() => void quickAddPerformance()}
            >
              {busyId === "quick-add" ? "Creating…" : "Create and link"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MusicInlineAudioPlayer({
  label,
  src,
}: {
  readonly label: string;
  readonly src: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.load();
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
  }, [src]);

  function togglePlayback(): void {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  }

  return (
    <div
      className="music-audio-track__player"
      onChange={(event) => {
        event.stopPropagation();
      }}
      onInput={(event) => {
        event.stopPropagation();
      }}
    >
      <audio
        aria-label={`${label} learning track`}
        className="music-audio-track__audio"
        preload="metadata"
        ref={audioRef}
        src={src}
        onEnded={() => {
          setIsPlaying(false);
        }}
        onLoadedMetadata={(event) => {
          setDuration(
            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0,
          );
        }}
        onPause={() => {
          setIsPlaying(false);
        }}
        onPlay={() => {
          setIsPlaying(true);
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
        }}
      >
        <track kind="captions" />
      </audio>
      <button
        aria-label={isPlaying ? `Pause ${label}` : `Play ${label}`}
        className="button button--secondary button--small music-audio-track__play"
        title={isPlaying ? "Pause" : "Play"}
        type="button"
        onClick={togglePlayback}
      >
        <span aria-hidden="true">{isPlaying ? "❚❚" : "▶"}</span>
      </button>
      <span aria-hidden="true" className="music-audio-track__time">
        {audioTimeText(currentTime)}
      </span>
      <input
        aria-label={`Scrub ${label}`}
        className="music-audio-track__scrubber"
        disabled={duration <= 0}
        max={duration || 1}
        min={0}
        step={0.1}
        type="range"
        value={Math.min(currentTime, duration || 0)}
        onChange={(event) => {
          const nextTime = Number(event.target.value);
          setCurrentTime(nextTime);
          if (audioRef.current) audioRef.current.currentTime = nextTime;
        }}
      />
      <span aria-hidden="true" className="music-audio-track__time">
        {audioTimeText(duration)}
      </span>
    </div>
  );
}

export function MusicTableTuttiPlayer({ piece }: { readonly piece: OrganizationMusicPiece }) {
  const fileId = piece.trackFileIds.tutti;
  const [expanded, setExpanded] = useState(false);

  if (!fileId) return <span>—</span>;
  if (!expanded) {
    return (
      <button
        className="button button--secondary button--small"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setExpanded(true);
        }}
      >
        <span aria-hidden="true">▶</span> Play
      </button>
    );
  }

  return (
    <div
      className="music-table-track-player"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <MusicInlineAudioPlayer label="Tutti" src={`/api/organization/files/${fileId}`} />
      <button
        aria-label={`Close player for ${piece.title}`}
        className="text-button"
        title="Close player"
        type="button"
        onClick={() => {
          setExpanded(false);
        }}
      >
        ×
      </button>
    </div>
  );
}

export function MusicTuttiTrackDropzone({
  disabled,
  file,
  onChange,
}: {
  readonly disabled: boolean;
  readonly file: File | null;
  readonly onChange: (file: File | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFile(nextFile: File | null): void {
    if (!nextFile || disabled) return;
    const validationError = validateAudioFile(nextFile);
    if (validationError) {
      setError(validationError);
      onChange(null);
      return;
    }
    setError(null);
    onChange(nextFile);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files.item(0));
  }

  return (
    <fieldset className="music-tutti-track-field">
      <legend>Tutti Practice Track (Optional)</legend>
      <p className="field-help">Add the full-mix practice track now, or attach it later.</p>
      <label
        className={`music-tutti-dropzone${dragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => {
          if (disabled) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          if (disabled) return;
          setDragging(false);
        }}
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDrop={handleDrop}
      >
        <span className="music-tutti-dropzone__label">
          {file ? (
            <>
              Selected: <strong>{file.name}</strong>
            </>
          ) : (
            <>
              Drag and drop a Tutti MP3 track here, or{" "}
              <span className="music-tutti-dropzone__browse">browse</span>
            </>
          )}
        </span>
        <input
          accept="audio/*"
          className="sr-only"
          disabled={disabled}
          type="file"
          onChange={(event) => {
            handleFile(event.target.files?.item(0) ?? null);
            event.target.value = "";
          }}
        />
      </label>
      {file ? (
        <div className="music-tutti-dropzone__selected">
          <span className="field-help">This track will be attached when you save the piece.</span>
          <button
            className="text-button"
            disabled={disabled}
            type="button"
            onClick={() => {
              setError(null);
              onChange(null);
            }}
          >
            Remove
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
