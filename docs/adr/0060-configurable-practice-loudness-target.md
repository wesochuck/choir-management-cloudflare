# 0060: Configure the Organization practice loudness target

Status: Accepted

Date: 2026-10-21

## Context

ADR 0059 fixes practice playback at −18 LUFS. The maintainer requests an editable target alongside
analysis status and recording repair controls in Music Library Settings.

## Decision

Amend only the fixed target in ADR 0059. Owners and Administrators may choose an Organization target
from −30 to −10 LUFS; the default remains −18 LUFS. Persist it in Organization metadata, validate it
at the settings boundary and SQLite constraint, and audit settings updates. Omitted values in older
update requests preserve the saved target.

Measurements remain independent of the playback target. Ready, version-bound measurements carry
current `targetLufs` playback configuration through existing authorized catalog and signed-player
responses. Playback uses that target with the unchanged −1 dBTP ceiling and 18 dB maximum boost.
Missing or invalid targets fall back to −18 LUFS. Changing the target takes effect when recordings
are next loaded, without reanalysis, recompression, or replacement of original bytes. Offline
snapshots retain their loaded target until refreshed.

Give loudness its own Library Settings fieldset. Failed or unsupported recording rows provide
original-file downloads, links to the existing piece editor, and in-place replacement through the
existing learning-track upload controls. Shared originals are replaced per selected piece/track
mapping; unrelated attachments remain intact. Existing attachment authorization, reclamation,
analysis scheduling, and signed-link boundaries continue to apply.

## Consequences

Organization migration 123 adds one constrained scalar column and no indexes. Schema rollback is
additive: keep the column. Older playback code ignores the custom target and returns to −18 LUFS;
original files and stored measurements remain usable. Retain ADR 0059's physical-device evidence
requirements for changes to the audio graph, decoding path, or background playback behavior.
