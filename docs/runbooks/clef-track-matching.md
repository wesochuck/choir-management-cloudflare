# Clef Flash practice-track matching

Bulk practice-track import offers **Use Clef Flash** in the group review step. Local filename and
length matching remains the default. The optional request sends filenames, inferred titles, voice
part labels, durations, performance title, and candidate catalog metadata to Cloudflare Workers AI.
Audio bytes are never sent to the model. Suggestions remain editable and require the normal upload
confirmation; AI does not upload files or attach tracks.

The matching route requires a registered Organization hostname and an authenticated Owner or
Administrator. Candidate IDs never select tenant storage. Inference calls carry a stable hashed
Organization tag. Existing attachment authorization and occupied-slot protections remain
authoritative.

The request supports at most 200 candidate pieces, 50 song sets, and 50 files per set. AI evaluates
five sets per call, with at most ten sequential calls, one shared 25-second deadline, and no
automatic retries. Each serialized prompt is limited to 20,000 UTF-8 bytes before any calls begin.
Large imports can use a smaller performance set list or continue with manual matching. Invalid,
uncertain, and out-of-candidate answers cannot create attachments. Failed requests preserve the
current selections.

The `AI` Workers binding is configured for permanent staging only. Local environments and
`EXTERNAL_EFFECTS_MODE=fake` or `disabled` reject AI requests without provider calls. An absent
binding returns an actionable unavailable response. Test suites use provider fakes.

Deploy through the normal guarded staging release process in
[staging-deployment.md](staging-deployment.md). Live inference has usage costs and requires Workers
AI availability for the staging account. Local verification does not establish live account/model
availability. No schema migration or secret is required. Rolling back the Worker Version restores
the previous metadata matching behavior without data changes.

Regenerate Worker binding declarations after configuration changes:

```sh
npm run wrangler -- types --config=apps/worker/wrangler.jsonc --include-runtime=false apps/worker/worker-configuration.d.ts
```

API reference:
[Cloudflare Clef Flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/).
