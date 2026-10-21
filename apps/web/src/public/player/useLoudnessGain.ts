import { useEffect, useRef, type RefObject } from "react";
import type { LoudnessMeasurement } from "@choir/contracts";
import { practiceLoudnessGain } from "@choir/domain";

// Release-blocking physical-device matrix must pass before enabling in a build.
interface Graph {
  readonly audio: HTMLAudioElement;
  readonly context: AudioContext;
  readonly source: MediaElementAudioSourceNode;
  readonly gain: GainNode;
  bypass: boolean;
}
function setGain(graph: Graph, value: number): void {
  if (graph.bypass) return;
  const now = graph.context.currentTime;
  graph.gain.gain.cancelScheduledValues(now);
  // Start each asset from silence; an old boosted value must never reach a new file.
  graph.gain.gain.setValueAtTime(0, now);
  graph.gain.gain.linearRampToValueAtTime(value, now + 0.05);
}
/** One graph per mounted media element, initialized synchronously inside a play gesture. */
export function useLoudnessGain(
  audioRef: RefObject<HTMLAudioElement | null>,
  assetKey: string,
  measurement: LoudnessMeasurement | undefined,
) {
  const graphRef = useRef<Graph | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const alive = useRef(false);
  const applied = useRef("");
  const gain = practiceLoudnessGain(measurement).linearGain;
  const gainKey = `${assetKey}:${String(gain)}`;
  useEffect(() => {
    alive.current = true;
    const resume = () => {
      const graph = graphRef.current;
      if (graph && !graph.audio.paused && graph.context.state !== "running")
        void graph.context.resume().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    if (typeof navigator.mediaDevices !== "undefined")
      navigator.mediaDevices.addEventListener("devicechange", resume);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      if (typeof navigator.mediaDevices !== "undefined")
        navigator.mediaDevices.removeEventListener("devicechange", resume);
      // React Strict Mode immediately restores the effect; do not close its graph.
      queueMicrotask(() => {
        if (alive.current) return;
        const graph = graphRef.current;
        graphRef.current = null;
        graph?.source.disconnect();
        graph?.gain.disconnect();
        const context = contextRef.current;
        contextRef.current = null;
        if (context) void context.close().catch(() => undefined);
      });
    };
  }, []);
  useEffect(() => {
    const graph = graphRef.current;
    if (graph && graph.audio !== audioRef.current) {
      graph.source.disconnect();
      graph.gain.disconnect();
      void graph.context.close().catch(() => undefined);
      contextRef.current = null;
      graphRef.current = null;
      applied.current = "";
    } else if (graph && applied.current !== gainKey) {
      setGain(graph, gain);
      applied.current = gainKey;
    }
  });
  // Call before audio.play(), without awaiting, so both APIs receive the gesture.
  function prepare(): void {
    if (
      import.meta.env.VITE_PRACTICE_LOUDNESS_ENABLED !== "true" ||
      typeof AudioContext === "undefined"
    )
      return;
    // Prime/resume the context during a row/part gesture even if audio mounts next render.
    let context = contextRef.current;
    if (!context) {
      try {
        context = new AudioContext();
        contextRef.current = context;
      } catch {
        return;
      }
    }
    if (context.state !== "running") void context.resume().catch(() => undefined);
    if (!audioRef.current) return;
    let graph = graphRef.current;
    if (!graph) {
      try {
        const node = context.createGain();
        node.gain.value = gain;
        node.connect(context.destination);
        // Connect the destination first; only then permanently route the element.
        const source = context.createMediaElementSource(audioRef.current);
        graph = { audio: audioRef.current, context, source, gain: node, bypass: false };
        graphRef.current = graph;
        try {
          source.connect(node);
        } catch {
          source.disconnect();
          node.disconnect();
          source.connect(context.destination);
          graph.bypass = true;
        }
        applied.current = gainKey;
      } catch {
        if (!graphRef.current) {
          void context.close().catch(() => undefined);
          contextRef.current = null;
        }
        return;
      }
    }
    if (applied.current !== gainKey) {
      setGain(graph, gain);
      applied.current = gainKey;
    }
    if (graph.context.state !== "running") void graph.context.resume().catch(() => undefined);
  }
  return prepare;
}
