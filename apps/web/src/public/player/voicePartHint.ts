import { useCallback, useEffect, useMemo, useState } from "react";

import { isFullMixKey } from "./format";
import type { RosterPartResolution, RosterPartStatus } from "./useRosterPart";

export type VoicePartHintProfileStatus = RosterPartStatus;

/**
 * Voice-part selector nudge (issue #279).
 *
 * The hint is a one-time, low-key invitation to use the *existing* part
 * selector. It never changes playback, audio selection, or any other player
 * UI; it only highlights the existing selector while eligible and hides
 * forever (per tab session) once dismissed or engaged.
 */

/** Maximum pending-profile window before the nudge treats lookup as unavailable (presentation only). */
export const VOICE_PART_HINT_GRACE_MS = 5000;

/** Versioned storage key; sessionStorage is origin-bound and one hostname resolves to one Organization. */
export const VOICE_PART_HINT_STORAGE_KEY = "choir.voice-part-hint:v1";

export interface VoicePartHintEligibility {
  /** A specific nonempty roster/profile part, if one is assigned (may be a full-mix alias). */
  readonly assignedVoicePart: string | null;
  /** The user explicitly activated the picker or chose a key (even the displayed default). */
  readonly selectorEngaged: boolean;
  /** The hint was dismissed via its × button in this tab session. */
  readonly hintDismissed: boolean;
  /** True once a still-unresolved lookup has passed the presentation grace window. */
  readonly graceElapsed: boolean;
  /** The player finished loading, has a playable recording, and renders its normal selector. */
  readonly playerReady: boolean;
  /** Profile lookup outcome. `loading` is only blocking before the grace window elapses. */
  readonly profileStatus: VoicePartHintProfileStatus;
  /** Distinct selectable keys offered by the current playlist/visible scope. */
  readonly trackKeys: readonly string[];
}

export function shouldShowVoicePartHint(input: VoicePartHintEligibility): boolean {
  if (!input.playerReady) return false;
  if (input.selectorEngaged || input.hintDismissed) return false;
  const settled = input.profileStatus !== "loading" || input.graceElapsed;
  if (!settled) return false;
  if (
    input.profileStatus === "assigned" &&
    input.assignedVoicePart &&
    !isFullMixKey(input.assignedVoicePart)
  ) {
    return false;
  }
  const distinctKeys = new Set(input.trackKeys);
  if (distinctKeys.size < 2) return false;
  return [...distinctKeys].some((key) => !isFullMixKey(key));
}

export function readVoicePartHintSuppressed(): boolean {
  try {
    return sessionStorage.getItem(VOICE_PART_HINT_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function writeVoicePartHintSuppressed(): void {
  try {
    sessionStorage.setItem(VOICE_PART_HINT_STORAGE_KEY, "suppressed");
  } catch {
    // Private-mode storage failures must not break the player.
  }
}

export interface VoicePartHintCopy {
  readonly dismissLabel: string;
  readonly hint: string;
  readonly pointer: string;
}

export function getVoicePartHintCopy(isSectionTerminology: boolean): VoicePartHintCopy {
  return {
    dismissLabel: isSectionTerminology ? "Dismiss section tip" : "Dismiss voice-part tip",
    hint: isSectionTerminology
      ? "Your section may have its own recording. Select your section above to hear it when available."
      : "Your individual part may have its own recording. Select your part above to hear it when available.",
    pointer: "Choose yours",
  };
}

/**
 * Presentation-state hook for the nudge. The five-second grace window only
 * gates *presentation*: a still-loading lookup is treated as unavailable
 * after the window elapses, while the underlying roster request keeps
 * running and a late assigned part hides the hint without touching playback.
 */
export function useVoicePartHint(input: {
  readonly assignedVoicePart: string | null;
  readonly hintDismissed: boolean;
  readonly playerReady: boolean;
  readonly profileStatus: VoicePartHintProfileStatus;
  readonly selectorEngaged: boolean;
  readonly trackKeys: readonly string[];
}): boolean {
  const [graceElapsed, setGraceElapsed] = useState(false);
  const { profileStatus } = input;
  useEffect(() => {
    if (profileStatus !== "loading") return;
    const timer = window.setTimeout(() => {
      setGraceElapsed(true);
    }, VOICE_PART_HINT_GRACE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [profileStatus]);
  const { assignedVoicePart, hintDismissed, playerReady, selectorEngaged, trackKeys } = input;
  return useMemo(
    () =>
      shouldShowVoicePartHint({
        assignedVoicePart,
        graceElapsed,
        hintDismissed,
        playerReady,
        profileStatus,
        selectorEngaged,
        trackKeys,
      }),
    [
      assignedVoicePart,
      graceElapsed,
      hintDismissed,
      playerReady,
      profileStatus,
      selectorEngaged,
      trackKeys,
    ],
  );
}

export interface VoicePartNudgeControls {
  readonly dismissVoicePartHint: () => void;
  readonly markSelectorEngaged: () => void;
  readonly showVoicePartHint: boolean;
}

/**
 * Tab-session nudge state for the shared player. Tracks explicit selector
 * engagement separately from playback-driven overrides, persists dismissal
 * or engagement to sessionStorage, and computes hint eligibility. Playback
 * selection itself is untouched.
 */
export function useVoicePartNudge(input: {
  readonly playerReady: boolean;
  readonly rosterProfile: RosterPartResolution | undefined;
  readonly trackKeys: readonly string[];
}): VoicePartNudgeControls {
  const [selectorEngaged, setSelectorEngaged] = useState(() => readVoicePartHintSuppressed());
  const [hintDismissed, setHintDismissed] = useState(false);
  const markSelectorEngaged = useCallback(() => {
    writeVoicePartHintSuppressed();
    setSelectorEngaged(true);
  }, []);
  const dismissVoicePartHint = useCallback(() => {
    writeVoicePartHintSuppressed();
    setHintDismissed(true);
  }, []);
  const profileStatus = input.rosterProfile?.status ?? "loading";
  const assignedVoicePart =
    profileStatus === "assigned" ? (input.rosterProfile?.voicePart ?? null) : null;
  const showVoicePartHint = useVoicePartHint({
    assignedVoicePart,
    hintDismissed,
    playerReady: input.playerReady,
    profileStatus,
    selectorEngaged,
    trackKeys: input.trackKeys,
  });
  return { dismissVoicePartHint, markSelectorEngaged, showVoicePartHint };
}
