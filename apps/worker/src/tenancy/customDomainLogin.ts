import type { Env } from "../env";
import { resolveOrganization } from "./resolveOrganization";

/** Public domains hand off sign-in to the same Organization's authoritative auth host. */
export async function customDomainLoginRedirect(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(request.method) || !/^\/login\/?$/.test(url.pathname)) return null;
  const baseHostname = env.PRODUCT_BASE_DOMAIN.toLowerCase();
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === baseHostname || hostname.endsWith(`.${baseHostname}`)) return null;

  const organization = await resolveOrganization(url, env);
  if (!organization.ok) {
    return new Response("No active Organization is configured for this hostname.", { status: 404 });
  }
  const canonical = await env.CONTROL_DB.prepare(
    `SELECT hostname FROM organization_domains
     WHERE organization_id = ? AND kind = 'canonical' AND status = 'active'
     ORDER BY created_at, id LIMIT 1`,
  )
    .bind(organization.value.organizationId)
    .first<{ readonly hostname: string }>();
  if (!canonical?.hostname.endsWith(`.${baseHostname}`)) {
    return new Response("Organization sign-in is currently unavailable.", { status: 503 });
  }

  // Do not forward cookies, tokens, return URLs, or other query parameters across domains.
  const protocol = env.APP_ENV === "local" ? "http:" : "https:";
  const destination = new URL(`${protocol}//${canonical.hostname}/login`);
  if (destination.hostname !== canonical.hostname) {
    return new Response("Organization sign-in is currently unavailable.", { status: 503 });
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: destination.toString(),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
