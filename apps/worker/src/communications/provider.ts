import { z } from "zod";

import {
  attachProviderRouteResult,
  emailProviderSourceKindSchema,
  isEmailProviderSuppressed,
  markEmailProviderRouteUnknown,
  prepareEmailProviderRoute,
  type EmailProviderSourceKind,
} from "./emailFeedback";
import {
  escapeEmailHtml,
  renderEmailAction,
  renderEmailDocument,
  renderEmailHighlight,
} from "./emailPresentation";

const deliverySchema = z.object({
  channel: z.enum(["email", "sms"]),
  contentMarkdown: z.string().max(100_000),
  deliveryId: z.uuid(),
  destination: z.string().min(1).max(320),
  fromName: z.string().max(100).optional(),
  messageId: z.uuid(),
  organizationId: z.string().min(1).max(128).optional(),
  organizationLogoUrl: z.string().max(4_096).nullable().optional(),
  organizationName: z.string().max(120).optional(),
  physicalAddress: z.string().max(2_000).nullable().optional(),
  recipientName: z.string().min(1).max(200),
  replyTo: z.email().max(320).optional(),
  sendingDomain: z.string().min(1).max(253).optional(),
  sourceId: z.string().trim().min(1).max(256).optional(),
  sourceKind: emailProviderSourceKindSchema.optional(),
  subject: z.string().max(300),
  ticketServiceNotice: z.boolean().default(false),
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

function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const MARKDOWN_ESCAPE_PATTERN = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;
const ESCAPE_PLACEHOLDER_PREFIX = "\uE000";
const ESCAPE_PLACEHOLDER_SUFFIX = "\uE001";
const ESCAPE_RESTORE_PATTERN = /\uE000([0-9a-f]+)\uE001/g;

function protectMarkdownEscapes(value: string): string {
  return value.replace(
    MARKDOWN_ESCAPE_PATTERN,
    (_, char: string) =>
      `${ESCAPE_PLACEHOLDER_PREFIX}${char.charCodeAt(0).toString(16)}${ESCAPE_PLACEHOLDER_SUFFIX}`,
  );
}

function restoreMarkdownEscapedHtml(value: string): string {
  return value.replace(ESCAPE_RESTORE_PATTERN, (_, hex: string) =>
    escapeEmailHtml(String.fromCharCode(Number.parseInt(hex, 16))),
  );
}

function restoreMarkdownEscapedText(value: string): string {
  return value.replace(ESCAPE_RESTORE_PATTERN, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function renderMarkdownEmphasis(value: string): string {
  return escapeEmailHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#17181d;font-weight:700;">$1</strong>')
    .replace(/__([^_]+)__/g, '<strong style="color:#17181d;font-weight:700;">$1</strong>')
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

function renderMarkdownText(value: string): string {
  let cursor = 0;
  let rendered = "";
  for (const code of value.matchAll(/`([^`]+)`/g)) {
    rendered += renderMarkdownEmphasis(value.slice(cursor, code.index));
    rendered += `<code style="background-color:#f1f1f4;border-radius:3px;font-family:Consolas,Monaco,monospace;font-size:14px;overflow-wrap:anywhere;padding:2px 4px;word-break:break-all;">${escapeEmailHtml(code[1] ?? "")}</code>`;
    cursor = code.index + code[0].length;
  }
  return rendered + renderMarkdownEmphasis(value.slice(cursor));
}

function renderMarkdownInline(value: string): string {
  let cursor = 0;
  let rendered = "";
  for (const link of value.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const rawLink = link[0];
    const label = link[1] ?? "Open link";
    const url = link[2] ?? "";
    const effectiveUrl = restoreMarkdownEscapedText(url);
    rendered += renderMarkdownText(value.slice(cursor, link.index));
    rendered += isSafeHttpUrl(effectiveUrl)
      ? `<a href="${escapeEmailHtml(effectiveUrl)}" style="color:#1b4d3e;font-weight:700;text-decoration:underline;">${renderMarkdownText(label)}</a>`
      : renderMarkdownText(rawLink);
    cursor = link.index + rawLink.length;
  }
  return rendered + renderMarkdownText(value.slice(cursor));
}

function renderMarkdownBlock(trimmed: string): string {
  if (trimmed.startsWith("### ")) {
    return `<h3 style="color:#30343b;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;line-height:24px;margin:24px 0 10px;">${renderMarkdownInline(trimmed.slice(4))}</h3>`;
  }
  if (trimmed.startsWith("## ")) {
    return `<h2 style="color:#1b4d3e;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;line-height:29px;margin:28px 0 12px;">${renderMarkdownInline(trimmed.slice(3))}</h2>`;
  }
  if (trimmed.startsWith("# ")) {
    return `<h2 style="color:#1b4d3e;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;line-height:31px;margin:28px 0 12px;">${renderMarkdownInline(trimmed.slice(2))}</h2>`;
  }
  const standaloneLink = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(trimmed);
  if (standaloneLink) {
    const effectiveUrl = restoreMarkdownEscapedText(standaloneLink[2] ?? "");
    return renderEmailAction(
      restoreMarkdownEscapedText(standaloneLink[1] ?? "Open link"),
      effectiveUrl,
    );
  }
  return trimmed
    ? `<p style="color:#30343b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;margin:0 0 18px;">${renderMarkdownInline(trimmed)}</p>`
    : "";
}

function renderBlockquote(lines: readonly string[]): string {
  const innerHtml = lines
    .map((line, index) => {
      const bottomMargin = index === lines.length - 1 ? "0" : "8px";
      const inline = line ? renderMarkdownInline(line) : "&nbsp;";
      return `<p style="color:#17181d;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;margin:0 0 ${bottomMargin};">${inline}</p>`;
    })
    .join("");
  return renderEmailHighlight(innerHtml);
}

/** Render the deliberately small Markdown subset exposed by the message editor. */
export function renderCommunicationMarkdown(value: string): string {
  const lines = protectMarkdownEscapes(value).split("\n");
  const output: string[] = [];
  let inList = false;
  let inBlockquote = false;
  const blockquoteLines: string[] = [];

  const flushBlockquote = () => {
    if (inBlockquote) {
      output.push(renderBlockquote(blockquoteLines));
      blockquoteLines.length = 0;
      inBlockquote = false;
    }
  };

  const flushList = () => {
    if (inList) {
      output.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const listItem = trimmed.startsWith("- ") || trimmed.startsWith("* ");
    const blockquoteItem = trimmed.startsWith(">");

    if (listItem) {
      flushBlockquote();
      if (!inList) {
        output.push(
          '<ul style="color:#30343b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;margin:0 0 20px;padding-left:24px;">',
        );
        inList = true;
      }
      output.push(`<li style="margin:0 0 8px;">${renderMarkdownInline(trimmed.slice(2))}</li>`);
      continue;
    }

    flushList();

    if (blockquoteItem) {
      inBlockquote = true;
      const content = trimmed.startsWith("> ") ? trimmed.slice(2) : trimmed.slice(1);
      blockquoteLines.push(content);
      continue;
    }

    flushBlockquote();
    output.push(renderMarkdownBlock(trimmed));
  }

  flushList();
  flushBlockquote();
  return restoreMarkdownEscapedHtml(output.join(""));
}

export function renderCommunicationText(value: string): string {
  const normalized = protectMarkdownEscapes(value)
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/^[ \t]*>[ \t]?/gm, "");
  let cursor = 0;
  let rendered = "";
  for (const protectedSpan of normalized.matchAll(/`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g)) {
    rendered += stripMarkdownEmphasis(normalized.slice(cursor, protectedSpan.index));
    rendered +=
      protectedSpan[1] ??
      `${stripMarkdownEmphasis(protectedSpan[2] ?? "Open link")}: ${protectedSpan[3] ?? ""}`;
    cursor = protectedSpan.index + protectedSpan[0].length;
  }
  return restoreMarkdownEscapedText(
    (rendered + stripMarkdownEmphasis(normalized.slice(cursor))).trim(),
  );
}

function stripMarkdownEmphasis(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

function formatAddressFooter(physicalAddress?: string | null): { html: string; text: string } {
  const trimmed = physicalAddress?.trim();
  if (!trimmed) return { html: "", text: "" };
  return {
    html: `<p style="margin:0 0 8px;color:#687078;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">${escapeEmailHtml(trimmed).replace(/\n/g, "<br/>")}</p>`,
    text: `\n\n${trimmed}`,
  };
}

function formatUnsubscribeFooter(unsubscribeUrl: string | null): { html: string; text: string } {
  if (!unsubscribeUrl) return { html: "", text: "" };
  return {
    html: `<p style="margin:0 0 8px;color:#687078;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;"><a href="${escapeEmailHtml(unsubscribeUrl)}" style="color:#4d5962;text-decoration:underline;">Unsubscribe from Organization email</a></p>`,
    text: `\n\nUnsubscribe from Organization email: ${unsubscribeUrl}`,
  };
}

function formatTicketServiceFooter(enabled: boolean): { html: string; text: string } {
  if (!enabled) return { html: "", text: "" };
  const text =
    "You are receiving this message because you have a valid ticket for this performance.";
  return {
    html: `<p style="margin:0 0 8px;color:#687078;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">${escapeEmailHtml(text)}</p>`,
    text: `\n\n${text}`,
  };
}

function emailContents(
  subject: string,
  contentMarkdown: string,
  unsubscribeUrl: string | null,
  ticketServiceNotice: boolean,
  branding?: {
    readonly organizationLogoUrl?: string | null | undefined;
    readonly organizationName?: string | null | undefined;
    readonly physicalAddress?: string | null | undefined;
  },
) {
  const unsubscribe = formatUnsubscribeFooter(unsubscribeUrl);
  const serviceNotice = formatTicketServiceFooter(ticketServiceNotice);
  const address = formatAddressFooter(branding?.physicalAddress);
  const renderedBody = renderCommunicationMarkdown(contentMarkdown);
  const plainBody = renderCommunicationText(contentMarkdown);
  const preheader = plainBody.split("\n").find((line) => line.trim()) ?? subject;
  const trimmedOrgName = branding?.organizationName?.trim();
  const orgName = trimmedOrgName && trimmedOrgName.length > 0 ? trimmedOrgName : "Choir Management";
  return {
    htmlContent: renderEmailDocument({
      bodyHtml: renderedBody,
      footerHtml: `${unsubscribe.html}${serviceNotice.html}${address.html}<p style="margin:0;color:#687078;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">Sent using ${escapeEmailHtml(orgName)}.</p>`,
      heading: subject,
      organizationLogoUrl: branding?.organizationLogoUrl,
      organizationName: branding?.organizationName,
      preheader,
    }),
    textContent: `${plainBody}${unsubscribe.text}${serviceNotice.text}${address.text}`,
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
  const senderEmail = delivery.sendingDomain
    ? `announcements@${delivery.sendingDomain}`
    : (sender.fromEmail ?? required(config.PLATFORM_EMAIL_FROM, "email sender"));
  const senderName = delivery.fromName ?? sender.fromName ?? DEFAULT_PLATFORM_EMAIL_FROM_NAME;
  const replyTo = delivery.replyTo ? { email: delivery.replyTo, name: senderName } : undefined;
  const contents = emailContents(
    delivery.subject,
    delivery.contentMarkdown,
    delivery.unsubscribeUrl,
    delivery.ticketServiceNotice,
    {
      organizationLogoUrl: delivery.organizationLogoUrl,
      organizationName: delivery.organizationName,
      physicalAddress: delivery.physicalAddress,
    },
  );
  let result: Awaited<ReturnType<SendEmail["send"]>>;
  try {
    result = await config.PLATFORM_EMAIL.send({
      from: { email: senderEmail, name: senderName },
      html: contents.htmlContent,
      ...(replyTo ? { replyTo } : {}),
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
    await attachProviderRouteResult(controlDatabase, routeInput, result.messageId);
  }
  return {
    failureDetail: "",
    providerMessageId: result.messageId,
    status: "sent",
  };
}

export function deliverOrganizationCommunication(
  config: CommunicationProviderConfig,
  input: z.input<typeof deliverySchema>,
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
