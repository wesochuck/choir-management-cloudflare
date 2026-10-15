import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrackFileAudioPlayer } from "./TrackFileAudioPlayer";

describe("TrackFileAudioPlayer", () => {
  it("renders play button, scrubber and time displays", () => {
    const file = new File(["dummy audio content"], "test-track.mp3", { type: "audio/mpeg" });

    render(<TrackFileAudioPlayer durationSeconds={195} file={file} fileName="test-track.mp3" />);

    const playBtn = screen.getByRole("button", { name: "Play test-track.mp3" });
    expect(playBtn).toBeInTheDocument();

    const scrubber = screen.getByRole("slider", { name: "Scrub test-track.mp3" });
    expect(scrubber).toBeInTheDocument();
    expect(scrubber).toHaveAttribute("max", "195");

    // Total duration should show formatted time (195s = 3:15)
    expect(screen.getByText("3:15")).toBeInTheDocument();
  });

  it("handles play toggle and pausing other audio elements", () => {
    const file1 = new File(["audio1"], "song1.mp3", { type: "audio/mpeg" });
    const file2 = new File(["audio2"], "song2.mp3", { type: "audio/mpeg" });

    render(
      <div>
        <TrackFileAudioPlayer durationSeconds={120} file={file1} fileName="song1.mp3" />
        <TrackFileAudioPlayer durationSeconds={180} file={file2} fileName="song2.mp3" />
      </div>,
    );

    const playBtn1 = screen.getByRole("button", { name: "Play song1.mp3" });
    const playBtn2 = screen.getByRole("button", { name: "Play song2.mp3" });

    // Mock HTMLMediaElement.prototype methods for jsdom
    const playSpy = vi
      .spyOn(window.HTMLMediaElement.prototype, "play")
      .mockImplementation(function (this: HTMLMediaElement) {
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
      });
    const pauseSpy = vi
      .spyOn(window.HTMLMediaElement.prototype, "pause")
      .mockImplementation(function (this: HTMLMediaElement) {
        this.dispatchEvent(new Event("pause"));
      });

    fireEvent.click(playBtn1);
    expect(playSpy).toHaveBeenCalled();

    // Clicking second player pauses others and plays second
    fireEvent.click(playBtn2);
    expect(pauseSpy).toHaveBeenCalled();

    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it("updates position on scrubber change", () => {
    const file = new File(["audio"], "scrub.mp3", { type: "audio/mpeg" });

    render(<TrackFileAudioPlayer durationSeconds={200} file={file} fileName="scrub.mp3" />);

    const scrubber = screen.getByRole("slider", { name: "Scrub scrub.mp3" });
    fireEvent.change(scrubber, { target: { value: "65" } });

    // Current time text should update to 1:05 (65 seconds)
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });
});
