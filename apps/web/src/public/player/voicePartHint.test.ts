import { describe, expect, it } from "vitest";

import {
  getVoicePartHintCopy,
  readVoicePartHintSuppressed,
  shouldShowVoicePartHint,
  VOICE_PART_HINT_GRACE_MS,
  VOICE_PART_HINT_STORAGE_KEY,
  writeVoicePartHintSuppressed,
  type VoicePartHintEligibility,
} from "./voicePartHint";

function eligible(overrides: Partial<VoicePartHintEligibility> = {}): VoicePartHintEligibility {
  return {
    assignedVoicePart: null,
    graceElapsed: true,
    hintDismissed: false,
    playerReady: true,
    profileStatus: "unassigned",
    selectorEngaged: false,
    trackKeys: ["tutti", "tenor"],
    ...overrides,
  };
}

describe("shouldShowVoicePartHint", () => {
  it("shows for an unassigned profile with meaningful alternatives", () => {
    expect(shouldShowVoicePartHint(eligible())).toBe(true);
  });

  it("shows for anonymous/unavailable profiles and mix-only preferences", () => {
    expect(shouldShowVoicePartHint(eligible({ profileStatus: "unavailable" }))).toBe(true);
    expect(
      shouldShowVoicePartHint(
        eligible({ assignedVoicePart: "Choir Mix", profileStatus: "assigned" }),
      ),
    ).toBe(true);
  });

  it("hides while the profile lookup is pending inside the grace window", () => {
    expect(
      shouldShowVoicePartHint(eligible({ graceElapsed: false, profileStatus: "loading" })),
    ).toBe(false);
  });

  it("permits the hint after the grace window when lookup never resolves", () => {
    expect(
      shouldShowVoicePartHint(eligible({ graceElapsed: true, profileStatus: "loading" })),
    ).toBe(true);
  });

  it("suppresses for a specific assigned individual part, even without a matching recording", () => {
    expect(
      shouldShowVoicePartHint(
        eligible({ assignedVoicePart: "Tenor 2", profileStatus: "assigned" }),
      ),
    ).toBe(false);
    expect(
      shouldShowVoicePartHint(
        eligible({
          assignedVoicePart: "T2",
          profileStatus: "assigned",
          trackKeys: ["tutti", "s1"],
        }),
      ),
    ).toBe(false);
  });

  it("hides when only full-mix aliases, one key, or no keys are offered", () => {
    expect(shouldShowVoicePartHint(eligible({ trackKeys: ["tutti"] }))).toBe(false);
    expect(shouldShowVoicePartHint(eligible({ trackKeys: ["tutti", "Choir Mix"] }))).toBe(false);
    expect(shouldShowVoicePartHint(eligible({ trackKeys: [] }))).toBe(false);
    expect(shouldShowVoicePartHint(eligible({ trackKeys: ["tutti", "tutti"] }))).toBe(false);
  });

  it("treats configured section and custom non-mix keys as real choices", () => {
    expect(shouldShowVoicePartHint(eligible({ trackKeys: ["tutti", "S"] }))).toBe(true);
    expect(shouldShowVoicePartHint(eligible({ trackKeys: ["tutti", "accompaniment"] }))).toBe(true);
    expect(shouldShowVoicePartHint(eligible({ trackKeys: ["soprano1", "alto1"] }))).toBe(true);
  });

  it("hides after engagement, dismissal, or before the player is ready", () => {
    expect(shouldShowVoicePartHint(eligible({ selectorEngaged: true }))).toBe(false);
    expect(shouldShowVoicePartHint(eligible({ hintDismissed: true }))).toBe(false);
    expect(shouldShowVoicePartHint(eligible({ playerReady: false }))).toBe(false);
  });

  it("keeps the grace window at five seconds", () => {
    expect(VOICE_PART_HINT_GRACE_MS).toBe(5000);
  });
});

describe("voice-part hint session persistence", () => {
  it("uses a versioned key and degrades gracefully without storage", () => {
    expect(VOICE_PART_HINT_STORAGE_KEY).toBe("choir.voice-part-hint:v1");
    sessionStorage.clear();
    expect(readVoicePartHintSuppressed()).toBe(false);
    writeVoicePartHintSuppressed();
    expect(readVoicePartHintSuppressed()).toBe(true);
    expect(sessionStorage.getItem(VOICE_PART_HINT_STORAGE_KEY)).toBe("suppressed");
  });
});

describe("voice-part hint copy", () => {
  it("uses the exact approved wording for both terminologies", () => {
    expect(getVoicePartHintCopy(false)).toEqual({
      dismissLabel: "Dismiss voice-part tip",
      hint: "Your individual part may have its own recording. Select your part above to hear it when available.",
      pointer: "Choose yours",
    });
    expect(getVoicePartHintCopy(true)).toEqual({
      dismissLabel: "Dismiss section tip",
      hint: "Your section may have its own recording. Select your section above to hear it when available.",
      pointer: "Choose yours",
    });
  });
});
