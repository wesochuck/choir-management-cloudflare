import { StrictMode, useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLoudnessGain } from "./useLoudnessGain";
const createSource = vi.fn();
const connectSource = vi.fn();
const ramp = vi.fn();
const cancel = vi.fn();
const close = vi.fn(() => Promise.resolve());
const resume = vi.fn(() => Promise.resolve());
class Context {
  currentTime = 0;
  state = "suspended";
  destination = {};
  constructor() {
    contexts++;
  }
  createGain() {
    return {
      gain: {
        value: 1,
        cancelScheduledValues: cancel,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: ramp,
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  createMediaElementSource(audio: HTMLAudioElement) {
    createSource(audio);
    return { connect: connectSource, disconnect: vi.fn() };
  }
  close = close;
  resume = resume;
}
let contexts = 0;
function Harness({
  id = "a",
  peak = -12,
  present = true,
}: {
  id?: string;
  peak?: number;
  present?: boolean;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const prepare = useLoudnessGain(ref, id, {
    analysisVersion: 1,
    contentVersion: id,
    integratedLufs: -26,
    truePeakDbtp: peak,
  });
  return (
    <>
      <button onClick={prepare} type="button">
        Play
      </button>
      {present ? (
        <audio ref={ref}>
          <track kind="captions" />
        </audio>
      ) : null}
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  contexts = 0;
});
describe("normalization media-element lifecycle (simulated graph)", () => {
  it("keeps native playback when rollout is off", () => {
    vi.stubEnv("VITE_PRACTICE_LOUDNESS_ENABLED", "false");
    vi.stubGlobal("AudioContext", Context);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button"));
    expect(contexts).toBe(0);
  });
  it("leaves the native element untouched when Web Audio is unavailable", () => {
    vi.stubEnv("VITE_PRACTICE_LOUDNESS_ENABLED", "true");
    vi.stubGlobal("AudioContext", undefined);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button"));
    expect(createSource).not.toHaveBeenCalled();
  });
  it("retains one source and connects directly at unity after a gain connection failure", () => {
    vi.stubEnv("VITE_PRACTICE_LOUDNESS_ENABLED", "true");
    vi.stubGlobal("AudioContext", Context);
    connectSource.mockImplementationOnce(() => {
      throw new Error("Cannot connect gain");
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(createSource).toHaveBeenCalledTimes(1);
    expect(connectSource).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalled();
  });
  it("reuses the graph across Strict Mode, retries and asset switches, and closes on unmount", async () => {
    vi.stubEnv("VITE_PRACTICE_LOUDNESS_ENABLED", "true");
    vi.stubGlobal("AudioContext", Context);
    const view = render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(createSource).toHaveBeenCalledTimes(1);
    expect(contexts).toBe(1);
    expect(resume).toHaveBeenCalled();
    view.rerender(
      <StrictMode>
        <Harness id="b" peak={-3} />
      </StrictMode>,
    );
    expect(cancel).toHaveBeenCalled();
    expect(ramp).toHaveBeenLastCalledWith(10 ** (2 / 20), 0.05);
    view.unmount();
    await waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1);
    });
  });
  it("waits for a conditionally mounted audio element and retires removed graphs", async () => {
    vi.stubEnv("VITE_PRACTICE_LOUDNESS_ENABLED", "true");
    vi.stubGlobal("AudioContext", Context);
    const view = render(<Harness present={false} />);
    fireEvent.click(screen.getByRole("button"));
    expect(contexts).toBe(1);
    expect(createSource).not.toHaveBeenCalled();
    view.rerender(<Harness />);
    fireEvent.click(screen.getByRole("button"));
    expect(createSource).toHaveBeenCalledTimes(1);
    view.rerender(<Harness present={false} />);
    await waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1);
    });
    view.rerender(<Harness />);
    fireEvent.click(screen.getByRole("button"));
    expect(createSource).toHaveBeenCalledTimes(2);
  });
});
