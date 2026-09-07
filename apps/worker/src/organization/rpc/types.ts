import { z } from "zod";

// Keep the public RPC surface shallow enough for Cloudflare's generated stub types. The runtime
// guard below recursively verifies that the value is JSON-compatible before it crosses the boundary.
export type OrganizationRpcValue = string | number | boolean | null | object;

export type OrganizationRpcDomain =
  | "calendar"
  | "commerce"
  | "communication"
  | "content"
  | "engagement"
  | "file"
  | "job"
  | "lifecycle"
  | "operations"
  | "profile";

type OrganizationRpcMethodName = "GET" | "POST";

interface OrganizationRpcCallForDomain<TDomain extends OrganizationRpcDomain> {
  readonly body?: OrganizationRpcValue;
  readonly domain: TDomain;
  readonly method: "GET" | "POST";
  readonly operation: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
}

export type OrganizationRpcCall<TDomain extends OrganizationRpcDomain = OrganizationRpcDomain> =
  TDomain extends OrganizationRpcDomain ? OrganizationRpcCallForDomain<TDomain> : never;

interface OrganizationRpcSuccess<TValue extends OrganizationRpcValue = OrganizationRpcValue> {
  readonly headers: Readonly<Record<string, string>>;
  readonly ok: true;
  readonly status: number;
  readonly value: TValue;
}

interface OrganizationRpcFailure {
  readonly error: {
    readonly body: OrganizationRpcValue;
    readonly code: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly status: number;
  };
  readonly ok: false;
}

export type OrganizationRpcResult<TValue extends OrganizationRpcValue = OrganizationRpcValue> =
  OrganizationRpcSuccess<TValue> | OrganizationRpcFailure;

interface OrganizationRpcOperationDefinition {
  readonly input: z.ZodType<OrganizationRpcValue>;
  readonly output: z.ZodType<OrganizationRpcValue>;
}

/**
 * The operation map is intentionally DTO-shaped. Domains can grow their operation-specific
 * schemas without changing the transport or allowing Request/Response objects across the DO
 * boundary. The current staged adapter uses the shared serializable DTO schema while preserving
 * one named entry for every internal operation; a domain can narrow an entry without changing its
 * RPC method or public HTTP contract.
 */
export interface OrganizationRpcOperationMap {
  readonly calendar: Readonly<Record<string, OrganizationRpcOperationDefinition>>;
  readonly commerce: Readonly<Record<string, OrganizationRpcOperationDefinition>>;
  readonly communication: Readonly<Record<string, OrganizationRpcOperationDefinition>>;
  readonly content: Readonly<Record<string, OrganizationRpcOperationDefinition>>;
  readonly engagement: Readonly<Record<string, OrganizationRpcOperationDefinition>>;
  readonly file: Readonly<Record<string, OrganizationRpcOperationDefinition>>;
  readonly job: Readonly<Record<string, OrganizationRpcOperationDefinition>>;
  readonly lifecycle: Readonly<Record<string, OrganizationRpcOperationDefinition>>;
  readonly operations: Readonly<Record<string, OrganizationRpcOperationDefinition>>;
  readonly profile: Readonly<Record<string, OrganizationRpcOperationDefinition>>;
}

const organizationRpcValueSchema = z.custom<OrganizationRpcValue>(isOrganizationRpcValue);

interface OrganizationRpcOperationSpec {
  readonly method: OrganizationRpcMethodName;
  readonly path: string;
}

function getOperations(...paths: readonly string[]): OrganizationRpcOperationSpec[] {
  return paths.map((path) => ({ method: "GET", path }));
}

function postOperations(...paths: readonly string[]): OrganizationRpcOperationSpec[] {
  return paths.map((path) => ({ method: "POST", path }));
}

function operationMapFor(
  specifications: readonly OrganizationRpcOperationSpec[],
): Readonly<Record<string, OrganizationRpcOperationDefinition>> {
  return Object.fromEntries(
    specifications.map(({ method, path }) => [
      organizationRpcOperationForPath(method, path),
      { input: organizationRpcValueSchema, output: organizationRpcValueSchema },
    ]),
  );
}

export const organizationRpcOperationMap: OrganizationRpcOperationMap = {
  calendar: operationMapFor([
    ...getOperations(
      "/internal/calendar/venues",
      "/internal/calendar/events",
      "/internal/calendar/dashboard-summary",
      "/internal/calendar/attendance",
      "/internal/calendar/event-rsvp-history",
      "/internal/calendar/event-rsvp-export",
      "/internal/calendar/event-rsvp",
      "/internal/calendar/settings",
      "/internal/calendar/member-events",
      "/internal/calendar/profile-performance-history",
      "/internal/calendar/profile-folder-numbers",
      "/internal/seating/configuration",
      "/internal/seating/charts",
      "/internal/seating/singer",
    ),
    ...postOperations(
      "/internal/calendar/credential",
      "/internal/calendar/feed",
      "/internal/calendar/manage",
      "/internal/seating/manage",
    ),
  ]),
  commerce: operationMapFor([
    ...getOperations(
      "/internal/ticketing/orders",
      "/internal/ticketing/discount-codes",
      "/internal/ticketing/discount-availability",
      "/internal/ticketing/bundles",
      "/internal/ticketing/purchase",
      "/internal/ticketing/will-call",
      "/internal/ticketing/notification-job",
      "/internal/donations/list",
      "/internal/donations/patrons",
      "/internal/donations/donation",
      "/internal/payments/refund-target",
      "/internal/payments/notification-job",
      "/internal/seasons/list",
      "/internal/seasons/dues",
      "/internal/seasons/member-active",
      "/internal/donations/settings",
      "/internal/transaction-fee-settings",
      "/internal/stripe-connect",
      "/internal/payment-settings",
      "/internal/ticket-confirmation-settings",
      "/internal/reconciliation-report",
    ),
    ...postOperations(
      "/internal/ticketing/manage",
      "/internal/donations/settings",
      "/internal/transaction-fee-settings",
      "/internal/stripe-connect",
      "/internal/payment-settings",
      "/internal/payments/manage",
      "/internal/payments/cleanup",
      "/internal/payments/refund-request",
      "/internal/payments/notification-result",
      "/internal/ticket-confirmation-settings",
      "/internal/donations/manage",
      "/internal/seasons/manage",
    ),
  ]),
  communication: operationMapFor([
    ...getOperations(
      "/internal/communications",
      "/internal/communications/member-bulletins",
      "/internal/communications/deliveries",
      "/internal/communications/scheduled",
      "/internal/communications/templates",
      "/internal/communications/template",
      "/internal/communications/summary",
      "/internal/communications/job",
      "/internal/email/provider-routes",
      "/internal/email-settings",
    ),
    ...postOperations(
      "/internal/communications/audience",
      "/internal/communications/manage",
      "/internal/communications/unsubscribe",
      "/internal/communications/contact-unsubscribe",
      "/internal/email/provider-event",
      "/internal/email/provider-suppression-release",
      "/internal/email-settings/manage",
      "/internal/email-settings/verify",
    ),
  ]),
  content: operationMapFor([
    ...getOperations(
      "/internal/resources",
      "/internal/website/settings",
      "/internal/website/commerce-projection",
      "/internal/player/details",
      "/internal/player/playlist",
      "/internal/player/public-link",
      "/internal/music/pieces",
      "/internal/music/settings",
      "/internal/reports/music-folders/*",
      "/internal/branding",
    ),
    ...postOperations(
      "/internal/website/manage",
      "/internal/branding/manage",
      "/internal/player/public-link",
      "/internal/music/manage",
      "/internal/resources/manage",
      "/internal/reports/music-folders/query",
      "/internal/reports/music-folders/profile-detail",
      "/internal/reports/music-folders/folder-numbers",
      "/internal/reports/music-folders/return-status",
      "/internal/reports/music-folders/export",
    ),
  ]),
  engagement: operationMapFor([
    ...getOperations(
      "/internal/polls",
      "/internal/polls/archived",
      "/internal/polls/poll",
      "/internal/polls/profile-poll",
      "/internal/audition/notification-job",
      "/internal/audition/details",
      "/internal/audition/admin-details",
      "/internal/auditions/list",
      "/internal/audition/settings",
      "/internal/audition/public-settings",
    ),
    ...postOperations(
      "/internal/audition/update",
      "/internal/audition/public-update",
      "/internal/audition/create",
      "/internal/audition/delete",
      "/internal/audition/settings",
      "/internal/audition/rate-limit",
      "/internal/audition/notification-result",
      "/internal/auditions/list",
      "/internal/polls/manage",
    ),
  ]),
  file: operationMapFor([
    ...getOperations("/internal/files/*"),
    ...postOperations(
      "/internal/files/abort",
      "/internal/files/ready",
      "/internal/files/reserve",
      "/internal/files/reclaim",
      "/internal/files/reclaim-abort",
      "/internal/files/reclaimed",
    ),
  ]),
  job: operationMapFor([
    ...postOperations(
      "/internal/jobs/claim",
      "/internal/jobs/complete",
      "/internal/jobs/fail",
      "/internal/jobs/requeue",
      "/internal/jobs/terminal",
    ),
  ]),
  lifecycle: operationMapFor(postOperations("/internal/provision", "/internal/schema/prepare")),
  operations: operationMapFor([
    ...getOperations(
      "/internal/export/snapshot",
      "/internal/export/job",
      "/internal/scheduling/event-reminder-job",
      "/internal/scheduling/rsvp-follow-up-job",
      "/internal/setup/state",
      "/internal/setup/modules",
      "/internal/search",
    ),
    ...postOperations(
      "/internal/export/create",
      "/internal/export/complete",
      "/internal/export/fail",
      "/internal/setup/manage",
      "/internal/scheduling/attendance-report-prepare",
      "/internal/scheduling/event-reminder-result",
      "/internal/scheduler/run-now",
    ),
  ]),
  profile: operationMapFor([
    ...getOperations(
      "/internal/profiles",
      "/internal/profiles/directory",
      "/internal/profiles/member",
      "/internal/profiles/status-history",
      "/internal/profiles/*",
      "/internal/roster/configuration",
    ),
    ...postOperations(
      "/internal/profiles",
      "/internal/profiles/member-update",
      "/internal/profiles/photo",
      "/internal/profiles/import",
      "/internal/profiles/update",
      "/internal/profiles/delete",
      "/internal/roster/automation-preview",
      "/internal/roster/status-automation-fixture",
    ),
  ]),
};

const organizationRpcCallSchema = z
  .object({
    body: organizationRpcValueSchema.optional(),
    domain: z.enum([
      "calendar",
      "commerce",
      "communication",
      "content",
      "engagement",
      "file",
      "job",
      "lifecycle",
      "operations",
      "profile",
    ]),
    method: z.enum(["GET", "POST"]),
    operation: z.string().trim().min(1).max(256),
    path: z.string().regex(/^\/internal\/[a-zA-Z0-9/_:.~-]+$/),
    query: z.record(z.string().min(1).max(128), z.string().max(2_000)).optional(),
  })
  .strict();

export function parseOrganizationRpcCall(value: unknown): OrganizationRpcCall | null {
  const parsed = organizationRpcCallSchema.safeParse(value);
  if (!parsed.success) return null;
  const { body, domain, method, operation, path, query } = parsed.data;
  return {
    domain,
    method,
    operation,
    path,
    ...(body === undefined ? {} : { body }),
    ...(query === undefined ? {} : { query }),
  };
}

export function organizationRpcOperationForPath(method: "GET" | "POST", path: string): string {
  return `${method} ${path}`;
}

const organizationRpcDomainRules: readonly {
  readonly domain: OrganizationRpcDomain;
  readonly exact: readonly string[];
  readonly prefixes: readonly string[];
}[] = [
  { domain: "lifecycle", exact: ["/internal/provision", "/internal/schema/prepare"], prefixes: [] },
  { domain: "profile", exact: [], prefixes: ["/internal/profiles", "/internal/roster"] },
  { domain: "calendar", exact: [], prefixes: ["/internal/calendar", "/internal/seating"] },
  {
    domain: "communication",
    exact: [],
    prefixes: ["/internal/communications", "/internal/email", "/internal/email-settings"],
  },
  {
    domain: "content",
    exact: [],
    prefixes: [
      "/internal/music",
      "/internal/resources",
      "/internal/website",
      "/internal/player",
      "/internal/reports/music-folders",
      "/internal/branding",
    ],
  },
  {
    domain: "engagement",
    exact: [],
    prefixes: ["/internal/audition", "/internal/auditions", "/internal/polls"],
  },
  { domain: "file", exact: [], prefixes: ["/internal/files"] },
  { domain: "job", exact: [], prefixes: ["/internal/jobs"] },
  {
    domain: "commerce",
    exact: [],
    prefixes: [
      "/internal/ticket",
      "/internal/donation",
      "/internal/payments",
      "/internal/payment-settings",
      "/internal/transaction-fee-settings",
      "/internal/stripe-connect",
      "/internal/seasons",
      "/internal/reconciliation-report",
    ],
  },
];

export function organizationRpcDomainForPath(path: string): OrganizationRpcDomain {
  for (const rule of organizationRpcDomainRules) {
    if (rule.exact.includes(path) || rule.prefixes.some((prefix) => path.startsWith(prefix))) {
      return rule.domain;
    }
  }
  return "operations";
}

export function isOrganizationRpcRecord(
  value: OrganizationRpcValue | undefined,
): value is object & Readonly<Record<string, unknown>> {
  return (
    value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

export function isOrganizationRpcValue(value: unknown): value is OrganizationRpcValue {
  if (value === null) return true;
  if (typeof value === "boolean" || typeof value === "string") {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isOrganizationRpcValue);
  if (typeof value !== "object") return false;
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  return Object.values(value).every(isOrganizationRpcValue);
}
