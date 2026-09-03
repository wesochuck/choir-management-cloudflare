import type { publicAuditionInquiryRequestSchema } from "@choir/contracts";
import { organizationAuditionSettingsSchema, type ProblemDetails } from "@choir/contracts";
import { areAuditionDatesPassed } from "@choir/domain";
import type { z } from "zod";

import {
  assertEmailProviderRecipientAvailable,
  EmailRecipientSuppressedError,
} from "../../communications/emailFeedback";
import type { Env } from "../../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";

function publicAuditionInquiryProblem(
  settings: z.infer<typeof organizationAuditionSettingsSchema>,
  requestedSlots: readonly string[],
  requestIdValue: string,
): { readonly problem: ProblemDetails; readonly status: 400 | 409 } | null {
  if (!settings.enabled || areAuditionDatesPassed(settings)) {
    return {
      problem: {
        code: "auditions_closed",
        message: "Audition requests are not currently being accepted.",
        requestId: requestIdValue,
      },
      status: 409,
    };
  }

  const allowedSlots = new Set(settings.slots.map(({ startsAt }) => startsAt));
  if (requestedSlots.some((slot) => !allowedSlots.has(slot))) {
    return {
      problem: {
        code: "invalid_audition_slot",
        message: "Choose only from the available audition time slots.",
        requestId: requestIdValue,
      },
      status: 400,
    };
  }
  return null;
}

function createdAuditionId(value: unknown): string {
  if (typeof value === "object" && value !== null && "id" in value) return String(value.id);
  return "";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// eslint-disable-next-line complexity -- this route sequences suppression, settings, rate-limit, and creation safeguards.
export async function submitPublicAuditionInquiry(
  env: Env,
  organizationId: string,
  body: z.infer<typeof publicAuditionInquiryRequestSchema>,
  requestIdValue: string,
  clientIp: string,
): Promise<Response> {
  try {
    await assertEmailProviderRecipientAvailable(env.CONTROL_DB, body.email);
    const stub = organizationStoreStub(env, organizationId);
    const settingsUrl = new URL("https://organization.internal/internal/audition/settings");
    settingsUrl.searchParams.set("organizationId", organizationId);
    const settingsResponse = await invokeOrganizationRpc(stub, settingsUrl);
    const settings = organizationAuditionSettingsSchema.safeParse(await settingsResponse.json());
    if (!settingsResponse.ok || !settings.success) throw new Error("settings_unavailable");
    const settingsProblem = publicAuditionInquiryProblem(
      settings.data,
      body.requestedSlots,
      requestIdValue,
    );
    if (settingsProblem)
      return Response.json(settingsProblem.problem, { status: settingsProblem.status });
    const [clientKey, emailKey] = await Promise.all([
      sha256Hex(clientIp.trim() || "unknown"),
      sha256Hex(body.email.trim().toLowerCase()),
    ]);
    const rateLimitResponse = await invokeOrganizationRpc(
      stub,
      "https://organization.internal/internal/audition/rate-limit",
      {
        body: JSON.stringify({ clientKey, emailKey, organizationId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    if (!rateLimitResponse.ok) {
      if (rateLimitResponse.status === 429) {
        const retryAfter = rateLimitResponse.headers.get("retry-after");
        return new Response(
          JSON.stringify({
            code: "public_rate_limit_exceeded",
            message: "Too many audition inquiries. Please try again later.",
            requestId: requestIdValue,
          } satisfies ProblemDetails),
          {
            headers: {
              "content-type": "application/json",
              ...(retryAfter ? { "retry-after": retryAfter } : {}),
            },
            status: 429,
          },
        );
      }
      throw new Error("rate_limit_unavailable");
    }
    const response = await invokeOrganizationRpc(
      stub,
      "https://organization.internal/internal/audition/create",
      {
        body: JSON.stringify({
          availabilityNotes: body.availabilityNotes ?? "",
          email: body.email,
          experience: body.experience ?? "",
          name: body.name,
          performanceId: settings.data.defaultPerformanceId,
          phone: body.phone ?? "",
          requestedSlots: body.requestedSlots,
          voicePart: body.voicePart ?? "",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    if (!response.ok) {
      return Response.json(
        {
          code: response.status === 400 ? "validation_failed" : "audition_create_failed",
          message:
            response.status === 400
              ? "Choose only configured audition times."
              : "Your inquiry could not be submitted. Please try again later.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        { status: response.status === 400 ? 400 : 503 },
      );
    }
    const created: unknown = await response.json();
    const createdId = createdAuditionId(created);
    return Response.json(
      { id: createdId, message: "Your audition inquiry has been received." },
      { status: 201 },
    );
  } catch (error: unknown) {
    if (error instanceof EmailRecipientSuppressedError) {
      return Response.json(
        {
          code: error.code,
          message: error.message,
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        { status: error.status },
      );
    }
    return Response.json(
      {
        code: "service_unavailable",
        message: "Your inquiry could not be submitted. Please try again later.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      { status: 503 },
    );
  }
}
