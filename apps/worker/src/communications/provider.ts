import { z } from "zod";

import {
  attachEmailProviderMessage,
  emailProviderSourceKindSchema,
  isEmailProviderSuppressed,
  markEmailProviderRouteUnknown,
  prepareEmailProviderRoute,
  type EmailProviderSourceKind,
} from "./emailFeedback";

const deliverySchema = z.object({
  channel: z.enum(["email", "sms"]),
  contentMarkdown: z.string().max(100_000),
  deliveryId: z.uuid(),
  destination: z.string().min(1).max(320),
  messageId: z.uuid(),
  organizationId: z.string().min(1).max(128).optional(),
  recipientName: z.string().min(1).max(200),
  sourceId: z.string().trim().min(1).max(256).optional(),
  sourceKind: emailProviderSourceKindSchema.optional(),
  subject: z.string().max(300),
  unsubscribeUrl: z.url().max(4_096).nullable(),
});

const brevoResponseSchema = z.object({ messageId: z.union([z.string(), z.number()]) });
type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface CommunicationProviderConfig {
  readonly BREVO_API_KEY?: string | undefined;
  readonly BREVO_SMS_ALLOWED_RECIPIENTS?: string | undefined;
  readonly BREVO_SMS_SENDER?: string | undefined;
  readonly CONTROL_DB?: D1Database | undefined;
  readonly EXTERNAL_EFFECTS_MODE: string;
  readonly PLATFORM_EMAIL?: SendEmail | undefined;
  readonly PLATFORM_EMAIL_ALLOWED_RECIPIENTS?: string | undefined;
  readonly PLATFORM_EMAIL_FROM?: string | undefined;
  readonly PLATFORM_EMAIL_MODE?: string | undefined;
}

export interface CommunicationProviderResult {
  readonly failureDetail: string;
  readonly providerMessageId: string | null;
  readonly status: "failed" | "sent" | "suppressed";
}

export interface ConfiguredEmailSender {
  readonly fromEmail: string | null;
  readonly fromName: string | null;
}

const DEFAULT_PLATFORM_EMAIL_FROM_NAME = "Choir Management";

export function configuredPlatformEmailSender(
  config: Pick<CommunicationProviderConfig, "PLATFORM_EMAIL_FROM">,
): ConfiguredEmailSender {
  const parsedEmail = z
    .string()
    .trim()
    .min(1)
    .pipe(z.email())
    .safeParse(config.PLATFORM_EMAIL_FROM);
  if (!parsedEmail.success) return { fromEmail: null, fromName: null };
  return { fromEmail: parsedEmail.data, fromName: DEFAULT_PLATFORM_EMAIL_FROM_NAME };
}

function required(value: string | undefined, name: string): string {
  const parsed = z.string().trim().min(1).safeParse(value);
  if (!parsed.success) throw new Error(`The ${name} sandbox setting is not configured.`);
  return parsed.data;
}

function allowedSmsRecipients(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((recipient) => recipient.trim())
      .filter(Boolean),
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function renderMarkdownInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label: string, url: string) =>
      isSafeHttpUrl(url) ? `<a href="${url}">${label}</a>` : match,
    );
}

/** Render the deliberately small Markdown subset exposed by the message editor. */
export function renderCommunicationMarkdown(value: string): string {
  const lines = value.split("\n");
  const output: string[] = [];
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const listItem = trimmed.startsWith("- ") || trimmed.startsWith("* ");
    if (listItem && !inList) {
      output.push("<ul>");
      inList = true;
    }
    if (!listItem && inList) {
      output.push("</ul>");
      inList = false;
    }
    if (listItem) {
      output.push(`<li>${renderMarkdownInline(trimmed.slice(2))}</li>`);
    } else if (trimmed.startsWith("### ")) {
      output.push(`<h5>${renderMarkdownInline(trimmed.slice(4))}</h5>`);
    } else if (trimmed.startsWith("## ")) {
      output.push(`<h4>${renderMarkdownInline(trimmed.slice(3))}</h4>`);
    } else if (trimmed.startsWith("# ")) {
      output.push(`<h3>${renderMarkdownInline(trimmed.slice(2))}</h3>`);
    } else if (trimmed) {
      output.push(`<p>${renderMarkdownInline(trimmed)}</p>`);
    }
  }
  if (inList) output.push("</ul>");
  return output.join("");
}

function emailContents(contentMarkdown: string, unsubscribeUrl: string | null) {
  const unsubscribeText = unsubscribeUrl
    ? `\n\nUnsubscribe from Organization email: ${unsubscribeUrl}`
    : "";
  const renderedBody = renderCommunicationMarkdown(contentMarkdown);
  const unsubscribeHtml = unsubscribeUrl
    ? `<p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from Organization email</a></p>`
    : "";
  return {
    htmlContent: `<div>${renderedBody}</div>${unsubscribeHtml}`,
    textContent: `${contentMarkdown}${unsubscribeText}`,
  };
}

async function brevoRequest(
  apiKey: string,
  path: string,
  body: unknown,
  fetcher: ProviderFetch,
): Promise<CommunicationProviderResult> {
  const response = await fetcher(`https://api.brevo.com/v3/${path}`, {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (response.status === 401 || response.status === 403)
    throw new Error("The Organization communications provider rejected its credentials.");
  if (response.status === 429 || response.status >= 500)
    throw new Error(
      `The Organization communications provider is retryable (${String(response.status)}).`,
    );
  if (!response.ok)
    return {
      failureDetail: `provider rejected request (${String(response.status)})`,
      providerMessageId: null,
      status: "failed",
    };
  const parsed = brevoResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success)
    throw new Error("The Organization communications provider response was invalid.");
  return {
    failureDetail: "",
    providerMessageId: String(parsed.data.messageId),
    status: "sent",
  };
}

// eslint-disable-next-line complexity -- coordinates sandbox gates, suppression, route reservation, and provider acceptance.
async function deliverOrganizationEmail(
  config: CommunicationProviderConfig,
  delivery: z.infer<typeof deliverySchema>,
): Promise<CommunicationProviderResult> {
  if (config.PLATFORM_EMAIL_MODE === "disabled") {
    return Promise.resolve({ failureDetail: "", providerMessageId: null, status: "suppressed" });
  }
  const recipient = delivery.destination.trim().toLowerCase();
  const allowedRecipients = new Set(
    (config.PLATFORM_EMAIL_ALLOWED_RECIPIENTS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  // The allowlist is a staging sandbox safety: when configured, only those
  // recipients send. An empty allowlist means unrestricted delivery.
  if (allowedRecipients.size > 0 && !allowedRecipients.has(recipient)) {
    return Promise.resolve({
      failureDetail: "sandbox recipient is not allowlisted",
      providerMessageId: null,
      status: "suppressed",
    });
  }
  if (!config.PLATFORM_EMAIL) {
    throw new Error("The Cloudflare email binding is not configured.");
  }
  if (config.CONTROL_DB && (await isEmailProviderSuppressed(config.CONTROL_DB, recipient))) {
    return {
      failureDetail: "recipient is suppressed by provider feedback",
      providerMessageId: null,
      status: "suppressed",
    };
  }
  const sourceKind: EmailProviderSourceKind | undefined = delivery.sourceKind;
  const controlDatabase = config.CONTROL_DB;
  const routeInput =
    controlDatabase && sourceKind && delivery.sourceId
      ? {
          destination: recipient,
          organizationId: delivery.organizationId ?? null,
          sourceId: delivery.sourceId,
          sourceKind,
        }
      : null;
  const route =
    routeInput && controlDatabase
      ? await prepareEmailProviderRoute(controlDatabase, routeInput)
      : null;
  if (route?.alreadyAccepted && route.providerMessageId) {
    return { failureDetail: "", providerMessageId: route.providerMessageId, status: "sent" };
  }
  const sender = configuredPlatformEmailSender(config);
  const senderEmail = sender.fromEmail ?? required(config.PLATFORM_EMAIL_FROM, "email sender");
  const contents = emailContents(delivery.contentMarkdown, delivery.unsubscribeUrl);
  let result: Awaited<ReturnType<SendEmail["send"]>>;
  try {
    result = await config.PLATFORM_EMAIL.send({
      from: { email: senderEmail, name: sender.fromName ?? DEFAULT_PLATFORM_EMAIL_FROM_NAME },
      html: contents.htmlContent,
      subject: delivery.subject,
      text: contents.textContent,
      to: recipient,
    });
  } catch (error: unknown) {
    if (routeInput && controlDatabase) {
      await markEmailProviderRouteUnknown(controlDatabase, routeInput).catch(() => undefined);
    }
    throw error;
  }
  if (routeInput && controlDatabase) {
    await attachEmailProviderMessage(controlDatabase, routeInput, result.messageId).catch(
      async (error: unknown) => {
        await markEmailProviderRouteUnknown(controlDatabase, routeInput).catch(() => undefined);
        console.error(
          JSON.stringify({
            errorType: error instanceof Error ? error.name : "UnknownError",
            event: "email_provider_route_attach_failed",
            sourceId: routeInput.sourceId,
            sourceKind: routeInput.sourceKind,
          }),
        );
      },
    );
  }
  return {
    failureDetail: "",
    providerMessageId: result.messageId,
    status: "sent",
  };
}

export function deliverOrganizationCommunication(
  config: CommunicationProviderConfig,
  input: z.infer<typeof deliverySchema>,
  fetcher: ProviderFetch = fetch,
): Promise<CommunicationProviderResult> {
  const delivery = deliverySchema.parse(input);
  if (config.EXTERNAL_EFFECTS_MODE === "fake") {
    return Promise.resolve({
      failureDetail: "",
      providerMessageId: `fake:${delivery.deliveryId}`,
      status: "sent",
    });
  }
  if (config.EXTERNAL_EFFECTS_MODE === "disabled") {
    return Promise.resolve({ failureDetail: "", providerMessageId: null, status: "suppressed" });
  }
  if (config.EXTERNAL_EFFECTS_MODE !== "sandbox")
    throw new Error("The Organization communications provider mode is invalid.");
  if (delivery.channel === "email") {
    return deliverOrganizationEmail(config, delivery);
  }
  if (!allowedSmsRecipients(config.BREVO_SMS_ALLOWED_RECIPIENTS).has(delivery.destination))
    return Promise.resolve({
      failureDetail: "sandbox recipient is not allowlisted",
      providerMessageId: null,
      status: "suppressed",
    });
  return brevoRequest(
    required(config.BREVO_API_KEY, "Brevo API key"),
    "transactionalSMS/send",
    {
      content: delivery.contentMarkdown,
      recipient: delivery.destination,
      sender: required(config.BREVO_SMS_SENDER, "Brevo SMS sender"),
      type: "transactional",
    },
    fetcher,
  );
}
