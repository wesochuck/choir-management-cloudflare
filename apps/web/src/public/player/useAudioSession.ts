import { useEffect, type RefObject } from "react";

export interface AudioSessionHandlers {
  readonly onNextTrack?: () => void;
  readonly onPause: () => void;
  readonly onPlay: () => void;
  readonly onPreviousTrack?: () => void;
  readonly onSeekRelative?: (offsetSeconds: number) => void;
  readonly onSeekTo?: (timeSeconds: number) => void;
}

export function useAudioSession(handlersRef: RefObject<AudioSessionHandlers | null>): void {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    const actionMap: [MediaSessionAction, (details: MediaSessionActionDetails) => void][] = [
      [
        "play",
        () => {
          handlersRef.current?.onPlay();
        },
      ],
      [
        "pause",
        () => {
          handlersRef.current?.onPause();
        },
      ],
      [
        "previoustrack",
        () => {
          handlersRef.current?.onPreviousTrack?.();
        },
      ],
      [
        "nexttrack",
        () => {
          handlersRef.current?.onNextTrack?.();
        },
      ],
      [
        "seekbackward",
        (details) => {
          handlersRef.current?.onSeekRelative?.(-(details.seekOffset ?? 10));
        },
      ],
      [
        "seekforward",
        (details) => {
          handlersRef.current?.onSeekRelative?.(details.seekOffset ?? 10);
        },
      ],
      [
        "seekto",
        (details) => {
          if (typeof details.seekTime === "number") {
            handlersRef.current?.onSeekTo?.(details.seekTime);
          }
        },
      ],
    ];

    for (const [action, handler] of actionMap) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported actions in older browsers are safely ignored
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
  }, [handlersRef]);
}
