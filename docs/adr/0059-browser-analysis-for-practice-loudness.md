# Analyze practice loudness in the administrator browser

**Status:** accepted (owner decision in issue #277, October 20, 2026).

Analyze attached MP3 originals incrementally in one administrator browser module Worker using pinned
`mpg123-decoder` 1.0.3 and `bravoh-loudness` 0.1.0 behind a narrow adapter. Meter original mono or
stereo channels, with strict MPEG frame validation. Do not analyze in the Cloudflare Worker, add a
processing provider, retain whole-file PCM, or rewrite originals. Other audio formats remain
playable.

The Organization Durable Object owns analysis and resumable leased claims. Bind results to file ID
and R2 upload version; recover legacy versions with an authorized R2 HEAD. Only Owners and
Administrators can start or submit analysis. These values are administrator-submitted metadata, not
cryptographically trusted measurements. Signed links receive only ready measurements for their
already-authorized audio. D1 remains control-plane only.

Apply constant browser gain targeting -18 LUFS, constrained by -1 dBTP headroom and a conservative
18 dB maximum boost, separately from user volume. Dynamic, peak-constrained recordings may remain
quieter. Missing or invalid measurements use unity gain. Downloads remain unchanged.

Keep `VITE_PRACTICE_LOUDNESS_ENABLED` unset until fixture, deployed CSP/WASM, bounded-resource and
physical iOS/Android background/lock-screen qualification passes. Turning it off preserves the
native media path. Do not substitute headless results for physical-device evidence. Meter
replacement, if reference parity fails, is limited to a validated browser libebur128 adapter under
the same architecture.
