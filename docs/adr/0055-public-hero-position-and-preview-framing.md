# ADR 0055: Public hero image positioning and preview framing

Status: Accepted

The website editor previews desktop content at 1280 CSS pixels and mobile content at 390 CSS pixels,
scaled to fit the preview panel. The public hero component and original image are reused; the
preview must not fit the whole source image into the narrow editor column. Header layout and hero
typography follow the selected reference viewport. The reference width is visible to explain
responsive cropping at other screen sizes.

Each Organization website draft can store a bounded horizontal/vertical percentage focal point.
Migration 116 adds two columns with centered (50, 50) defaults, preserving existing images and
published content. Older payloads and clients may omit the position. The public renderer defaults to
center when absent. Original uploaded files remain unchanged. No image processing, new provider
calls, indexes, or endpoints are introduced.

Administrators can drag a cover-scaled crop, use arrow keys, set accessible range controls, or
restore the center. Dragging uses rendered overflow dimensions and clamps to image edges. One
position applies across screen sizes; desktop and mobile crop checks are available. These edits
participate in the existing draft dirty guard, save snapshot isolation, and explicit immutable
publication flow. Preview does not publish edits.

Rollback retains the additive columns; older binaries ignore focal-point settings and display
centered images. Republishing from an older binary can omit positioning from that projection; the
stored columns remain available after upgrading again.
