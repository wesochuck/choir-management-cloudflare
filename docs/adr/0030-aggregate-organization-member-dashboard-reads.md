# Aggregate Organization Member Dashboard Reads

**Status: accepted.** The Organization Member Dashboard will read its authorized overview from one
member-only dashboard response containing the applicable event and optional widget data, while
mutations such as RSVP changes, poll responses, checkout, and resource access remain on their
focused endpoints. This keeps the Organization/Profile authorization boundary and dashboard view
consistent without forcing the browser through a request waterfall. Active Engagement Polls are
surfaced in the response but continue through the existing personalized-link flow so arbitrary
options and multiple-choice polls do not acquire a second authenticated response model. Practice
actions use the existing signed Practice Player Link flow, so members can open and share event
tracks without being forced through a second login. These links are event-wide rather than
recipient-scoped and expose published practice content only, never member-specific Profile details.
Each event reuses one shareable link until its expiry or an administrator rotates it. The default
lifetime is 180 days and is configurable per Organization. Rotation immediately revokes the prior
link and starts a fresh lifetime for the replacement. Access re-checks eligibility, so canceled or
archived events and events whose approved Set List was unpublished show an unavailable state rather
than serving practice audio. Linked Rehearsals use their own approved practice list when present and
otherwise inherit the parent Performance's approved list, including the existing Tutti fallback for
missing voice-part tracks. An inherited Rehearsal reuses the parent Performance's stable Practice
Player Link; only a Rehearsal with its own approved list receives a separate link. The dashboard
treats event/profile data as core and optional widgets as independently available: core-read failure
blocks the dashboard with retryable feedback, while an optional-widget failure preserves the other
content and exposes a widget-level unavailable state instead of an empty-state substitution.
`/dashboard` is the default signed-in landing page for Organization Members; administrators retain
the Organization Admin Overview as their administrative landing page.
