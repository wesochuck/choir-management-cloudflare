import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { PlayerPartSelector } from "./PlayerPartSelector";
import { PlayerProgress, PlayerTransport } from "./PlayerProgress";
import { organizationTerminologyContext } from "../../../account/organizationTerminologyContext";

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

  it("keeps a per-song track separate from the global voice-part choice", async () => {
    const user = userEvent.setup();
    const onPinPieceTrack = vi.fn();
    const currentItem = {
      pieceId: "piece-1",
      title: "Lux Aurumque",
      trackFileIds: { t1: "file-t1", t2: "file-t2", tutti: "file-tutti" },
    };
    render(
      <PlayerPartSelector
        activeTrackKey="t1"
        currentItem={currentItem}
        onPinPieceTrack={onPinPieceTrack}
        onSelectTrackKey={vi.fn()}
        pinnedTrackKey="t2"
        trackKeys={["tutti", "t1", "t2"]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Voice Part/i });
    expect(trigger).toHaveTextContent("Tenor 2 (Default: Tenor 1)");
    await user.click(trigger);

    const sheet = await screen.findByRole("dialog", { name: "Choose Voice Part" });
    expect(screen.getByRole("tab", { name: "All set list songs" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const globalTab = screen.getByRole("tab", { name: "All set list songs" });
    globalTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Just this song" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Tenor 2" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "Use my default (Tenor 1)" }));
    expect(onPinPieceTrack).toHaveBeenCalledWith("piece-1", null);
    expect(sheet).not.toBeVisible();
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

describe("PlayerPartSelector voice-part nudge", () => {
  const hintText =
    "Your individual part may have its own recording. Select your part above to hear it when available.";

  function renderHinted(extra: Record<string, unknown> = {}) {
    const handlers = {
      onDismissHint: vi.fn(),
      onEngage: vi.fn(),
      onSelectTrackKey: vi.fn(),
    };
    render(
      <PlayerPartSelector
        activeTrackKey="tutti"
        onDismissHint={handlers.onDismissHint}
        onEngage={handlers.onEngage}
        onSelectTrackKey={handlers.onSelectTrackKey}
        showVoicePartHint
        trackKeys={["tutti", "s1", "s2"]}
        {...extra}
      />,
    );
    return handlers;
  }

  it("renders the pointer and hint row with accessible dismissal when shown", () => {
    renderHinted();

    expect(screen.getByText("Choose yours")).toBeInTheDocument();
    expect(screen.getByText(hintText)).toBeInTheDocument();
    const dismiss = screen.getByRole("button", { name: "Dismiss voice-part tip" });
    expect(dismiss).toBeInTheDocument();

    // Both the mobile select and the desktop trigger describe the hint.
    const select = screen.getByRole("combobox", { name: /Voice Part/i });
    const trigger = screen.getByRole("button", { name: /Voice Part/i });
    const hintId = screen.getByText(hintText).getAttribute("id");
    expect(hintId).toBeTruthy();
    expect(select).toHaveAttribute("aria-describedby", hintId);
    expect(trigger).toHaveAttribute("aria-describedby", hintId);
  });

  it("renders no pointer, hint, or dismiss control when hidden", () => {
    render(
      <PlayerPartSelector
        activeTrackKey="tutti"
        onSelectTrackKey={vi.fn()}
        trackKeys={["tutti", "s1"]}
      />,
    );

    expect(screen.queryByText("Choose yours")).not.toBeInTheDocument();
    expect(screen.queryByText(hintText)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Dismiss voice-part tip" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Voice Part/i })).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("notifies engagement on mobile select activation but not on Tab focus alone", async () => {
    const user = userEvent.setup();
    const { onEngage, onSelectTrackKey } = renderHinted();

    const select = screen.getByRole("combobox", { name: /Voice Part/i });
    select.focus();
    expect(select).toHaveFocus();
    expect(onEngage).not.toHaveBeenCalled();

    fireEvent.click(select);
    expect(onEngage).toHaveBeenCalledTimes(1);

    // Choosing the already-displayed default still reports the selection.
    await user.selectOptions(select, "tutti");
    expect(onSelectTrackKey).toHaveBeenCalledWith("tutti");
  });

  it("notifies engagement when opening the desktop sheet and keeps manual choice", async () => {
    const user = userEvent.setup();
    const { onEngage } = renderHinted();

    const trigger = screen.getByRole("button", { name: /Voice Part/i });
    await user.click(trigger);
    expect(onEngage).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("dialog", { name: "Choose Voice Part" })).toBeVisible();
  });

  it("dismisses the hint and returns focus to the visible selector control", async () => {
    const user = userEvent.setup();
    const { onDismissHint } = renderHinted();

    const dismiss = screen.getByRole("button", { name: "Dismiss voice-part tip" });
    await user.click(dismiss);
    expect(onDismissHint).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("combobox", { name: /Voice Part/i })).toHaveFocus();
  });

  it("uses section terminology when the Organization labels parts as sections", () => {
    render(
      <organizationTerminologyContext.Provider
        value={{
          partLabel: "Section",
          partLabelPlural: "Sections",
          performerLabel: "Singer",
          performerLabelPlural: "Singers",
          setPerformerLabel: () => undefined,
        }}
      >
        <PlayerPartSelector
          activeTrackKey="tutti"
          onSelectTrackKey={vi.fn()}
          showVoicePartHint
          trackKeys={["tutti", "s1"]}
        />
      </organizationTerminologyContext.Provider>,
    );
    expect(
      screen.getByText(
        "Your section may have its own recording. Select your section above to hear it when available.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss section tip" })).toBeInTheDocument();
    expect(document.querySelector(".public-player__part-trigger-label")).toHaveTextContent(
      "Section",
    );
  });
});
