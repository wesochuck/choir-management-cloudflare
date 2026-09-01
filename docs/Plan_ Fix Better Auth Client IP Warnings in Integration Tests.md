# Plan: Fix Better Auth Client IP Warnings in Integration Tests

## Goal

Eliminate Better Auth warnings like:

```text
Rate limiting could not determine a client IP and is falling back to a single shared per-path bucket.
```

during Workerd/Vitest integration tests while preserving the existing production Cloudflare
configuration.

The application already correctly configures Better Auth to read:

```ts
advanced: {
  ipAddress: {
    ipAddressHeaders: ["cf-connecting-ip"],
  },
}
```

Do **not** change this production configuration.

The issue is that synthetic integration-test requests do not currently include a `CF-Connecting-IP`
header.

---

## Primary Files

### Modify

```text
packages/testkit/src/workerd.ts
packages/testkit/src/index.ts
apps/worker/test/auth.integration.fixture.ts
```

### Likely update/add tests

```text
packages/testkit/src/workerd.test.ts
apps/worker/test/auth.integration.test.ts
apps/worker/test/auth.authorization.integration.test.ts
```

### Review only unless necessary

```text
apps/worker/src/auth/config.ts
apps/worker/test/ticketing.integration.fixture.ts
apps/worker/test/selfServiceRsvp.integration.test.ts
```

Also search the repository for other helpers that manually construct requests to `/api/auth/*`.

---

# 1. Fix the shared request helper and export standard test client IP

Define and export the synthetic address from:

```text
packages/testkit/src/workerd.ts
packages/testkit/src/index.ts
```

```ts
export const TEST_CLIENT_IP = "203.0.113.10";
```

Update `organizationRequest(...)` in `packages/testkit/src/workerd.ts` so synthetic requests contain
a valid test client IP when one has not already been provided:

```ts
const headers = new Headers(init?.headers);

headers.set("origin", `http://${host}`);

if (!headers.has("cf-connecting-ip")) {
  headers.set("cf-connecting-ip", TEST_CLIENT_IP);
}

if (cookie) {
  headers.set("cookie", cookie);
}
```

Do not blindly overwrite an explicitly supplied IP.

---

# 2. Update auth integration fixture helper

Update `authRequest(...)` in:

```text
apps/worker/test/auth.integration.fixture.ts
```

so that requests targeting the dedicated auth test suite also supply `cf-connecting-ip` (defaulting
to `TEST_CLIENT_IP` from `@choir/testkit` when not explicitly provided).

```ts
export function authRequest(path: string, init?: RequestInit, origin = BASE_AUTH_ORIGIN): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", origin);
  if (!headers.has("cf-connecting-ip")) {
    headers.set("cf-connecting-ip", TEST_CLIENT_IP);
  }
  if (init?.body) {
    headers.set("content-type", "application/json");
  }
  return new Request(`${origin}${path}`, { ...init, headers });
}
```

---

# 3. Preserve caller overrides

Tests must be able to simulate different client IPs.

For example:

```ts
organizationRequest("alpha.localhost", "/api/auth/...", undefined, {
  headers: {
    "cf-connecting-ip": "203.0.113.25",
  },
});
```

must retain:

```text
203.0.113.25
```

and must not replace it with the default test IP.

This is important for future rate-limit tests.

---

# 4. Keep IP simulation in the test layer

Do **not** add fake client IPs inside production Worker code.

Specifically, do not:

- synthesize an IP inside `createAuth()`;
- fall back to `127.0.0.1` in production;
- disable Better Auth rate limiting during tests;
- suppress Better Auth warning output;
- add `x-forwarded-for` just to silence the warning;
- weaken trusted proxy/IP handling.

The test harness should accurately simulate the header Cloudflare normally supplies.

---

# 5. Add unit coverage for `organizationRequest`

Update:

```text
packages/testkit/src/workerd.test.ts
```

with tests covering at least these cases.

## Default IP

Calling:

```ts
organizationRequest("alpha.localhost", "/api/test");
```

should result in:

```ts
request.headers.get("cf-connecting-ip") === "203.0.113.10";
```

## Explicit override

Calling the helper with:

```ts
headers: {
  "cf-connecting-ip": "203.0.113.50",
}
```

should retain:

```text
203.0.113.50
```

## Existing headers still survive

Verify that the helper continues to preserve:

- `content-type`;
- custom headers;
- cookies;
- `origin`.

Do not regress current request-building behavior.

---

# 6. Review other test request builders

Search the repository for direct constructions such as:

```text
new Request(
exports.default.fetch(
/api/auth/
send-verification-otp
sign-in/email-otp
```

Identify any integration-test requests that bypass `organizationRequest()` or `authRequest()`, such
as direct `new Request(".../api/auth/get-session")` calls in
`apps/worker/test/auth.integration.test.ts` and
`apps/worker/test/auth.authorization.integration.test.ts`.

Standardize those tests on `authRequest()` / `organizationRequest()` or ensure `cf-connecting-ip` is
passed.

---

# 7. Verify Better Auth integration behavior

Run the existing auth-related and affected integration suites:

```bash
npm test -- packages/testkit/src/workerd.test.ts
npm run test:integration -- apps/worker/test/auth.integration.test.ts
npm run test:integration -- apps/worker/test/ticketing.integration.test.ts
npm run test:integration -- apps/worker/test/selfServiceRsvp.integration.test.ts
npm run test:integration
npm run check:ci
```

The Better Auth warning:

```text
Rate limiting could not determine a client IP...
```

should no longer appear for requests created by the test harnesses.

---

# 8. Check header trust assumptions

Confirm that production still uses:

```ts
advanced: {
  ipAddress: {
    ipAddressHeaders: ["cf-connecting-ip"],
  },
}
```

This is the expected configuration for an application served directly through Cloudflare.

Do not add:

```ts
trustedProxies;
```

unless the runtime architecture actually contains another proxy layer in front of the Worker and
there is evidence it is required.

---

# Acceptance Criteria

The implementation is complete when all of the following are true:

- `organizationRequest()` and `authRequest()` supply `cf-connecting-ip` by default.
- The default uses `TEST_CLIENT_IP = "203.0.113.10"`.
- `TEST_CLIENT_IP` is exported from `@choir/testkit`.
- Explicit caller-supplied `cf-connecting-ip` values are preserved.
- Existing cookies, origin, content type, and custom headers continue to work.
- Unit tests cover default and overridden IP behavior in `workerd.test.ts`.
- Direct `/api/auth/*` requests in integration tests are routed through request helpers with client
  IP headers.
- Integration tests pass cleanly without Better Auth missing-client-IP warnings.
- Production Better Auth configuration is unchanged.
- Better Auth rate limiting remains enabled.
- No logging suppression or warning filtering is introduced.

# Scope Guardrail

Keep this as a **test-harness correctness fix**, not an authentication redesign.

The desired flow is:

```text
Real Cloudflare request
    -> Cloudflare supplies CF-Connecting-IP
    -> Better Auth reads it

Integration-test request
    -> testkit supplies synthetic CF-Connecting-IP
    -> Better Auth reads it
```

Both environments should therefore exercise the same Better Auth IP-resolution path.
