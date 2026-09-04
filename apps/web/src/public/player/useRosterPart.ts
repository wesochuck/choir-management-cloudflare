import { useEffect, useState } from "react";

import { getMemberProfile } from "../../api";

/**
 * Best-effort roster voice part for seeding the player's initial part selection. Returns null
 * for anonymous visits (the request simply fails without a session) and when the profile
 * carries no part; callers keep their default selection in both cases.
 */
export function useRosterPart(): string | null {
  const [rosterPart, setRosterPart] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getMemberProfile(controller.signal)
      .then((profile) => {
        if (!controller.signal.aborted && profile.voicePart.trim()) {
          setRosterPart(profile.voicePart);
        }
      })
      .catch(() => {
        // No session — callers keep their default part selection.
      });
    return () => {
      controller.abort();
    };
  }, []);

  return rosterPart;
}
