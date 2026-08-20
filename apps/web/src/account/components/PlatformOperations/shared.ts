import type {
  PlatformContextResponse,
  PlatformEmailFeedbackDeadLetter,
  PlatformEmailProviderEvent,
  PlatformFleetSchemaStatusResponse,
  PlatformJobDeadLetterSummary,
  PlatformOrganizationContextResponse,
  PlatformOrganizationSummary,
  PublicDomainResponse,
} from "@choir/contracts";

export type PlatformScope = PlatformContextResponse["scope"];

export type DirectoryState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly nextCursor: string | null;
      readonly organizations: readonly PlatformOrganizationSummary[];
      readonly status: "ready";
    };

export type DeadLetterState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly deadLetters: readonly PlatformJobDeadLetterSummary[];
      readonly hasMore: boolean;
      readonly status: "ready";
    };

export type FleetSchemaState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly result: PlatformFleetSchemaStatusResponse; readonly status: "ready" };

export type ElevationState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly context: PlatformOrganizationContextResponse; readonly status: "ready" };

export type OrganizationDomainsState =
  | { readonly status: "idle" }
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly domains: readonly PublicDomainResponse[]; readonly status: "ready" };

export interface DeadLetterActionTarget {
  readonly action: "dismiss" | "retry";
  readonly deadLetter: PlatformJobDeadLetterSummary;
}

export type EmailFeedbackState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | {
      readonly deadLetters: readonly PlatformEmailFeedbackDeadLetter[];
      readonly events: readonly PlatformEmailProviderEvent[];
      readonly hasMoreDeadLetters: boolean;
      readonly hasMoreEvents: boolean;
      readonly status: "ready";
    };

export type EmailFeedbackActionTarget =
  | {
      readonly action: "acknowledge-event" | "retry-event";
      readonly event: PlatformEmailProviderEvent;
    }
  | {
      readonly action: "acknowledge-dead-letter" | "retry-dead-letter";
      readonly deadLetter: PlatformEmailFeedbackDeadLetter;
    };

export type PlatformDeadLetterTab = "email-provider" | "queue";
export type PlatformOperationsMode = "access" | "dead-letters" | "organizations";

export function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function schemaStatusMessage(
  state: FleetSchemaState,
  running: boolean,
  upToDate: boolean,
): string {
  if (state.status !== "ready") return "";
  if (upToDate) {
    return "No action is needed. The latest completed run matches the deployed schema, and new Organizations are prepared automatically.";
  }
  if (running) {
    return "Preparation is in progress. Wait for it to finish before starting another run.";
  }
  if (state.result.preparation?.status === "failed") {
    return "The last preparation did not finish. Review the failure before retrying.";
  }
  return "Run preparation only after a schema-changing deployment requires existing Organizations to be upgraded.";
}

export function schemaButtonLabel(
  state: FleetSchemaState,
  busy: boolean,
  running: boolean,
): string {
  if (busy) return "Starting preparation…";
  if (running) return "Preparation running";
  if (state.status === "ready" && state.result.preparation?.status === "failed") {
    return "Retry preparation";
  }
  return "Prepare schemas";
}

export function organizationHref(hostname: string): string {
  const protocol = hostname === "localhost" || hostname.endsWith(".localhost") ? "http:" : "https:";
  return `${protocol}//${hostname}/admin`;
}

export function organizationAccessHref(hostname: string): string {
  const protocol = hostname === "localhost" || hostname.endsWith(".localhost") ? "http:" : "https:";
  return `${protocol}//${hostname}/platform/access`;
}

function platformProductHref(pathname: string): string {
  const { hostname, port, protocol } = window.location;
  const isIpv4Address = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
  const baseHostname = hostname.endsWith(".localhost")
    ? "localhost"
    : hostname === "localhost" || isIpv4Address
      ? hostname
      : hostname.split(".").slice(1).join(".");
  const authority = baseHostname === "localhost" && port ? `${baseHostname}:${port}` : baseHostname;
  return `${protocol}//${authority}${pathname}`;
}

export function platformOrganizationsHref(): string {
  return platformProductHref("/platform/organizations");
}

export function platformDeadLettersHref(): string {
  return platformProductHref("/platform/dead-letters");
}

export function organizationStatus(organization: PlatformOrganizationSummary): string {
  if (organization.lifecycleState === "suspended") return "Suspended";
  if (organization.lifecycleState !== "active") return "Provisioning";
  if (organization.canonicalStatus !== "active") return "Hostname setup pending";
  return "Ready";
}

export function deadLetterActionLabel(
  status: PlatformJobDeadLetterSummary["actionStatus"],
): string {
  switch (status) {
    case "dismissed":
      return "Dismissed";
    case "retry_failed":
      return "Retry unavailable";
    case "retry_queued":
      return "Retry queued";
    case "retry_requested":
      return "Retry pending";
    case "open":
      return "Needs review";
  }
}

export function emailFeedbackActionLabel(action: EmailFeedbackActionTarget["action"]): string {
  switch (action) {
    case "retry-event":
    case "retry-dead-letter":
      return "Retry provider event";
    case "acknowledge-event":
    case "acknowledge-dead-letter":
      return "Acknowledge record";
  }
}

export function providerEventStatusLabel(event: PlatformEmailProviderEvent): string {
  return `${event.eventType} · ${event.state} · ${event.operatorStatus}`;
}
