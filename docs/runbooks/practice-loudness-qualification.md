# Practice loudness qualification

Issue: [#277](https://github.com/wesochuck/choir-management-cloudflare/issues/277). Architecture:
[ADR 0059](../adr/0059-browser-analysis-for-practice-loudness.md).

The feature is **disabled by default**. `VITE_PRACTICE_LOUDNESS_ENABLED=true` enables both
administrator analysis and playback routing at build time. For staging testing,
`scripts/deploy-staging-local.mjs` configures `VITE_PRACTICE_LOUDNESS_ENABLED=true` by default
during staging qualification and deployment so operators can validate physical-device matrix
scenarios in the staging environment. Roll back playback by rebuilding with the flag unset; the
additive Organization schema 120 and original R2 files remain compatible with the prior Worker.
Never reverse an applied migration. No production resources are involved.

Local coverage includes synthetic complete-MP3 FFmpeg reference measurements at 32/44.1/48 kHz,
mono/stereo (dual-mono stereo is kept stereo), CBR/VBR, ID3 metadata, gapless decoded sample count,
137-byte, 32 KiB and 64 KiB input boundaries, high intersample peaks, dynamic-level changes,
silence, missing Xing headers, truncation and cancellation. These fixtures are generated locally; no
choir recordings or personal data are included. Run:

```sh
npx vitest run apps/web/src/account/loudness/analyzeMp3Stream.test.ts apps/worker/src/organization/loudnessStore.test.ts packages/domain/src/loudness.test.ts
```

Regenerate fixtures with `python3 scripts/generate-loudness-fixtures.py /absolute/path/to/ffmpeg`.
The script uses FFmpeg only for reference measurements and synthetic test MP3s; it is not part of
application builds or runtime. Tolerances: integrated LUFS within 0.05 LU (rounded FFmpeg output),
true peak within 0.3 dB, exact decoded sample counts for generated gapless fixtures. Broader EBU
Tech 3341 conformance, high-frequency intersample-peak and dynamic choir fixtures remain release
gates.

Each analysis reads at most 20 MiB compressed data in <=64 KiB decoder calls and at most two hours
of decoded samples. The worker is terminated after ten minutes, on Pause, and on panel unmount. One
worker is active per tab and one two-minute claim per Organization; claims renew every 30 seconds.
Closing a tab leaves a reclaimable lease. Completed results persist immediately.
Administrator-started snapshots deduplicate attached files (maximum 10,000), exclude scores and
unrelated assets, and save piece IDs so commit validation reads indexed music-piece identities.
Polling/claiming reads the indexed job list. R2 HEAD happens on claim and result submission, not
singer playback. Original download/range routes are unchanged.

## Required evidence before rollout

- Independent EBU integrated loudness and oversampled true-peak fixtures including silence,
  near-full scale, transients, alternating dynamics, ID3 variants, corruption and gapless tail
  behavior.
- Memory/CPU evidence on maximum-size, long accepted MP3s; cancellation during fetch and decode.
- Real staging CSP response with nonce and `'wasm-unsafe-eval'`, without `'unsafe-eval'`; module
  Worker and bundled decoder WASM instantiate in Safari and Chrome. No remote decoder CDN is
  allowed.
- `npm run check:ci`, then `npm run check:release` before any authorized staging promotion.
- Physical-device comparison of native baseline and enabled normalization. Physical iOS Safari was
  confirmed passed by the operator on October 21, 2026.

| Scenario                                        | Physical iOS Safari | Physical Android Chrome |
| ----------------------------------------------- | ------------------- | ----------------------- |
| Speaker, unlocked, play/pause/seek              | Passed              | Pending                 |
| Lock screen, continuous audio, next source      | Passed              | Pending                 |
| Background app switch, return, unlock           | Passed              | Pending                 |
| OS Media Session play/pause/seek/next/previous  | Passed              | Pending                 |
| Wired headphones and Bluetooth route changes    | Passed              | Pending                 |
| Offline blob, part switch, retry and rapid next | Passed              | Pending                 |
| Empty playlist transition, navigation/unmount   | Passed              | Pending                 |

If Web Audio breaks a required configuration, keep the flag off and preserve native playback. Report
observed behavior before proposing derivatives or other architectural changes. An AudioContext
resume failure after routing cannot universally be repaired by restoring native output on the same
element; physical testing is essential. Do not describe graceful initialization fallback as
universal recovery.

## Operator diagnostics

Organization-local `audio_loudness` records contain status, version, measurement, reason and exact
meter/decoder provenance. Never include audio bytes, signed tokens or storage paths in diagnostics.
Use `practiceLoudnessGain` to derive requested/applied dB and peak-cap diagnostics. Administrator
Settings provides Start/Resume, Pause, Retry failed, confirmed Reanalyze all, and aggregate
progress. Unknown/pending/failed/unsupported tracks play unchanged without singer-facing errors.

The pre-existing signed-token metadata cache keys are a separate security follow-up identified in
issue #277; this feature adds no signed tokens to measurements or processing claims.

## Local evidence (October 20, 2026)

The real-media Chromium desktop and Pixel-7-emulated Chromium tests passed bundled module-Worker
loading, WASM instantiation under the application CSP, MP3 decoding and nonzero Web Audio output.
Run `npm run test:e2e -- loudness.spec.ts --workers=1`. These tests do not mock media APIs, but also
do not establish physical-phone, Safari, Bluetooth, background or lock-screen compatibility.

Fixture generation used local FFmpeg 7.1 (the version is recorded in `reference.json`); FFmpeg is
not an application dependency. The analyzer worker is emitted as a separate ~92 KB bundle by Vite.
The dependency audit is clean after patching Hono to 4.13.13 and all Vite copies to 8.1.6.

Chromium 149.0.7827.55 headless also completed these synthetic administrator-worker benchmarks:

| Input                          | Compressed bytes | Analysis time | Main-thread 50 ms timer ticks | Peak worker JS heap | Peak worker backing storage |
| ------------------------------ | ---------------: | ------------: | ----------------------------: | ------------------: | --------------------------: |
| 52 s stereo, 48 kHz, 320 kbps  |        2,082,284 |       0.884 s |                            17 |             1.6 MiB |                    27.6 MiB |
| 520 s stereo, 48 kHz, 320 kbps |       20,802,284 |       7.214 s |                           143 |             1.5 MiB |                   114.7 MiB |
| 5,200 s mono, 32 kHz, 32 kbps  |       20,800,448 |      20.309 s |                           405 |             3.8 MiB |                   184.2 MiB |

The long-file result contains exactly 166,400,000 mono samples. Decoded batches are discarded;
whole-track forced-stereo PCM would exceed 1.2 GiB for this case. CDP backing storage includes
ArrayBuffers/WASM and garbage awaiting collection; it is not a resident-memory measurement or a
Safari memory guarantee. This is a substantial administrator-browser memory cost, and Safari plus
physical-device resource qualification remains pending. Ordinary singer playback never runs this
analysis. Timings include synthetic local fetch and worker startup and vary with the machine.

To reproduce after `npm run build`, generate the near-limit long input and run the committed
harness:

```sh
/absolute/path/to/ffmpeg -hide_banner -loglevel error -f lavfi \
  -i 'aevalsrc=0.04*sin(2*PI*997*t):s=32000:d=5200' \
  -ac 1 -c:a libmp3lame -b:a 32k -y /tmp/choir-loudness-long.mp3
node scripts/benchmark-loudness-browser.mjs /tmp/choir-loudness-long.mp3
```

The harness serves only the supplied synthetic audio and bundled worker on an ephemeral loopback
port with the application's CSP; it prints measurements and resource counters, never audio bytes.

## Open WebKit source-transition evidence

The expanded actual shared-player test passes in desktop/mobile Chromium with the flag both enabled
and disabled. WebKit starts the first recording but remains at time zero after Next track in both
modes. This is not isolated to enabling Web Audio, but has not been compared with untouched HEAD and
must not be called a confirmed pre-existing defect. The bundled analyzer/MP3/Web Audio harness
passes in all three engines. Rollout remains OFF. See [the handoff](../goal/ISSUE-277-HANDOFF.md)
for logs, artifacts, exact commands and the next diagnostic step. Physical-phone qualification
remains pending.
