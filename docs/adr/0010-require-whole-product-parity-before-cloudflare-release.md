# Require Whole-Product Parity Before the Cloudflare Release

The first production Cloudflare release must include every current module and all current
user-visible functionality and visual character in Parity Baseline commit
`6874d43a3c3698ae53218a44d17649bc454ca9ac`. Work may be implemented and verified in
dependency-ordered internal phases, but those milestones will not be offered as partial production
releases; new Organizations begin empty, and no PocketBase data migration is included. Code and
tests establish implemented behavior, non-PocketBase `AGENTS.md` rules remain normative, and
historical design or plan documents supply intent and acceptance detail without automatically adding
unimplemented scope.

**Why:** Organizations must be able to adopt the replacement without discovering that a current
workflow is unavailable, and the user explicitly values behavioral and visual continuity over
source-code preservation. This trades a longer time to first production use and a larger coordinated
acceptance effort for a single coherent product boundary, simpler launch communication, and freedom
to rebuild both backend and frontend cleanly.
