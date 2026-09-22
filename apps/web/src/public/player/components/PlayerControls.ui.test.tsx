import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { PlayerPartSelector } from "./PlayerPartSelector";
import { PlayerProgress, PlayerTransport } from "./PlayerProgress";

// Interaction coverage for music-player controls (plan §4.13), including the
// mobile-relevant voice-part sheet: transport disabled states, Play/Pause
// keyboard activation, seek-slider labeling and keyboard input, and the
// radiogroup arrow-key behavior of the part selector.

describe("PlayerTransport interaction", () => {
  it("disables Previous on the first track and Next on the last track", () => {
    const handlers = { onNext: vi.fn(), onPrevious: vi.fn(), onTogglePlay: vi.fn() };
    const { rerender } = render(
      <PlayerTransport
        currentIndex={0}
        loopMode="none"
        onNext={handlers.onNext}
        onPrevious={handlers.onPrevious}
        onTogglePlay={handlers.onTogglePlay}
        playableCount={3}
        playing={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous track" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeEnabled();

    rerender(
      <PlayerTransport
        currentIndex={2}
        loopMode="none"
        onNext={handlers.onNext}
        onPrevious={handlers.onPrevious}
        onTogglePlay={handlers.onTogglePlay}
        playableCount={3}
        playing={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Next track" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous track" })).toBeEnabled();
  });

  it("keeps transport enabled at the boundaries when repeating all", () => {
    const handlers = { onNext: vi.fn(), onPrevious: vi.fn(), onTogglePlay: vi.fn() };
    render(
      <PlayerTransport
        currentIndex={0}
        loopMode="all"
        onNext={handlers.onNext}
        onPrevious={handlers.onPrevious}
        onTogglePlay={handlers.onTogglePlay}
        playableCount={2}
        playing={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous track" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeEnabled();
  });

  it("toggles Play/Pause with pointer and keyboard", async () => {
    const user = userEvent.setup();
    const handlers = { onNext: vi.fn(), onPrevious: vi.fn(), onTogglePlay: vi.fn() };
    const { rerender } = render(
      <PlayerTransport
        currentIndex={0}
        loopMode="none"
        onNext={handlers.onNext}
        onPrevious={handlers.onPrevious}
        onTogglePlay={handlers.onTogglePlay}
        playableCount={2}
        playing={false}
      />,
    );

    const play = screen.getByRole("button", { name: "Play" });
    await user.click(play);
    expect(handlers.onTogglePlay).toHaveBeenCalledTimes(1);

    rerender(
      <PlayerTransport
        currentIndex={0}
        loopMode="none"
        onNext={handlers.onNext}
        onPrevious={handlers.onPrevious}
        onTogglePlay={handlers.onTogglePlay}
        playableCount={2}
        playing
      />,
    );
    const pause = screen.getByRole("button", { name: "Pause" });
    pause.focus();
    await user.keyboard("{Enter}");
    expect(handlers.onTogglePlay).toHaveBeenCalledTimes(2);

    const next = screen.getByRole("button", { name: "Next track" });
    next.focus();
    await user.keyboard("{Enter}");
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
  });
});

describe("PlayerProgress interaction", () => {
  it("exposes an accessible seek slider with time announcements", async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<PlayerProgress currentTime={30} duration={180} onSeek={onSeek} title="Ave Verum" />);

    const slider = screen.getByRole("slider", { name: "Seek Ave Verum" });
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "180");
    expect(slider).toHaveAttribute("aria-valuenow", "30");
    expect(slider).toHaveAttribute("aria-valuetext", "0:30 of 3:00");

    // The slider is keyboard-focusable; arrow-key stepping itself is native
    // browser behavior that jsdom does not emulate, so value changes are
    // driven through the change event the native control fires.
    await user.click(slider);
    expect(slider).toHaveFocus();
    fireEvent.change(slider, { target: { value: "31" } });
    expect(onSeek).toHaveBeenCalledWith(31);
  });
});

describe("PlayerPartSelector interaction", () => {
  function PartSelectorHarness({
    onSelectTrackKey,
  }: {
    readonly onSelectTrackKey: (key: string) => void;
  }) {
    // Sorted order is soprano, alto, tutti — start on the first entry so
    // ArrowDown deterministically reaches Alto.
    const [activeTrackKey, setActiveTrackKey] = useState("soprano");
    return (
      <PlayerPartSelector
        activeTrackKey={activeTrackKey}
        onSelectTrackKey={(key) => {
          setActiveTrackKey(key);
          onSelectTrackKey(key);
        }}
        trackKeys={["tutti", "soprano", "alto"]}
      />
    );
  }

  it("opens the voice-part sheet and moves with arrow keys", async () => {
    const user = userEvent.setup();
    const onSelectTrackKey = vi.fn();
    render(<PartSelectorHarness onSelectTrackKey={onSelectTrackKey} />);

    const trigger = screen.getByRole("button", { name: /Voice Part/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);

    const sheet = await screen.findByRole("dialog", { name: "Choose Voice Part" });
    expect(sheet).toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("radio", { checked: true })).toHaveTextContent("Soprano");

    // Radix moves initial sheet focus to its first control; Tab reaches the
    // selected radio, from which the radiogroup arrow handling takes over.
    await user.tab();
    expect(screen.getByRole("radio", { name: "Soprano" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(onSelectTrackKey).toHaveBeenCalledWith("alto");
    expect(screen.getByRole("radio", { name: "Alto" })).toHaveFocus();
  });

  it("closes the voice-part sheet on Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    const onSelectTrackKey = vi.fn();
    render(<PartSelectorHarness onSelectTrackKey={onSelectTrackKey} />);

    const trigger = screen.getByRole("button", { name: /Voice Part/i });
    await user.click(trigger);
    await screen.findByRole("dialog", { name: "Choose Voice Part" });

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Choose Voice Part" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("selects voice part via the mobile native select without opening sheet", async () => {
    const user = userEvent.setup();
    const onSelectTrackKey = vi.fn();
    render(<PartSelectorHarness onSelectTrackKey={onSelectTrackKey} />);

    const select = screen.getByRole("combobox", { name: /Voice Part/i });
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("soprano");

    await user.selectOptions(select, "alto");
    expect(onSelectTrackKey).toHaveBeenCalledWith("alto");
    expect(screen.queryByRole("dialog", { name: "Choose Voice Part" })).not.toBeInTheDocument();
  });

  it("displays configured full names in both mobile select and desktop sheet", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <PlayerPartSelector
        activeTrackKey="B1"
        onSelectTrackKey={onSelect}
        trackKeys={["tutti", "B1", "T1", "SATB"]}
        trackLabels={{
          B1: "Bass 1 (Featured)",
          SATB: "Full Chorus",
        }}
      />,
    );

    // Mobile select options
    const select = screen.getByRole("combobox", { name: /Voice Part/i });
    expect(select).toHaveValue("B1");
    expect(screen.getByRole("option", { name: "Bass 1 (Featured)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tenor 1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Full Chorus" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Choir Mix" })).toBeInTheDocument();

    // Selecting option in mobile select passes original short key
    await user.selectOptions(select, "T1");
    expect(onSelect).toHaveBeenCalledWith("T1");

    // Desktop trigger displays active full name
    const trigger = screen.getByRole("button", { name: /Voice Part/i });
    expect(trigger).toHaveTextContent("Bass 1 (Featured)");

    // Open desktop sheet to verify radiogroup options
    await user.click(trigger);
    const sheet = await screen.findByRole("dialog", { name: "Choose Voice Part" });
    expect(sheet).toBeVisible();

    const radios = within(sheet).getAllByRole("radio");
    const radioLabels = radios.map((r) => r.textContent.trim());
    expect(radioLabels).toContain("Bass 1 (Featured)");
    expect(radioLabels).toContain("Tenor 1");
    expect(radioLabels).toContain("Full Chorus");
    expect(radioLabels).toContain("Choir Mix");
  });
});
