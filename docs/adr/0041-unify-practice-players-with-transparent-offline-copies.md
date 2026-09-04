# Unify practice players around the signed-link player with transparent Offline Copies

**Status:** accepted

Practice playback converges on a single player UI rooted in the signed-link Practice Player, fed by
per-route source adapters (signed-link token on the public route, session auth in the member app);
the authenticated LearningTrackPlayer is retired once the session adapter reaches parity. Offline
playback uses Offline Copies that transparently auto-cache the open event's tracks for the singer's
selected voice part plus the full-mix fallback under a 300 MB cap with oldest-first eviction (each
save and background refresh renews recency), because a cached copy grants nothing the existing
per-track download does not already grant.

**Considered Options:** Offline support in the authenticated player only. Rejected because the goal
is one player, and the signed-link player is both the richer UI (MediaSession, artwork, part
fallback) and the preferred one. Strict revocation of held copies on link rotation or expiry.
Rejected because it is unenforceable against downloads and would revoke rehearsal tracks in exactly
the offline situations the feature exists for. Whole-event auto-cache. Rejected in favor of
part-scoped caching to minimize mobile data. Keeping both players with shared hooks. Rejected
because it preserves two players.

**Consequences:** Link rotation or expiry never revokes held copies; refresh is best-effort whenever
the player is online with a live token, and tokens are never persisted alongside cached bytes.
Cached records carry their Organization ID when the source knows it (the signed-link server does not
expose it today, so token copies record a null ID); sign-out and observed membership loss purge the
scope's session-source copies — one host serves one Organization in the member app, so this is
organization-precise in practice — while token-source copies are link-holder data independent of any
session and are left untouched. Switching the active Organization never purges anything. Switching
voice parts offline to a part that was never cached shows a connect-to-download state instead of
playing anything.

**Roster-seeded part selection:** Whenever a session exists — on the member route and on public
links alike — the player's initial voice-part selection is seeded from the singer's roster
`voicePart`, matched through the existing track-resolution normalization with its usual fallback.
Anonymous visits keep the current default. The seed applies per load only; any manual pick wins for
the visit, so the roster stays the source of truth for permanent part changes.
