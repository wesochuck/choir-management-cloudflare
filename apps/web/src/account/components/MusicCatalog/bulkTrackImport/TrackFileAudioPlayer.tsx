import { useEffect, useRef, useState } from "react";
import { audioTimeText } from "../utils";

export interface TrackFileAudioPlayerProps {
  readonly durationSeconds?: number | null | undefined;
  readonly file: File;
  readonly fileName: string;
}

function safeCreateObjectURL(file: File): string {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      return URL.createObjectURL(file);
    } catch {
      return "";
    }
  }
  return "";
}

function safeRevokeObjectURL(url: string): void {
  if (url && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
}

function pauseOtherAudioElements(current: HTMLAudioElement): void {
  if (typeof document === "undefined") return;
  document.querySelectorAll("audio").forEach((other) => {
    if (other !== current) {
      try {
        other.pause();
      } catch {
        // ignore
      }
    }
  });
}

export function TrackFileAudioPlayer({
  durationSeconds,
  file,
  fileName,
}: TrackFileAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) {
        try {
          audio.pause();
        } catch {
          // ignore
        }
      }
      if (objectUrlRef.current) {
        safeRevokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  function getOrCreateUrl(): string {
    if (objectUrlRef.current) return objectUrlRef.current;
    const url = safeCreateObjectURL(file);
    objectUrlRef.current = url;
    return url;
  }

  function togglePlayback(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      const url = getOrCreateUrl();
      if (url && audio.src !== url) {
        audio.src = url;
      }
      pauseOtherAudioElements(audio);
      try {
        const playResult: unknown = audio.play();
        if (playResult instanceof Promise) {
          playResult.catch(() => {
            setIsPlaying(false);
          });
        }
      } catch {
        setIsPlaying(false);
      }
    } else {
      try {
        audio.pause();
      } catch {
        // ignore
      }
    }
  }

  function handleScrub(event: React.ChangeEvent<HTMLInputElement>): void {
    event.stopPropagation();
    const nextTime = Number(event.target.value);
    setCurrentTime(nextTime);
    const audio = audioRef.current;
    if (audio && "currentTime" in audio) {
      const url = getOrCreateUrl();
      if (url && audio.src !== url) {
        audio.src = url;
      }
      try {
        audio.currentTime = nextTime;
      } catch {
        // ignore
      }
    }
  }

  const effectiveDuration = duration > 0 ? duration : (durationSeconds ?? 0);

  return (
    <div
      className="music-audio-track__player track-import-audio-player"
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
      }}
      onDragStart={(e) => {
        e.stopPropagation();
      }}
    >
      <audio
        aria-label={`Preview for ${fileName}`}
        className="music-audio-track__audio"
        preload="none"
        ref={audioRef}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
        onLoadedMetadata={(event) => {
          const d = event.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) {
            setDuration(d);
          }
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
        aria-label={isPlaying ? `Pause ${fileName}` : `Play ${fileName}`}
        className={`button button--secondary button--small music-audio-track__play${isPlaying ? " is-playing" : ""}`}
        title={
          isPlaying
            ? `Pause (${audioTimeText(currentTime)} / ${audioTimeText(effectiveDuration)})`
            : `Play ${fileName}`
        }
        type="button"
        onClick={togglePlayback}
      >
        <span aria-hidden="true">{isPlaying ? "❚❚" : "▶"}</span>
      </button>

      <span aria-hidden="true" className="music-audio-track__time">
        {audioTimeText(currentTime)}
      </span>

      <input
        aria-label={`Scrub ${fileName}`}
        className="music-audio-track__scrubber"
        disabled={effectiveDuration <= 0}
        max={effectiveDuration || 1}
        min={0}
        step={0.1}
        type="range"
        value={Math.min(currentTime, effectiveDuration || 0)}
        onChange={handleScrub}
      />

      <span aria-hidden="true" className="music-audio-track__time">
        {audioTimeText(effectiveDuration)}
      </span>
    </div>
  );
}
