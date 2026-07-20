# Build the Cloudflare Application in a Separate Repository

The Cloudflare replacement will be built in a new `choir-management-cloudflare` repository with
root-level Cloudflare configuration, dependencies, CI, tests, and tailored agent instructions.
During the rebuild, both repositories may be opened as sibling workspace roots through a
development-only Parity Bridge pinned to legacy commit `6874d43a3c3698ae53218a44d17649bc454ca9ac`;
the new application will copy approved parity artifacts but never import or require legacy source at
runtime or during production deployment.

**Why:** A separate repository prevents PocketBase-specific rules, dependencies, generated
artifacts, and deployment mechanics from confusing AI tools or coupling the replacement to its
reference implementation. This trades convenient same-repository imports and a single history for
cleaner Cloudflare builds, smaller agent context, independent CI, and an explicit evidence-transfer
process that still allows local cross-repository inspection.
