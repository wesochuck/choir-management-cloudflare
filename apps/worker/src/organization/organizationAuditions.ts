import { verifySignedLinkScope } from "../security/signedLinks";
import type { Env } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "./rpc/client";
import { readOrganizationStore } from "./rpc/repository";
import { publicAuditionDetailsResponseSchema } from "@choir/contracts";

type AuditionDetailResponse = Record<string, unknown>;

export async function resolveAuditionDetails(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  token: string,
): Promise<AuditionDetailResponse | { readonly code: string; readonly status: number }> {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "audition",
  });
  if (!envelope?.resourceId || !envelope.subjectId) {
    return { code: "invalid_link", status: 404 };
  }
  const response = await readOrganizationStore(env, organizationId, "/internal/audition/details", {
    auditionId: envelope.resourceId,
  });
  if (!response.ok) {
    return { code: "audition_details_failed", status: response.status };
  }
  const parsed = publicAuditionDetailsResponseSchema.safeParse(
    await response.json().catch(() => null),
  );
  return parsed.success ? parsed.data : { code: "audition_details_failed", status: 503 };
}

export async function submitAuditionUpdate(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  token: string,
  availabilityNotes: string | undefined,
  voicePart: string | undefined,
): Promise<AuditionDetailResponse | { readonly code: string; readonly status: number }> {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "audition",
  });
  if (!envelope?.resourceId) {
    return { code: "invalid_link", status: 404 };
  }
  const url = new URL("https://organization.internal/internal/audition/public-update");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("auditionId", envelope.resourceId);
  if (availabilityNotes !== undefined) {
    url.searchParams.set("availabilityNotes", availabilityNotes);
  }
  if (voicePart !== undefined) {
    url.searchParams.set("voicePart", voicePart);
  }
  const response = await invokeOrganizationRpc(organizationStoreStub(env, organizationId), url, {
    method: "POST",
  });
  if (!response.ok) {
    return { code: "audition_update_failed", status: response.status };
  }
  return await response.json();
}
