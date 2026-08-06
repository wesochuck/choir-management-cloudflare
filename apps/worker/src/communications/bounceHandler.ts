import PostalMime from "postal-mime";
import { z } from "zod";

import type { Env } from "../env";

type ParsedEmail = Awaited<ReturnType<PostalMime["parse"]>>;

const bounceSenderPattern =
  /(mailer-daemon|mail-daemon|postmaster|bounces?@|noreply@|mail delivery)/i;
const bounceSubjectPattern =
  /(mail delivery failed|delivery status notification|undelivered mail returned|returned mail|mail system error|unable to deliver)/i;

const hardBouncePattern =
  /(user unknown|no such user|does not exist|invalid recipient|mailbox unavailable|address rejected|5\.1\.1|5\.1\.2|5\.4\.1|550)/i;
const softBouncePattern =
  /(4\.\d|temporarily|deferred|try again later|mailbox full|over quota|greylist)/i;

const recipientPattern =
  /(?:to|for|recipient):[^\n]*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
const quotedRecipientPattern = /<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>/;

function isBounceNotification(email: ParsedEmail): boolean {
  const sender = typeof email.from === "string" ? email.from : (email.from?.address ?? "");
  return bounceSenderPattern.test(sender) || bounceSubjectPattern.test(email.subject ?? "");
}

function extractOriginalRecipient(email: ParsedEmail, raw: string): string | null {
  // Headers are excluded from matching: the envelope "To:" line is the
  // catch-all bounce address, never the original recipient, and "From:" is
  // the daemon sender. The separator handles both LF and CRLF endings.
  const separator = raw.search(/\r?\n\r?\n/);
  if (separator === -1) return null;
  const body = `${raw.slice(separator + 2)}\n${email.text ?? ""}\n${email.html?.slice(0, 4_000) ?? ""}`;
  // Prefer the DSN recipient fields; fall back to the angle-bracket form.
  const match = recipientPattern.exec(body) ?? quotedRecipientPattern.exec(body);
  const value = match?.[1] ?? "";
  const parsed = z.email().safeParse(value);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

function classifyBounce(email: ParsedEmail, raw: string): "hard" | "soft" {
  const body = `${raw}\n${email.text ?? ""}\n${email.subject ?? ""}`;
  if (softBouncePattern.test(body) && !hardBouncePattern.test(body)) return "soft";
  return "hard";
}

function bounceReason(email: ParsedEmail, raw: string): string {
  const body = `${raw}\n${email.text ?? ""}\n${email.subject ?? ""}`;
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /(error|status|diagnostic|reason|unknown|550|5\.\d|4\.\d)/i.test(line))
    .slice(0, 3);
  return lines.join(" ") || (email.subject ?? "provider bounce notification");
}

export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Pick<Env, "CONTROL_DB" | "ORGANIZATION_STORE">,
): Promise<void> {
  try {
    await processBounceNotification(message, env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "bounce_processing_failed",
        error: error instanceof Error ? error.message : String(error),
        to: message.to,
      }),
    );
  }
}

async function processBounceNotification(
  message: ForwardableEmailMessage,
  env: Pick<Env, "CONTROL_DB" | "ORGANIZATION_STORE">,
): Promise<void> {
  const raw = await new Response(message.raw).text();
  const email = await new PostalMime().parse(raw);
  if (!isBounceNotification(email)) {
    console.info(JSON.stringify({ event: "inbound_email_non_bounce_dropped", to: message.to }));
    return;
  }
  const recipient = extractOriginalRecipient(email, raw);
  if (!recipient) {
    console.info(
      JSON.stringify({ event: "bounce_recipient_unreadable", from: message.from, to: message.to }),
    );
    return;
  }
  const hard = classifyBounce(email, raw) === "hard";
  const reason = bounceReason(email, raw).slice(0, 500);
  const rows = env.CONTROL_DB.prepare(
    `SELECT m.organizationId AS organizationId, m.profileId AS profileId
     FROM member m JOIN user u ON u.id = m.userId
     WHERE u.email = ? AND m.profileId IS NOT NULL`,
  )
    .bind(recipient)
    .all<{ readonly organizationId: string; readonly profileId: string }>();
  const matches = (await rows).results;
  if (matches.length === 0) {
    console.info(JSON.stringify({ event: "bounce_recipient_unmatched", recipient, hard }));
    return;
  }
  const requestId = crypto.randomUUID();
  await Promise.all(
    matches.map(async ({ organizationId, profileId }) => {
      const response = await env.ORGANIZATION_STORE.get(
        env.ORGANIZATION_STORE.idFromName(organizationId),
      ).fetch("https://organization.internal/internal/profiles/bounce", {
        body: JSON.stringify({ hard, organizationId, profileId, reason, requestId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        console.error(
          JSON.stringify({
            event: "bounce_record_rejected",
            organizationId,
            profileId,
            status: response.status,
          }),
        );
      }
    }),
  );
  console.info(
    JSON.stringify({
      event: hard ? "bounce_recorded_hard" : "bounce_recorded_soft",
      matches: matches.length,
      recipient,
    }),
  );
}
