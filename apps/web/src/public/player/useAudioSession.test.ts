import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setupTestDom } from "../../persistence/testDom";
import { useAudioSession, type AudioSessionHandlers } from "./useAudioSession";

setupTestDom();

function renderHook(hook: () => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function TestComponent() {
    hook();
    return null;
  }

  act(() => {
    root.render(createElement(TestComponent));
  });

  return {
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useAudioSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers standard MediaSession action handlers and triggers callbacks", () => {
    const actionHandlers = new Map<
      MediaSessionAction,
      (details: MediaSessionActionDetails) => void
    >();
    const setActionHandlerSpy = vi.fn(
      (
        action: MediaSessionAction,
        handler: ((details: MediaSessionActionDetails) => void) | null,
      ) => {
        if (handler) {
          actionHandlers.set(action, handler);
        } else {
          actionHandlers.delete(action);
        }
      },
    );

    vi.stubGlobal("navigator", {
      mediaSession: {
        setActionHandler: setActionHandlerSpy,
      },
    });

    const handlers: AudioSessionHandlers = {
      onNextTrack: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
      onPreviousTrack: vi.fn(),
      onSeekRelative: vi.fn(),
      onSeekTo: vi.fn(),
    };
    const handlersRef = { current: handlers };

    const { unmount } = renderHook(() => {
      useAudioSession(handlersRef);
    });

    const expectedActions: MediaSessionAction[] = [
      "play",
      "pause",
      "previoustrack",
      "nexttrack",
      "seekbackward",
      "seekforward",
      "seekto",
    ];

    for (const action of expectedActions) {
      expect(actionHandlers.has(action)).toBe(true);
    }

    actionHandlers.get("play")?.({ action: "play" });
    expect(handlers.onPlay).toHaveBeenCalledTimes(1);

    actionHandlers.get("pause")?.({ action: "pause" });
    expect(handlers.onPause).toHaveBeenCalledTimes(1);

    actionHandlers.get("seekbackward")?.({ action: "seekbackward", seekOffset: 15 });
    expect(handlers.onSeekRelative).toHaveBeenCalledWith(-15);

    actionHandlers.get("seekforward")?.({ action: "seekforward" });
    expect(handlers.onSeekRelative).toHaveBeenCalledWith(10); // default 10s

    actionHandlers.get("seekto")?.({ action: "seekto", seekTime: 42 });
    expect(handlers.onSeekTo).toHaveBeenCalledWith(42);

    // Test teardown: unmount clears all handlers with null
    unmount();
    expect(actionHandlers.size).toBe(0);
  });

  it("safely does nothing if mediaSession is not supported in navigator", () => {
    vi.stubGlobal("navigator", {});
    const handlersRef = { current: { onPause: vi.fn(), onPlay: vi.fn() } };
    expect(() => {
      renderHook(() => {
        useAudioSession(handlersRef);
      });
    }).not.toThrow();
  });
});
