import { z } from "zod";

const deliverySchema = z.object({
  channel: z.enum(["email", "sms"]),
  contentMarkdown: z.string().max(100_000),
  deliveryId: z.uuid(),
  destination: z.string().min(1).max(320),
  messageId: z.uuid(),
  recipientName: z.string().min(1).max(200),
  subject: z.string().max(300),
  unsubscribeUrl: z.url().max(4_096).nullable(),
});

const brevoResponseSchema = z.object({ messageId: z.union([z.string(), z.number()]) });
type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface CommunicationProviderConfig {
  readonly BREVO_API_KEY?: string;
  readonly BREVO_EMAIL_FROM?: string;
  readonly BREVO_EMAIL_FROM_NAME?: string;
  readonly BREVO_SMS_ALLOWED_RECIPIENTS?: string;
  readonly BREVO_SMS_SENDER?: string;
  readonly EXTERNAL_EFFECTS_MODE: string;
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

const DEFAULT_BREVO_EMAIL_FROM_NAME = "MusicSite Organization";

export function configuredBrevoEmailSender(
  config: Pick<CommunicationProviderConfig, "BREVO_EMAIL_FROM" | "BREVO_EMAIL_FROM_NAME">,
): ConfiguredEmailSender {
  const parsedEmail = z.string().trim().min(1).pipe(z.email()).safeParse(config.BREVO_EMAIL_FROM);
  if (!parsedEmail.success) return { fromEmail: null, fromName: null };
  const parsedName = z.string().trim().min(1).max(200).safeParse(config.BREVO_EMAIL_FROM_NAME);
  return {
    fromEmail: parsedEmail.data,
    fromName: parsedName.success ? parsedName.data : DEFAULT_BREVO_EMAIL_FROM_NAME,
  };
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

function renderMarkdownInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
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
  const apiKey = required(config.BREVO_API_KEY, "Brevo API key");
  if (delivery.channel === "email") {
    const sender = configuredBrevoEmailSender(config);
    const senderEmail = sender.fromEmail ?? required(config.BREVO_EMAIL_FROM, "Brevo email sender");
    const senderName = sender.fromName ?? DEFAULT_BREVO_EMAIL_FROM_NAME;
    return brevoRequest(
      apiKey,
      "smtp/email",
      {
        ...emailContents(delivery.contentMarkdown, delivery.unsubscribeUrl),
        headers: { "X-Sib-Sandbox": "drop" },
        sender: { email: senderEmail, name: senderName },
        subject: delivery.subject,
        to: [{ email: delivery.destination, name: delivery.recipientName }],
      },
      fetcher,
    );
  }
  if (!allowedSmsRecipients(config.BREVO_SMS_ALLOWED_RECIPIENTS).has(delivery.destination))
    return Promise.resolve({
      failureDetail: "sandbox recipient is not allowlisted",
      providerMessageId: null,
      status: "suppressed",
    });
  return brevoRequest(
    apiKey,
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
