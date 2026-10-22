# AI Practice-Track Matching (Clef Flash)

Bulk practice-track import offers **AI Match** in the group review step. Local filename, ID3 tag,
and duration matching remain the default. The optional request sends filenames, inferred titles,
embedded ID3 metadata (title, artist, composer, album, track/sequence number), voice part labels,
durations, performance title, and candidate catalog metadata to Cloudflare Workers AI
(`@cf/cloudflare/clef-flash`). Audio bytes are never sent to the model or decoded in the browser;
metadata is extracted client-side via bounded ID3 header parsing. Suggestions remain editable and
require staff review and the normal upload confirmation; AI never uploads files, creates pieces, or
attaches tracks autonomously.

User-facing UI copy strictly uses generic "AI" phrasing (e.g., "AI Match", "AI suggested"), avoiding
vendor or model branding.

## Tenancy, Security, and Safeguards

- The matching route requires a registered Organization hostname and an authenticated Owner or
  Administrator.
- Candidate IDs never select tenant storage.
- Inference calls carry a stable hashed Organization tag (`x-organization-hash`) for tenancy
  attribution.
- Existing attachment authorization, empty-slot protections, and manual staff edits remain
  authoritative.
- Re-running AI never overwrites staff-edited destinations, manual voice parts, skipped files, split
  groups, or already-reviewed mappings.
- A returned `none` or ambiguous alternative never clears a previously matched or chosen destination
  piece.

## Question Packing, Limits, and Bounded Concurrency

- **Limits**: The endpoint supports up to 200 candidate pieces, 50 song groups, and 50 files per
  group.
- **Preflight validation**: Total serialized prompt size must not exceed 20,000 UTF-8 bytes before
  any inference calls begin.
- **Question packing**: Each provider call is bounded to at most 64 total questions (covering piece
  candidates, confidence, rationale, and file voice parts). If a batch exceeds the question budget,
  it is partitioned into sub-batches.
- **Bounded concurrency**: Worker sub-batch requests execute with bounded concurrency (concurrency
  limit 2) under a single shared 25-second deadline and no automatic retries.
- **Arrangement disambiguation**: When candidates are within a 0.15 score differential, the provider
  returns runner-up candidates in `topCandidates` for staff 1-click selection rather than forcing an
  uncertain single guess.
- **Part suggestions**: Confident voice parts (>= 0.7 probability) are preselected for unassigned
  tracks; uncertain parts remain unassigned (`partKey: null`, displaying "Part needed") rather than
  coercing to Tutti.

## Fallback and Environment Behavior

- The `AI` Workers binding is configured for permanent staging only.
- In local development, test environments, or when `EXTERNAL_EFFECTS_MODE=fake` or `disabled`, AI
  matching safely falls back to local deterministic matching and manual review without provider
  calls.
- If the AI service is unavailable, errors, or times out, all current manual and deterministic
  selections are preserved, an actionable notification is displayed, and full manual matching
  continues uninterrupted.

## Operational & Staging Verification

Deploy through the normal guarded staging release process in
[staging-deployment.md](staging-deployment.md). Live inference incurs Cloudflare Workers AI usage
costs. Measure and monitor actual request latency, batch sizes, and call counts rather than assuming
sub-second latency. No schema migration or new secret is required.

Regenerate Worker binding declarations after configuration changes:

```sh
npm run wrangler -- types --config=apps/worker/wrangler.jsonc --include-runtime=false apps/worker/worker-configuration.d.ts
```

API reference:
[Cloudflare Clef Flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/).
