import { useEffect, useState } from "react";

import { getMemberProfile } from "../../api";

export type RosterPartStatus = "loading" | "assigned" | "unassigned" | "unavailable";

export interface RosterPartResolution {
  readonly status: RosterPartStatus;
  readonly voicePart: string | null;
}

const INITIAL_RESOLUTION: RosterPartResolution = { status: "loading", voicePart: null };

/**
 * Best-effort roster voice part plus lookup status. Returns "assigned" only
 * for a specific nonempty part; "unassigned" when the profile loads without
 * one; "unavailable" when the request fails (anonymous visits) or is
 * aborted. Callers keep their default selection for every non-assigned
 * outcome, and late resolutions flow through the existing initial-track
 * guard in the shared player.
 */
export function useRosterPartStatus(): RosterPartResolution {
  const [resolution, setResolution] = useState<RosterPartResolution>(INITIAL_RESOLUTION);

  useEffect(() => {
    const controller = new AbortController();
    void getMemberProfile(controller.signal)
      .then((profile) => {
        if (controller.signal.aborted) return;
        const voicePart = profile.voicePart.trim();
        setResolution(
          voicePart ? { status: "assigned", voicePart } : { status: "unassigned", voicePart: null },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResolution({ status: "unavailable", voicePart: null });
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  return resolution;
}

/**
 * Best-effort roster voice part for seeding the player's initial part selection. Returns null
 * for anonymous visits (the request simply fails without a session), while loading, and when
 * the profile carries no part; callers keep their default selection in all these cases.
 */
export function useRosterPart(): string | null {
  return useRosterPartStatus().voicePart;
}
