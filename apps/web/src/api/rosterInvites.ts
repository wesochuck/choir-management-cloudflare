import {
  type CreateRosterInviteLinkRequest,
  createRosterInviteLinkResponseSchema,
  type CreateRosterInviteLinkResponse,
  revokeRosterInviteLinkResponseSchema,
  type RevokeRosterInviteLinkResponse,
  rosterInviteEnrollmentStatusResponseSchema,
  type RosterInviteEnrollmentStatusResponse,
  rosterInviteLinksResponseSchema,
  type RosterInviteLinksResponse,
  rosterInviteLinkShareResponseSchema,
  type RosterInviteLinkShareResponse,
  rosterInviteOptionsResponseSchema,
  type RosterInviteOptionsResponse,
  rosterInvitePreviewResponseSchema,
  type RosterInvitePreviewResponse,
  type RosterInviteRedeemRequest,
  rosterInviteRedeemResponseSchema,
  type RosterInviteRedeemResponse,
  rosterInviteStartResponseSchema,
  type RosterInviteStartResponse,
} from "@choir/contracts";
import { requestJson } from "./client";

export async function createRosterInviteLink(
  input: CreateRosterInviteLinkRequest,
): Promise<CreateRosterInviteLinkResponse> {
  return requestJson(
    "/api/organization/roster-invite-links",
    createRosterInviteLinkResponseSchema,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
  );
}

export async function listRosterInviteLinks(): Promise<RosterInviteLinksResponse> {
  return requestJson("/api/organization/roster-invite-links", rosterInviteLinksResponseSchema, {
    method: "GET",
  });
}

export async function shareRosterInviteLink(
  linkId: string,
): Promise<RosterInviteLinkShareResponse> {
  return requestJson(
    `/api/organization/roster-invite-links/${encodeURIComponent(linkId)}/share`,
    rosterInviteLinkShareResponseSchema,
    {
      method: "POST",
    },
  );
}

export async function revokeRosterInviteLink(
  linkId: string,
): Promise<RevokeRosterInviteLinkResponse> {
  return requestJson(
    `/api/organization/roster-invite-links/${encodeURIComponent(linkId)}/revoke`,
    revokeRosterInviteLinkResponseSchema,
    {
      method: "POST",
    },
  );
}

export async function previewRosterInvite(token: string): Promise<RosterInvitePreviewResponse> {
  return requestJson("/api/roster-invites/preview", rosterInvitePreviewResponseSchema, {
    body: JSON.stringify({ token }),
    method: "POST",
  });
}

export async function startRosterInvite(
  email: string,
  token: string,
): Promise<RosterInviteStartResponse> {
  return requestJson("/api/roster-invites/start", rosterInviteStartResponseSchema, {
    body: JSON.stringify({ email, token }),
    method: "POST",
  });
}

export async function getRosterInviteOptions(token: string): Promise<RosterInviteOptionsResponse> {
  return requestJson("/api/roster-invites/options", rosterInviteOptionsResponseSchema, {
    body: JSON.stringify({ token }),
    method: "POST",
  });
}

export async function redeemRosterInvite(
  input: RosterInviteRedeemRequest,
): Promise<RosterInviteRedeemResponse> {
  return requestJson("/api/roster-invites/redeem", rosterInviteRedeemResponseSchema, {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export async function getRosterInviteEnrollmentStatus(
  enrollmentId: string,
): Promise<RosterInviteEnrollmentStatusResponse> {
  return requestJson(
    `/api/roster-invites/enrollments/${encodeURIComponent(enrollmentId)}`,
    rosterInviteEnrollmentStatusResponseSchema,
    {
      method: "GET",
    },
  );
}
