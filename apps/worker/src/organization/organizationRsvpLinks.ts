import { issueSignedLink, verifySignedLinkScope } from "../security/signedLinks";
import type { Env } from "../env";

const stub = (env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) =>
  env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));

const RSVP_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Issue the same scoped, no-login token used by the public RSVP page. */
export function issueRsvpToken(
  env: Pick<Env, "SIGNED_LINK_SECRET">,
  organizationId: string,
  eventId: string,
  profileId: string,
  issuedAt = Math.floor(Date.now() / 1000),
): Promise<string> {
  return issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt: issuedAt + RSVP_LINK_TTL_SECONDS,
    issuedAt,
    nonce: crypto.randomUUID(),
    organizationId,
    purpose: "rsvp",
    resourceId: eventId,
    subjectId: profileId,
    version: 1,
  });
}

interface EventRsvpDetails {
  readonly callTime: string;
  readonly details: string;
  readonly displayName: string;
  readonly durationMinutes: number | null;
  readonly id: string;
  readonly location: string;
  readonly profileId: string;
  readonly rsvp: string;
  readonly rsvpNote: string;
  readonly rsvpSelfServiceOpen: boolean;
  readonly startsAt: string;
  readonly title: string;
  readonly type: string;
  readonly venueAddress: string;
  readonly venueName: string;
}

async function readEventRsvp(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  eventId: string,
  profileId: string,
): Promise<EventRsvpDetails | null> {
  const url = new URL("https://organization.internal/internal/calendar/event-rsvp");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("eventId", eventId);
  url.searchParams.set("profileId", profileId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) return null;
  return response.json();
}

export async function generateRsvpTokens(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  eventId: string,
  profileIds: readonly string[],
): Promise<{ readonly tokens: Record<string, string> }> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const signedTokens = await Promise.all(
    profileIds.map(async (profileId) => {
      const token = await issueRsvpToken(env, organizationId, eventId, profileId, issuedAt);
      return [profileId, token] as const;
    }),
  );
  const tokens: Record<string, string> = {};
  for (const [profileId, token] of signedTokens) tokens[profileId] = token;
  return { tokens };
}

export async function resolveRsvpDetails(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  token: string,
): Promise<
  | {
      readonly canSubmit: boolean;
      readonly event: {
        readonly callTime: string;
        readonly details: string;
        readonly durationMinutes: number | null;
        readonly id: string;
        readonly location: string;
        readonly startsAt: string;
        readonly title: string;
        readonly type: string;
        readonly venueAddress: string;
        readonly venueName: string;
      };
      readonly profileId: string;
      readonly profileName: string;
      readonly rsvp: string;
      readonly rsvpNote: string;
      readonly rsvpSelfServiceOpen: boolean;
    }
  | { readonly code: string; readonly status: number }
> {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "rsvp",
  });
  if (!envelope?.resourceId || !envelope.subjectId) {
    return { code: "invalid_link", status: 404 };
  }
  const details = await readEventRsvp(env, organizationId, envelope.resourceId, envelope.subjectId);
  if (!details) {
    return { code: "profile_event_rsvp_not_found", status: 404 };
  }
  return {
    canSubmit: details.rsvpSelfServiceOpen,
    event: {
      callTime: details.callTime,
      details: details.details,
      durationMinutes: details.durationMinutes,
      id: details.id,
      location: details.location,
      startsAt: details.startsAt,
      title: details.title,
      type: details.type,
      venueAddress: details.venueAddress,
      venueName: details.venueName,
    },
    profileId: details.profileId,
    profileName: details.displayName,
    rsvp: details.rsvp,
    rsvpNote: details.rsvpNote,
    rsvpSelfServiceOpen: details.rsvpSelfServiceOpen,
  };
}

export async function submitQuickRsvp(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  token: string,
  rsvp: "Yes" | "No" | "Pending",
  rsvpNote: string,
): Promise<
  | { readonly status: number; readonly code?: never }
  | { readonly code: string; readonly status: number }
> {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "rsvp",
  });
  if (!envelope?.resourceId || !envelope.subjectId) {
    return { code: "invalid_link", status: 404 };
  }
  const objectStub = stub(env, organizationId);
  const response = await objectStub.fetch(
    "https://organization.internal/internal/calendar/manage",
    {
      body: JSON.stringify({
        action: "set_rsvp",
        actorUserId: `public:${envelope.subjectId}`,
        eventId: envelope.resourceId,
        organizationId,
        requestId: crypto.randomUUID(),
        rsvp: { profileId: envelope.subjectId, rsvp, rsvpNote },
        selfService: true,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    return { code: "rsvp_update_failed", status: response.status };
  }
  return { status: response.status };
}
