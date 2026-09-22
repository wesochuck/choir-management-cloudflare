import { useEffect, useRef, useState } from "react";
import { audioTimeText } from "./components/MusicCatalog/utils";

export interface InlinePracticeTrackPlayerProps {
  readonly buttonClassName?: string | undefined;
  readonly className?: string | undefined;
  readonly fileId: string;
  readonly label?: string | undefined;
  readonly lowercaseLabelInAria?: boolean | undefined;
  readonly onPause?: (() => void) | undefined;
  readonly onPlay?: (() => void) | undefined;
  readonly pieceTitle: string;
  readonly showLabelInButton?: boolean | undefined;
  readonly trackTypeNoun?: string | undefined;
}

function getPlayerButtonLabel(
  isPlaying: boolean,
  currentTime: number,
  defaultButtonLabel: string,
): string {
  if (isPlaying || currentTime > 0) {
    return audioTimeText(currentTime);
  }
  return defaultButtonLabel;
}

function getPlayerActionAria(params: {
  currentTime: number;
  isPlaying: boolean;
  label: string;
  lowercaseLabelInAria: boolean;
  pieceTitle: string;
  trackTypeNoun: string;
}): string {
  const { currentTime, isPlaying, label, lowercaseLabelInAria, pieceTitle, trackTypeNoun } = params;
  const modifier = lowercaseLabelInAria ? label.toLowerCase() : label;
  const action = isPlaying ? "Pause" : currentTime > 0 ? "Resume" : "Play";
  return `${action} ${modifier} ${trackTypeNoun} for ${pieceTitle}`;
}

function getPlayerButtonTitle(
  isPlaying: boolean,
  currentTime: number,
  duration: number,
  label: string,
): string {
  if (isPlaying) {
    return `Pause (${audioTimeText(currentTime)} / ${audioTimeText(duration)})`;
  }
  if (currentTime > 0) {
    return `Resume (${audioTimeText(currentTime)} / ${audioTimeText(duration)})`;
  }
  return `Play ${label}`;
}

export function InlinePracticeTrackPlayer({
  buttonClassName = "",
  className = "",
  fileId,
  label = "Practice track",
  lowercaseLabelInAria = false,
  onPause,
  onPlay,
  pieceTitle,
  showLabelInButton = false,
  trackTypeNoun = "recording",
}: InlinePracticeTrackPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
  }, [fileId]);

  function togglePlayback(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      document.querySelectorAll("audio").forEach((otherAudio) => {
        if (otherAudio !== audio) {
          otherAudio.pause();
        }
      });
      void audio.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  }

  const src = `/api/organization/files/${encodeURIComponent(fileId)}`;
  const defaultButtonLabel = showLabelInButton ? `Play ${label}` : "Play";
  const labelText = getPlayerButtonLabel(isPlaying, currentTime, defaultButtonLabel);
  const actionAria = getPlayerActionAria({
    currentTime,
    isPlaying,
    label,
    lowercaseLabelInAria,
    pieceTitle,
    trackTypeNoun,
  });
  const buttonTitle = getPlayerButtonTitle(isPlaying, currentTime, duration, label);

  return (
    <div
      className={`inline-practice-track-player ${className}`.trim()}
      draggable={false}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onDragStart={(event) => {
        event.stopPropagation();
      }}
    >
      <audio
        aria-label={`${label} learning track for ${pieceTitle}`}
        className="music-audio-track__audio"
        preload="metadata"
        ref={audioRef}
        src={src}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
          onPause?.();
        }}
        onLoadedMetadata={(event) => {
          setDuration(
            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0,
          );
        }}
        onPause={() => {
          setIsPlaying(false);
          onPause?.();
        }}
        onPlay={() => {
          setIsPlaying(true);
          onPlay?.();
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
        }}
      >
        <track kind="captions" />
      </audio>
      <button
        aria-label={actionAria}
        className={`button button--secondary button--small inline-practice-track-player__button ${buttonClassName}${isPlaying ? " is-playing" : ""}`.trim()}
        title={buttonTitle}
        type="button"
        onClick={togglePlayback}
      >
        <span aria-hidden="true">{isPlaying ? "❚❚" : "▶"}</span> {labelText}
      </button>
    </div>
  );
}
