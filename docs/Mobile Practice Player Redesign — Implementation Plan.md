# Mobile Practice Player Redesign — Implementation Plan

## Objective

Redesign the existing public Practice Player into a mobile-first music-player experience while
preserving the existing token/security model and playback behavior.

Primary goals:

1. Make the player feel like a dedicated mobile music player rather than a web form.
2. Use the artwork/graphic from the **event associated with the set list** as the player artwork. Do
   not introduce per-piece cover art.
3. Make voice/part selection quick and obvious.
4. Keep the set list readily accessible without requiring it to occupy most of the initial screen.
5. Preserve existing practice features such as repeat, start-at, gaps, volume, Tutti fallback,
   downloads, and track selection.
6. Maximize reliable **background audio playback on iOS and Android**, including lock-screen/media
   controls where the browser supports them.
7. Maintain keyboard, screen-reader, touch-target, contrast, reduced-motion, and general WCAG
   accessibility.

## Existing Architecture to Preserve

Do not rewrite the playback engine unless necessary.

The current implementation already has:

- `apps/web/src/public/PublicPlayerView.tsx`
- one persistent HTML `<audio>` element
- custom progress and transport controls
- playlist sequencing
- Tutti fallback
- voice-part selection
- previous/next
- repeat none/all/one
- start-at time
- gap between tracks
- volume
- signed media URLs
- event-scoped file authorization

Keep those behaviors.

The mobile redesign is a component and layout refactor around the existing playback controller and
state machine.

Do **not** replace the HTML `<audio>` element with Web Audio / `AudioContext`. Native HTML media
playback is required for reliable mobile background and lock-screen playback.

---

# Phase 1 — Extend Player Data With Event Artwork & Contract Schemas

The event schema in the Durable Object SQLite database already contains:

`public_graphic_file_id` (nullable UUID string)

### 1.1 Worker Store Queries

Update:

`apps/worker/src/organization/playerStore.ts`

For both:

- `readPlayerDetailsFromStore()`
- `readPlayerPlaylistFromStore()`

Extend the event query to select `public_graphic_file_id`:

```sql
SELECT id, set_list_json AS setListJson, starts_at AS startsAt, title,
       public_graphic_file_id AS publicGraphicFileId
FROM events
WHERE id = ? AND is_archived = 0 AND is_canceled = 0 AND set_list_approved = 1
LIMIT 1
```

Return the normalized property from both internal DO responses:

```ts
eventArtworkFileId: eventRow.publicGraphicFileId ?? null,
```

### 1.2 Shared Contract Schemas

Update:

`packages/contracts/src/player.ts`

Extend `publicPlayerDetailsResponseSchema`:

```ts
export const publicPlayerDetailsResponseSchema = z.object({
  eventId: z.uuid(),
  eventTitle: z.string(),
  eventStartsAt: z.string(),
  eventArtworkFileId: z.string().uuid().nullable().optional(),
  items: z.array(playerPlaylistItemSchema),
  performerLabel: z.string().optional(),
  profileId: z.string(),
  profileName: z.string(),
});
```

### 1.3 Public Playlist Route Pass-Through

Update:

`apps/worker/src/routes/publicEngagement.ts`

In the `GET /api/public/player/playlist` handler, update the response validation and payload mapping
so `eventArtworkFileId` is preserved in the public response:

```ts
const playlist = z
  .object({
    eventArtworkFileId: z.string().uuid().nullable().optional(),
    eventId: z.uuid(),
    eventStartsAt: z.iso.datetime(),
    eventTitle: z.string().min(1).max(500),
    items: z.array(z.record(z.string(), z.unknown())).max(500),
    performerLabel: z.string().trim().min(1).max(50).default("Performer"),
  })
  .safeParse(details);
```

And in the returned JSON structure:

```ts
return context.json({
  allPieces: playlist.data.items,
  event: {
    artworkFileId: playlist.data.eventArtworkFileId ?? null,
    date: playlist.data.eventStartsAt,
    id: playlist.data.eventId,
    title: playlist.data.eventTitle,
  },
  pieces: playlist.data.items,
  performerLabel: playlist.data.performerLabel,
  requestId: context.get("requestId"),
  setList: playlist.data.items,
  voiceParts: [],
});
```

### 1.4 Frontend Type Definitions & Data Fetching

Update:

`apps/web/src/public/PublicPlayerView.tsx`

Extend `PlayerDetails` interface:

```ts
interface PlayerDetails {
  readonly eventArtworkFileId?: string | null;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventStartsAt: string;
  readonly items: PlayerPlaylistItem[];
  readonly performerLabel?: string;
  readonly profileName?: string;
}
```

Update `isPlayerDetails()` and `fetchPublicPlayerPlaylist()` to parse `event.artworkFileId` or
`eventArtworkFileId`.

### 1.5 Artwork Presentation & Fallback

Use the event artwork for all songs in the set list. Conceptual metadata:

- Track title = music piece title
- Artist = composer / arranger if available (fallback to `performerLabel` or Organization name)
- Album / collection = event title
- Artwork = event's `publicGraphicFileId`

If no event graphic exists (`eventArtworkFileId == null`), render an attractive branded placeholder
(e.g. musical icon with themed gradient background). Do not display broken images or empty
containers.

---

# Phase 2 — Authorize Event Artwork Through the Player Media Route

Continue using:

`/api/public/player/media/:fileId?token=...`

rather than exposing event graphics through an unauthenticated route.

Update:

`apps/worker/src/routes/publicEngagement.ts`

In `router.get("/api/public/player/media/:fileId")`:

Extend `mediaScope` schema validation on the resolved player details:

```ts
const mediaScope = z
  .object({
    eventArtworkFileId: z.string().uuid().nullable().optional(),
    items: z.array(
      z.object({
        trackFileIds: z.record(z.string(), z.string()),
      }),
    ),
  })
  .safeParse(playerDetails);
```

Allow media access when either:

1. `mediaScope.data.eventArtworkFileId && fileId.data === mediaScope.data.eventArtworkFileId`
2. `mediaScope.data.items.some(({ trackFileIds }) => Object.values(trackFileIds).includes(fileId.data))`

This enforces strict tenant and token isolation: **a player token can only access audio tracks and
the event artwork associated with that specific event.**

Create a shared frontend helper:

```ts
function playerMediaUrl(fileId: string, token: string): string {
  return `/api/public/player/media/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`;
}
```

Use it consistently for both audio tracks and event artwork.

---

# Phase 3 — Complete HTTP Range Support for Player Audio

`apps/worker/src/storage/privateFiles.ts` already implements
`readPrivateOrganizationFile(env, organizationId, fileId, rangeHeader)` with byte range parsing and
`PrivateFileStorageError("range_not_satisfiable", ...)`.

Wire Range support into the public media route in `apps/worker/src/routes/publicEngagement.ts`:

```ts
const rangeHeader = context.req.header("range") ?? null;

try {
  const file = await readPrivateOrganizationFile(
    context.env,
    resolved.value.organizationId,
    fileId.data,
    rangeHeader,
  );

  if (!file) {
    return context.json(
      {
        code: "file_not_found",
        message: "The requested file was not found.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      404,
    );
  }

  const { metadata, object, range } = file;

  if (range) {
    const end = range.offset + range.length - 1;
    return new Response(object.body, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(range.length),
        "Content-Range": `bytes ${range.offset}-${end}/${metadata.sizeBytes}`,
        "Content-Type": metadata.contentType,
      },
    });
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(metadata.sizeBytes),
      "Content-Type": metadata.contentType,
    },
  });
} catch (error: unknown) {
  if (error instanceof PrivateFileStorageError && error.kind === "range_not_satisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${error.sizeBytes ?? "*"}`,
      },
    });
  }

  return context.json(
    {
      code: "file_not_found",
      message: "The requested file was not found.",
      requestId: requestIdValue,
    } satisfies ProblemDetails,
    404,
  );
}
```

### Expected HTTP behavior:

1. **Standard Request (no Range header):**
   - Status `200 OK`
   - `Accept-Ranges: bytes`
   - `Content-Length: <full-size>`
   - `Content-Type: <file-content-type>`
2. **Valid Range Request (`Range: bytes=0-1023` or `Range: bytes=1024-`):**
   - Status `206 Partial Content`
   - `Accept-Ranges: bytes`
   - `Content-Range: bytes START-END/TOTAL`
   - `Content-Length: <range-length>`
   - `Content-Type: <file-content-type>`
3. **Invalid / Unsatisfiable Range (`Range: bytes=99999999-`):**
   - Status `416 Range Not Satisfiable`
   - `Accept-Ranges: bytes`
   - `Content-Range: bytes */TOTAL`

This enables instant seeking and smooth streaming on iOS Safari and Android Chrome.

---

# Phase 4 — Mobile Player Layout & Presentational Decomposition

Refactor `PublicPracticePlayer` into focused presentational components while keeping state
management consolidated in a single player controller hook or container.

Component structure:

```text
PublicPracticePlayer (State Container)
├── PlayerHeader (Event title, date, greeting)
├── PlayerArtwork (Square event graphic or placeholder)
├── PlayerTrackMetadata (Song title, composer/arranger, part badge)
├── PlayerPartSelector (Horizontal scroll of common parts + voice dropdown)
├── PlayerProgress (Seek slider, current time, total duration)
├── PlayerTransport (Previous, Play/Pause, Next)
├── PlayerSecondaryControls (Repeat toggle, Queue trigger, Settings trigger)
├── PlayerQueueSheet (Radix-backed bottom drawer with complete set list)
└── PlayerSettingsSheet (Radix-backed bottom drawer with rehearsal options)
```

## Mobile Layout Specification (< 640px)

```text
+------------------------------------+
|  < Practice Player                 |
|  Event Title · Date                |
+------------------------------------+
|                                    |
|       +--------------------+       |
|       |                    |       |
|       |   EVENT ARTWORK    |       |
|       |   (1:1 aspect)     |       |
|       |                    |       |
|       +--------------------+       |
|                                    |
|  Song Title (Large, Bold)          |
|  Composer / Arranger               |
|                                    |
|  [ Tutti ] [ Soprano ] [ Alto ]... |
|  [ Status: Playing Tutti (Fallback)|
|                                    |
|  ================O================ |
|  1:24                         3:52 |
|                                    |
|       [Prev]   (( PLAY ))   [Next] |
|                                    |
|  [Repeat: Off]  [Queue]  [Settings]|
+------------------------------------+
```

### Viewport and Sizing Rules:

- Use dynamic viewport sizing: `min-height: 100dvh` (with `100vh` fallback).
- Respect device safe areas:
  ```css
  padding-top: max(var(--spacing-md), env(safe-area-inset-top));
  padding-bottom: max(var(--spacing-md), env(safe-area-inset-bottom));
  padding-inline: max(var(--spacing-md), env(safe-area-inset-left));
  ```
- Artwork area:
  ```css
  aspect-ratio: 1;
  width: min(72vw, 20rem);
  max-height: 38vh;
  object-fit: cover;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-lg);
  margin-inline: auto;
  ```

---

# Phase 5 — Part & Voice Selection

Replace separate track pills and "Add part…" button with an accessible, mobile-optimized selector.

### Primary Voice Part Row:

Render available primary sections as a horizontally scrollable segmented track:

```css
display: flex;
gap: var(--spacing-xs);
overflow-x: auto;
scroll-snap-type: x proximity;
-webkit-overflow-scrolling: touch;
scrollbar-width: none;
```

- Each button has `role="button"`, `aria-pressed={activeTrackKey === key}`, and minimum touch target
  of 44×44px.
- Active state has high-contrast background and bold indicator (never relying on color alone).

### Split Voice Parts:

If individual voice parts exist (e.g. Soprano 1, Soprano 2, Tenor 1, Tenor 2):

- If <= 2 split parts exist, include them directly in the segmented scroll row.
- If > 2 split parts exist, provide a clearly labeled `<select aria-label="Voice part">` dropdown at
  the end of the segmented row.

### Tutti Fallback Status:

When a selected voice part is not available for the active piece and Tutti is played:

- Display an inline badge / status text: `Playing Tutti — [Part] track unavailable`.
- Add an accessible announcement using `role="status"` or `aria-live="polite"`.

---

# Phase 6 — Transport Controls & Touch Targets

Controls row:

- **Previous track button:** 48×48px minimum touch target, `aria-label="Previous track"`, disabled
  when on first track and loop mode is not "all".
- **Play / Pause button:** Dominant center button, 64×64px touch target, prominent primary accent
  styling, `aria-label={playing ? "Pause" : "Play"}`.
- **Next track button:** 48×48px minimum touch target, `aria-label="Next track"`, disabled when on
  last track and loop mode is not "all".

All icon buttons must have explicit accessible names via `aria-label` (not relying solely on SVG
`<title>`).

---

# Phase 7 — Progress & Seeking

- Use native `<input type="range" />` for accessibility and keyboard navigation.
- Expand the touch target vertically (minimum 36–44px height) with CSS pseudo-elements while keeping
  the visual track sleek (4–6px).
- Provide explicit ARIA value attributes:
  ```tsx
  <input
    aria-label={`Seek ${currentItem.title}`}
    aria-valuemin={0}
    aria-valuemax={Math.round(duration)}
    aria-valuenow={Math.round(currentTime)}
    aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
    max={duration || 1}
    min={0}
    step={0.1}
    type="range"
    value={Math.min(currentTime, duration || 0)}
    onChange={(e) => onSeek(Number(e.target.value))}
  />
  ```

---

# Phase 8 — Secondary Controls & Rehearsal Settings

Secondary controls row at the bottom of the player:

1. **Repeat toggle:** Cycles `Off → Repeat All → Repeat One → Off` with
   `aria-pressed={loopMode !== "none"}` and clear icon + status label.
2. **Queue trigger:** Opens the Set List bottom sheet with badge showing track count
   (`aria-expanded={queueOpen}`).
3. **Practice Settings trigger ("More"):** Opens the Rehearsal Settings bottom sheet
   (`aria-expanded={settingsOpen}`).

## Practice Settings Sheet:

Uses `@choir/ui`'s accessible `Sheet` primitive (Radix UI-backed):

- **Start track at:** Skip intro seconds (number input + step buttons).
- **Gap between tracks:** Silence duration between tracks (0s, 2s, 5s, 10s dropdown).
- **Volume:** 0–100% range slider with percentage readout.
- **Download current track:** Direct download link for the resolved track file.
- **Inline contextual help:** Plain language notes explaining what each setting does, replacing the
  separate "control guide" modal.

---

# Phase 9 — Set List & Queue Sheet

Replace the desktop-style always-visible set list card with an interactive queue drawer on mobile
screens.

### Queue Drawer Contents:

- Drawer header: "Set List" + total track count and Event title.
- Numbered track list:
  - Track number, Title, Composer / Arranger.
  - Active playing indicator: pulsating equalizer icon or "Now Playing" pill (not color-only).
  - Voice part availability badge (e.g. `Soprano`, `Tutti fallback`, or `Unavailable`).
  - Direct download button for each playable item.
- Selecting a track:
  1. Sets active track index.
  2. Begins playback.
  3. Closes the queue sheet and returns focus to the player.

---

# Phase 10 — Background Playback & Media Session Architecture

## 10.1 Single Persistent Audio Element

- Mount exactly one `<audio>` element at the root of `PublicPracticePlayer`.
- It must survive all sheet openings, settings changes, and part selections.
- Never unmount or recreate the `<audio>` element during track transitions.
- Maintain `preload="metadata"` (or `preload="auto"` once playback begins).

## 10.2 Audio Session API Enhancement (iOS 15+)

Progressively enhance with the Web Audio Session API when available:

```ts
if ("audioSession" in navigator) {
  try {
    (navigator as unknown as { audioSession: { type: string } }).audioSession.type = "playback";
  } catch {
    // Non-blocking fallback for older Safari versions
  }
}
```

## 10.3 Media Session API Integration & Safety Guards

Feature-detect `navigator.mediaSession`:

```ts
if ("mediaSession" in navigator) {
  // Update metadata
  navigator.mediaSession.metadata = new MediaMetadata({
    title: currentItem.title,
    artist: currentItem.composer || currentItem.arranger || details.performerLabel || "",
    album: details.eventTitle,
    artwork: eventArtworkUrl
      ? [{ src: eventArtworkUrl, sizes: "512x512", type: "image/jpeg" }]
      : [],
  });

  navigator.mediaSession.playbackState = playing ? "playing" : "paused";
}
```

### Safe `setPositionState` Updates:

Chrome and WebKit throw a `TypeError` if `setPositionState` is called with invalid duration or
out-of-bounds position. Apply strict defensive guards:

```ts
function updatePositionState(currentTime: number, duration: number): void {
  if (
    "mediaSession" in navigator &&
    "setPositionState" in navigator.mediaSession &&
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(currentTime) &&
    currentTime >= 0 &&
    currentTime <= duration
  ) {
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: audioRef.current?.playbackRate ?? 1,
        position: currentTime,
      });
    } catch {
      // Gracefully ignore position sync errors
    }
  }
}
```

### Action Handlers & Cleanup:

Register action handlers with defensive `try/catch` per action:

- `play` → `playCurrent()`
- `pause` → `togglePlay()`
- `previoustrack` → `previousTrack()`
- `nexttrack` → `nextTrack()`
- `seekbackward` → `seekRelative(-10)`
- `seekforward` → `seekRelative(10)`
- `seekto` → `onSeek(details.seekTime)`

**Cleanup on unmount:** In `useEffect` return handler, reset all registered Media Session action
handlers (`navigator.mediaSession.setActionHandler(action, null)`) to prevent memory leaks and
orphaned closures.

## 10.4 Background Gap-Between-Tracks Rule

JavaScript timers (`setInterval`, `setTimeout`) are throttled or suspended when mobile tabs are
backgrounded or the screen is locked.

**Rule:**

- Foreground (`document.visibilityState === "visible"`): Honor configured `gapSeconds` countdown.
- Background (`document.visibilityState === "hidden"`): Transition immediately to the next track on
  `ended` rather than waiting for a background timer.

This prevents the player from stalling indefinitely between tracks when the phone is locked in the
singer's pocket.

---

# Phase 11 — Playlist Transition Mechanics

On track `ended`:

1. Check loop mode:
   - `loopMode === "one"`: reset `audio.currentTime = startAt` and call `play()`.
   - `last track` and `loopMode !== "all"`: stop and set `playing = false`.
2. Determine next item index.
3. If `document.visibilityState === "hidden"` or `gapSeconds === 0`:
   - Call `selectItem(nextIndex, true)`.
   - Directly update `audio.src = nextSource` and invoke `audio.play().catch(...)`.
4. If foreground and `gapSeconds > 0`:
   - Run visible countdown timer before advancing.

---

# Phase 12 — Mobile Navigation & Token Security

- On initial load, the player token is extracted from URL query parameters and cleared from browser
  history via `window.history.replaceState(null, "", "/player")`.
- Preserve this security property.
- All Queue, Settings, and Help views must remain in-page modals/sheets without triggering browser
  navigation that would lose the active player token.

---

# Phase 13 — Accessibility & WCAG Standards

1. **Semantic Structure:** `<main class="public-player-layout">`, `<section aria-labelledby="...">`,
   `<header>`, `<ol>` for queue list.
2. **Focus Management:**
   - Opening a sheet moves focus inside.
   - Closing a sheet restores focus to the triggering button.
   - `Escape` key dismisses any open sheet.
3. **Live Regions:**
   - Track changes announce title and resolved part via `aria-live="polite"` status region.
   - Seek and time updates must **not** trigger live region announcements on every tick.
4. **Touch Targets:** All interactive controls have at least 44×44 CSS px touch target area.
5. **Reduced Motion:** Honor `@media (prefers-reduced-motion: reduce)` by disabling transition
   animations on drawer slides and artwork scale.
6. **Color & Contrast:**
   - Active track indicators use both visual badges/icons and distinct contrast borders.
   - High contrast ratios (>= 4.5:1 for normal text, >= 3:1 for large controls) across light and
     dark themes.

---

# Phase 14 — Responsive Desktop & Tablet Experience

Maintain a single unified component and state controller across all viewport widths.

### Breakpoints:

- **Mobile (< 768px / 48rem):** Single-column player card with bottom sheets for Queue and Settings.
- **Tablet & Desktop (>= 768px / 48rem):** Two-column layout:
  - Left column: Artwork, now-playing metadata, transport controls, rehearsal options.
  - Right column: Embedded set list / queue card with live track status.

The same playback engine, audio element, and state machine power both views.

---

# Phase 15 — Styling & CSS Architecture

Primary file:

`apps/web/src/styles/components/player.css`

Refactor the stylesheet to use clean, modular BEM classes:

- `.public-player-layout` (Page shell with `100dvh` and safe-area padding)
- `.public-player` (Responsive grid container)
- `.public-player__artwork-container` & `.public-player__artwork`
- `.public-player__metadata`
- `.public-player__part-selector`
- `.public-player__progress`
- `.public-player__transport`
- `.public-player__secondary-controls`
- `.public-player__sheet` (Bottom drawer modifiers using `@choir/ui` Sheet)
- `.public-player__queue-list`

Use design system tokens (`--color-surface`, `--color-surface-raised`, `--color-accent`,
`--radius-card`, `--spacing-*`, `--shadow-*`).

---

# Phase 16 — Testing & Verification Plan

## 16.1 Worker Integration Tests

File: `apps/worker/test/publicPlayer.integration.test.ts`

Add tests verifying:

1. `POST /api/public/player-details` returns `eventArtworkFileId` when present.
2. `GET /api/public/player/playlist` returns `artworkFileId` in the event object.
3. `GET /api/public/player/media/:artworkFileId?token=...` successfully downloads the event graphic.
4. Player token cannot download private files unrelated to the event.
5. HTTP Range requests:
   - `Range: bytes=0-99` returns `206 Partial Content` with correct
     `Content-Range: bytes 0-99/<total>` and `Content-Length: 100`.
   - Request with no Range returns `200 OK` with `Accept-Ranges: bytes`.
   - `Range: bytes=999999-` returns `416 Range Not Satisfiable` with
     `Content-Range: bytes */<total>`.

## 16.2 Web Frontend Unit & Component Tests

File: `apps/web/src/public/PublicPlayerView.test.tsx`

Add unit tests verifying:

1. Renders artwork when `eventArtworkFileId` is provided; renders branded placeholder when null.
2. Part switching correctly selects requested track or falls back to Tutti with visible message.
3. Transport controls (Play/Pause, Next, Previous, Repeat mode cycle).
4. Media Session metadata and playbackState updates.
5. `setPositionState` defensively ignores invalid/zero duration without throwing errors.
6. Action handlers cleanup on unmount.
7. Background visibility check: skips gap delay when `document.visibilityState === "hidden"`.

## 16.3 Playwright E2E Tests

File: `apps/web/e2e/player.spec.ts`

Update existing test suite to reflect new mobile-first component structure:

1. Validate player link required / error states.
2. Validate now-playing artwork, title, composer, and part selector.
3. Validate opening Queue sheet, inspecting set list tracks, selecting a track, and verifying active
   playback.
4. Validate opening Practice Settings sheet, adjusting start-at time, volume, and track gap.
5. Validate accessibility attributes (`aria-pressed`, `aria-expanded`, `aria-label`).

## 16.4 Parity & Quality Gates

Run all repository quality scripts:

```bash
npm run check:parity
npm run check:parity:implementation
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run build
```

---

# Phase 17 — Real Device Acceptance Testing

Automated tests must be supplemented with manual verification on physical mobile devices:

### iOS Safari (iPhone):

1. **Initial play:** Tap Play manually. Confirm audio starts.
2. **Lock screen:** Lock phone while playing. Confirm audio continues uninterrupted.
3. **Lock screen controls:** Test Play/Pause, Next Track, Previous Track from iOS Control Center /
   Lock Screen.
4. **Lock screen artwork:** Confirm Event artwork, Title, and Composer appear in iOS Now Playing
   widget.
5. **Background transition:** Let track reach end while screen is locked. Confirm next track begins
   automatically.
6. **App switching:** Switch to other apps (Safari backgrounded). Confirm audio continues.
7. **Unlock sync:** Unlock phone; confirm player UI (progress, active song, play state) is fully
   synchronized.

### Android Chrome:

1. Test notification drawer playback controls and artwork.
2. Test screen lock and track end auto-advance.
3. Test headset / Bluetooth media buttons (play/pause/skip).

---

# Implementation Order

1. **Backend contracts & queries:** Update `playerStore.ts`, `packages/contracts/src/player.ts`, and
   `routes/publicEngagement.ts` (Phase 1 & Phase 2).
2. **HTTP Range handling:** Update `routes/publicEngagement.ts` and add integration tests (Phase 3).
3. **Component decomposition:** Extract `PlayerArtwork`, `PlayerPartSelector`, `PlayerProgress`,
   `PlayerTransport`, `PlayerSecondaryControls` (Phases 4–7).
4. **Sheets & Set list:** Build `PlayerQueueSheet` and `PlayerSettingsSheet` using `@choir/ui` Sheet
   (Phases 8–9).
5. **Media Session & Background audio:** Wire `navigator.mediaSession`, `navigator.audioSession`,
   safe position state, and visibility-aware gap logic (Phases 10–11).
6. **CSS & Responsive layout:** Refactor `player.css` for mobile viewport and desktop two-column
   grid (Phases 14–15).
7. **Test suites:** Update `publicPlayer.integration.test.ts`, add frontend unit tests, and update
   `player.spec.ts` (Phase 16).
8. **Real device verification:** Test on physical iOS and Android devices (Phase 17).

---

# Definition of Done

The redesign is complete when:

- [ ] The mobile player looks and feels like a native music player app.
- [ ] Event artwork is displayed on screen and in lock-screen media controls where supported.
- [ ] Voice part selection is intuitive with clear Tutti fallback messaging.
- [ ] Queue and Settings operate seamlessly in accessible bottom sheets on mobile and side panels on
      desktop.
- [ ] Persistent HTML `<audio>` element provides smooth background playback on iOS and Android.
- [ ] Media Session metadata, position state, and transport controls work reliably without errors.
- [ ] Background track transitions do not stall due to suspended JS timers.
- [ ] HTTP byte range requests (206 / 416 / 200) function properly on media endpoints.
- [ ] Token security and tenant isolation are completely preserved.
- [ ] All automated unit, integration, and E2E tests pass.
- [ ] Parity checks (`check:parity`, `check:parity:implementation`) pass without regressions.
