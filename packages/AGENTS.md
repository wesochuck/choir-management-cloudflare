# Shared Package Agent Instructions

These instructions inherit the repository root `AGENTS.md` and apply under `packages/`.

- Keep business rules in `packages/domain`.
- Keep transport and validation contracts in `packages/contracts`.
- Keep repository-owned reusable React primitives in `packages/ui`; application-specific workflows
  remain in `apps/web`.
- Keep deterministic cross-package fixtures and provider fakes in `packages/testkit`.
- Infrastructure details must not leak into domain or UI primitives.
- Define reusable unrefined Zod object schemas before applying `superRefine` or other checks. Do not
  call composition methods such as `.omit()` on refined schemas unless the supported runtime has
  explicit coverage.
- Contract changes require browser-client and server parsing tests, including valid input,
  validation failure, authorization failure where applicable, and backward compatibility.
- Reusable `@choir/ui` `Dialog` owns dirty change tracking and confirmation prompts; all close paths
  (escape, backdrop click, header close icon, and `DialogClose` buttons) must route through
  `requestClose()` to prevent accidental data loss.
- Preserve public package exports unless the task explicitly includes a coordinated API change and
  all consumers are updated atomically.
