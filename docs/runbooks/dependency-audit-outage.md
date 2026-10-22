# Dependency audit outages and degraded local checks

`npm audit` uses one nonzero exit code for both real vulnerabilities and request errors, and npm's
defaults allow minutes of waiting per request. The repository therefore runs audits through
`scripts/run-dependency-audit.mjs`: two total attempts with npm's own retries disabled, a 15-second
npm fetch timeout, an 18-second hard kill per attempt, ~1 second between attempts, and a 40-second
overall wall-clock bound. A network timeout is **never** evidence the tree is clean.

## The four audit outcomes

| Outcome              | Meaning                                                        | `npm run audit` / `npm run check:ci`                         | `npm run check:ci:dev`                                                                             |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `passed`             | Valid report, zero high/critical findings                      | Pass                                                         | Pass                                                                                               |
| `vulnerable`         | Valid report with high/critical findings                       | **Fail immediately**                                         | **Fail**                                                                                           |
| `unverified_network` | Recognized transient registry/network failure, no valid report | **Fail**, after running the remaining checks for diagnostics | **Continue**; exit 0 **only if every other check passes**, labeled **DEGRADED / AUDIT UNVERIFIED** |
| `failed_unknown`     | Malformed report, auth/TLS failure, or anything unexplained    | **Fail immediately**                                         | **Fail**                                                                                           |

Only transient failures are retried (timeouts, DNS `EAI_AGAIN`/`ENOTFOUND`, resets, socket hang-ups,
registry 429/502/503/504). Authentication, TLS/certificate, and authorization errors fail closed and
are never retried, never bypassed, and never reported as clean.

## What each command is for

- **Local development and coding agents:** keep iterating. If the audit step reports
  `unverified_network`, use `npm run check:ci:dev` to run the same browser-free checks and get a
  clear pass/fail signal for everything except the audit. A DEGRADED pass means "code checks are
  green, security is unverified."
- **Before pushing or promoting:** the strict gate is mandatory. `npm run check:release` always runs
  strict `npm run check:ci` (never the dev command) and blocks qualification while the audit is
  unverified. Staging reuses only matching non-degraded evidence. If an outage lasts, keep working
  with `check:ci:dev`, but push and release qualification wait for a verified audit.
- **Never** export ambient environment variables or config to skip the audit; the dev path is opt-in
  (`check:ci:dev`), never a default, and degraded results are never recorded as release
  qualification evidence.

## Diagnosing the three cases

1. **Real vulnerabilities (`vulnerable`).** The summary names the high/critical counts. Fix or
   justify every finding, then rerun the strict audit. Do not run `npm audit fix` blindly on this
   repository; review lockfile changes deliberately.
2. **Temporary outage (`unverified_network`).** The summary states the bounded attempt count and the
   classified reason (for example, registry network timeout after 2 bounded attempts). The remaining
   checks still run so unrelated work is not blocked. Rerun the strict gate when connectivity
   returns.
3. **Unexpected failure (`failed_unknown`).** Treat the tree as unverified. Inspect the wrapper's
   reason line (malformed report, auth/TLS problem, crashed runner), fix the underlying cause, and
   rerun. Do not reinterpret it as either clean or vulnerable.

## Notes for automation

- All audit unit coverage runs offline against injected subprocess outcomes; no test requires the
  live registry.
- `npm run audit` remains the strict per-invocation gate (exit 0 only on `passed`) so other callers
  and scripts cannot accidentally inherit a bypass.
- The wrapper never modifies `package.json`, `package-lock.json`, installed dependencies, or normal
  `npm ci`/`npm install` timeout behavior.
