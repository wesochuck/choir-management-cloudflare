import { useEffect, useRef, useState } from "react";
import { audioTimeText } from "./components/MusicCatalog/utils";

export interface InlinePracticeTrackPlayerProps {
  readonly buttonClassName?: string | undefined;
  readonly className?: string | undefined;
  readonly fileId: string;
  readonly label?: string | undefined;
  readonly onPause?: (() => void) | undefined;
  readonly onPlay?: (() => void) | undefined;
  readonly pieceTitle: string;
  readonly showLabelInButton?: boolean | undefined;
}

export function InlinePracticeTrackPlayer({
  buttonClassName = "",
  className = "",
  fileId,
  label = "Practice track",
  onPause,
  onPlay,
  pieceTitle,
  showLabelInButton = false,
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
  const labelText = isPlaying
    ? audioTimeText(currentTime)
    : currentTime > 0
      ? audioTimeText(currentTime)
      : defaultButtonLabel;

  const actionAria = isPlaying
    ? `Pause ${label} recording for ${pieceTitle}`
    : currentTime > 0
      ? `Resume ${label} recording for ${pieceTitle}`
      : `Play ${label} recording for ${pieceTitle}`;

  const buttonTitle = isPlaying
    ? `Pause (${audioTimeText(currentTime)} / ${audioTimeText(duration)})`
    : currentTime > 0
      ? `Resume (${audioTimeText(currentTime)} / ${audioTimeText(duration)})`
      : `Play ${label}`;

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
