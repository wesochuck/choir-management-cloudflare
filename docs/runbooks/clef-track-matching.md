# AI Practice-Track Matching (Clef Flash)

Bulk practice-track import offers **AI Match** in the group review step. Local filename, ID3 tag,
and duration matching remain the default. The optional request sends filenames, inferred titles,
embedded ID3 metadata (title, artist, composer, album, track/sequence number), voice part labels,
durations, performance title, and candidate catalog metadata to Cloudflare Workers AI
(`@cf/cloudflare/clef-flash`). Audio bytes are never sent to the model. Browser audio elements read
duration and support local preview; ID3 extraction uses bounded slices. Audio uploads to the normal
private-file pipeline only after staff confirmation. Suggestions remain editable and require staff
review and the normal upload confirmation; AI never uploads files, creates pieces, or attaches
tracks autonomously.

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
- **Preflight validation**: Each serialized provider call must not exceed 20,000 UTF-8 bytes before
  any inference calls begin.
- **Question packing**: Each provider call is bounded to at most 64 total questions (covering piece
  selection and metadata-only per-file voice-part classification). If a batch exceeds the question
  budget, it is partitioned into sub-batches.
- **Bounded concurrency**: Worker sub-batch requests execute with bounded concurrency (concurrency
  limit 2) under a single shared 25-second deadline and no automatic retries.
- **Arrangement disambiguation**: When candidates are within a 0.15 score differential, the server
  retains runner-up probabilities in `topCandidates` for staff 1-click selection rather than forcing
  an uncertain single guess.
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

## Conservative decision and inspection policy

The server reloads candidate details and roster labels from the authorized Organization. Submitted
IDs restrict the scope; unknown or foreign IDs fail before inference. Each question shortlists at
most 20 title-related candidates (up to eight fallback candidates when no title tokens overlap),
retaining same-title arrangements together. The full picker remains available. If more than 20
arrangements are plausible, use manual search. Candidate criteria cap titles/credits/occupied keys;
all planned calls must fit before inference begins. File questions do not depend on simultaneous
piece answers or infer parts from empty slots.

Draft destination selection requires probability >= 0.70, a lead >= 0.20, a lower `none`
probability, and an independent deterministic title or metadata signal. Lower probabilities remain
alternatives. These are model estimates, not calibrated accuracy. The response retains
`noneProbability`. Part distributions reject unknown keys, invalid totals, and a choice that is not
a strongest option. Manual selections, skipped/reviewed groups, and file exclusions survive reruns.
Splitting aborts in-flight matching and protects the resulting destinations. Closing aborts local
duration/metadata inspection; inspection runs at most three files concurrently.

Ordinary ID3v2.3/v2.4 tags are traversed by frame headers so artwork payloads can be skipped, even
when text follows artwork larger than the read budget. Fallback tag reads remain capped at 512 KiB
plus header/tail. ID3 track numbers stay metadata hints and never override filename sequence or
select a set-list position on their own. No schema/session migration is required.

## Measuring staging batches

The authenticated match response includes optional aggregate `diagnostics`: elapsed `latencyMs`,
actual `providerCalls`, `questions`, summed serialized `inputBytes`, and `estimatedInputTokens`
(bytes / 4, rounded up). This token approximation is not provider billing evidence. At the
documented Clef Flash input price of $0.038 per million tokens, approximate cost is
`estimatedInputTokens * 0.038 / 1_000_000`; confirm current pricing before using the estimate. No
filename/tag/audio content is logged by these diagnostics.

For representative 20- and 50-file mixed-filename/ID3 batches, record HTTP success/failure count,
end-to-end browser wait, and these diagnostics. Include same-title arrangements, custom configured
parts, and unknown parts. Exercise manual fallback with AI unavailable. Do not infer perceived
browser time from Worker latency or report synthetic unit-test timing as staging performance.
