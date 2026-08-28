# Music CSV import auto-creates genre tags, normalized and partial-success

The music CSV import was extended to write genre tags: it parses the `Genres` column, trims and
case-insensitively deduplicates labels preserving the registry's canonical casing, auto-creates any
missing labels in `organization_metadata.music_genres_json` as part of the same transaction, and
returns a partial-success result `{ imported, skipped, errors[] }` with a downloadable error CSV so
bad rows can be fixed and re-imported. We chose this over the previous fail-entire-file behavior
because bulk import is a taxonomy-building workflow — failing the whole file on one bad row or
requiring pre-registration of every genre blocks hygiene (finding and tagging uncategorized pieces)
and the 100-label caps make atomic failure too punitive.

## Considered Options

- **Pre-register or reject:** Require every CSV genre to already exist in the registry; reject rows
  with unknown genres. Rejected — defeats bulk taxonomy creation.
- **Case-sensitive strict:** Treat `"Sacred"` and `"sacred"` as distinct genres. Rejected — creates
  duplicate taxonomy entries.
- **Fail entire file on any bad row:** Rejected — too punitive for large imports; partial success
  with per-row reporting preserves the good rows.
- **Truncate genres on overflow:** Import a piece with a subset of its genres when the registry is
  full. Rejected — silently mutates the piece; whole-row skip is more auditable.

## Consequences

- `importPieces` now also updates `organization_metadata.music_genres_json` in the same
  `transactionSync`.
- The import response shape changes from `{ imported }` to `{ imported, skipped, errors }`
  (contracts + web UI updated).
- Registry growth is capped at `100` labels; overflow causes the whole row to be skipped.
