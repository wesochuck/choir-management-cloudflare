import type { D1Database, DurableObjectId } from "@cloudflare/workers-types";

export interface OrganizationStoreNamespace {
  readonly get: (id: DurableObjectId) => {
    readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  };
  readonly idFromName: (name: string) => DurableObjectId;
}

export interface TestWorkerFetcher {
  readonly fetch: (request: Request) => Promise<Response>;
}

/**
 * Shared Workerd integration-test harness. Every Organization integration
 * suite previously re-implemented these request, provision, and OTP helpers;
 * this module is the single source of truth so seeds and auth flows cannot
 * drift between suites.
 */

export interface OrganizationProvisionOptions {
  readonly id: string;
  readonly slug: string;
  readonly userId: string;
  readonly name?: string | undefined;
  readonly role?: "admin" | "member" | "owner" | undefined;
}

/**
 * Cloudflare supplies CF-Connecting-IP in production.
 * Integration requests provide a TEST-NET address (RFC 5737) so auth rate limiting
 * behaves like the deployed Worker.
 */
export const TEST_CLIENT_IP = "203.0.113.10";

export function organizationRequest(
  host: string,
  path: string,
  cookie?: string,
  init?: RequestInit,
): Request {
  const headers = new Headers(init?.headers);
  headers.set("origin", `http://${host}`);
  if (!headers.has("cf-connecting-ip")) {
    headers.set("cf-connecting-ip", TEST_CLIENT_IP);
  }
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://${host}${path}`, { ...init, headers });
}

export async function writeJson(
  fetcher: TestWorkerFetcher,
  host: string,
  path: string,
  cookie: string,
  body: unknown,
  method = "POST",
): Promise<Response> {
  return fetcher.fetch(
    organizationRequest(host, path, cookie, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method,
    }),
  );
}

export async function provisionOrganization(
  database: D1Database,
  stores: OrganizationStoreNamespace,
  options: OrganizationProvisionOptions,
): Promise<void> {
  const name = options.name ?? `Organization ${options.slug}`;
  const role = options.role ?? "admin";
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
           created_at, updated_at, provisioned_at)
         VALUES (?, ?, ?, 'active', ?, 14, ?, ?, ?)`,
      )
      .bind(options.id, name, options.slug, options.id, now, now, now),
    database
      .prepare(
        `INSERT INTO organization_domains
          (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
         VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
      )
      .bind(`domain-${options.slug}`, options.id, `${options.slug}.localhost`, now, now),
    database
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, createdAt)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(`member-${options.slug}`, options.id, options.userId, role, Date.now()),
  ]);
  const response = await stores
    .get(stores.idFromName(options.id))
    .fetch("https://organization.internal/internal/provision", {
      body: JSON.stringify({
        actorUserId: "bootstrap",
        canonicalHostname: `${options.slug}.localhost`,
        canonicalStatus: "active",
        name,
        organizationId: options.id,
        requestId: crypto.randomUUID(),
        slug: options.slug,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  if (response.status !== 200) {
    throw new Error(
      `Organization provision for ${options.slug} returned ${String(response.status)}.`,
    );
  }
}

export async function seedAuthUser(
  database: D1Database,
  userId: string,
  email: string,
  displayName = "Integration User",
): Promise<void> {
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES (?, ?, ?, 0, ?, ?, 0)`,
    )
    .bind(userId, displayName, email, now, now)
    .run();
}

export function readEmailOneTimeCode(
  emails: readonly { readonly kind: string; readonly recipient: string; readonly text: string }[],
  email: string,
): string | undefined {
  return emails
    .find((message) => message.kind === "email-one-time-code" && message.recipient === email)
    ?.text.match(/Use (\d{6}) to sign in/)?.[1];
}

export async function signInWithOtp(
  fetcher: TestWorkerFetcher,
  host: string,
  email: string,
  readOneTimeCode: (email: string) => string | undefined,
): Promise<string> {
  await fetcher.fetch(
    organizationRequest(host, "/api/auth/email-otp/send-verification-otp", undefined, {
      body: JSON.stringify({ email, type: "sign-in" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const otp = readOneTimeCode(email);
  if (!otp) throw new Error(`No one-time code was captured for ${email}.`);
  const response = await fetcher.fetch(
    organizationRequest(host, "/api/auth/sign-in/email-otp", undefined, {
      body: JSON.stringify({ email, otp }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  if (!cookie) throw new Error(`Sign-in for ${email} did not return a session cookie.`);
  return cookie;
}
