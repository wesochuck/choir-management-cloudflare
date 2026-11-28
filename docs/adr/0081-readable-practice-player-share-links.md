# Readable Practice Player share links

Accepted. Set List Manager copies `/practice/{performance-name}#{code}` and uses the same format for
its QR code. A share link opens the approved event Set List without sign-in. Allocate the lowercase,
hyphenated title once on first sharing and keep it across renames, renewals, and rotations. Limit
titles to 48 slug characters. Duplicate titles can share a slug because the code selects the event.

The 22-character code carries 128 bits of a purpose-separated HMAC over the Organization, event, and
active link nonce. The nonce comes from the existing cryptographically random link generation.
Organization storage keeps the slug and a SHA-256 digest of the code. A partial unique index
supports the point lookup on redemption. Saving the short format matches the current nonce and never
changes the signed link's expiry. The fragment stays on the device until the player sends the code
in the body of a rate-limited POST. The browser keeps the readable URL and uses the existing signed
token in memory for playback. Offline Copies use local audio and cached playlist metadata keyed by a
digest.

The hostname selects the Organization before lookup. The code and slug must match its active,
unexpired link, and access still requires a published, playable event. Existing signed URLs continue
to work under their current expiry, publication, and rotation rules. The signed URL and readable URL
share one generation, so either expiry or rotation ends both. Recipient-specific calendar and
communication links retain their existing contracts.

Organization schema migration 152 is additive. An older Worker can read and rotate the original link
columns. On roll-forward, redemption derives the expected code from the current nonce so a rotation
during rollback cannot restore the old code. A rollback to a frontend or Worker predating this
change temporarily makes the short format unavailable. The signed URL remains usable under the usual
access rules.
