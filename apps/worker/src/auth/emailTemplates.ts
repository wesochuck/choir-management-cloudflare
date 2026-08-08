export type OneTimeCodeEmailPurpose = "sign-in" | "verify-email";

export interface OneTimeCodeEmailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface EmailChangeEmailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildEmailChangeHtml(
  heading: string,
  introduction: string,
  detail: string,
  footer: string,
): string {
  const safeHeading = escapeHtml(heading);
  const safeIntroduction = escapeHtml(introduction);
  const safeDetail = escapeHtml(detail);
  const safeFooter = escapeHtml(footer);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeHeading}</title>
  </head>
  <body style="margin:0;background:#f5f4fb;color:#17181d;font-family:Arial,Helvetica,sans-serif;">
    <div style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e3e2e9;border-radius:20px;">
        <tr>
          <td style="padding:40px 40px 36px;text-align:center;">
            <div style="display:inline-block;width:44px;height:44px;line-height:44px;border-radius:12px;background:#1b4d3e;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:.04em;">CM</div>
            <div style="margin-top:10px;color:#1b4d3e;font-size:15px;font-weight:700;letter-spacing:.02em;">Choir Management</div>
            <h1 style="margin:44px 0 20px;font-size:32px;line-height:1.2;font-weight:700;">${safeHeading}</h1>
            <p style="max-width:520px;margin:0 auto;color:#30323a;font-size:17px;line-height:1.55;">${safeIntroduction}</p>
            <div style="margin:34px 0 28px;padding:20px;background:#f0f2f1;border-radius:14px;color:#17181d;font-size:17px;line-height:1.55;">${safeDetail}</div>
            <p style="max-width:520px;margin:0 auto;color:#6d6f77;font-size:15px;line-height:1.55;">${safeFooter}</p>
            <div style="height:1px;margin:40px auto 24px;background:#e3e2e9;"></div>
            <p style="margin:0;color:#777982;font-size:13px;line-height:1.5;">This is an automated message from Choir Management.</p>
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`;
}

export function buildEmailChangeConfirmationEmail(
  confirmationUrl: string,
  newEmail: string,
): EmailChangeEmailContent {
  const subject = "Confirm your new Choir Management email";
  const introduction = "Someone requested to use this address for a Choir Management account.";
  const detail = `Confirm ${newEmail}: ${confirmationUrl}`;
  const footer =
    "This link expires in 30 minutes. If you did not request this change, you can ignore this message.";
  return {
    html: buildEmailChangeHtml(subject, introduction, detail, footer),
    subject,
    text: `${detail}\n\n${introduction}\n\n${footer}`,
  };
}

export function buildEmailChangeNoticeEmail(
  newEmail: string,
  stage: "confirmed" | "requested",
): EmailChangeEmailContent {
  const confirmed = stage === "confirmed";
  const subject = confirmed
    ? "Your Choir Management email address changed"
    : "A Choir Management email change was requested";
  const introduction = confirmed
    ? "Your Choir Management sign-in email address is now confirmed."
    : "A request was made to change the sign-in email for your Choir Management account.";
  const detail = confirmed
    ? `The new sign-in email is ${newEmail}.`
    : `The requested new sign-in email is ${newEmail}.`;
  const footer = confirmed
    ? "If you did not make this change, sign in and update your password, then contact your Organization administrator."
    : "If you did not request this change, sign in and update your password, then contact your Organization administrator. The change will not complete unless the new address is confirmed.";
  return {
    html: buildEmailChangeHtml(subject, introduction, detail, footer),
    subject,
    text: `${detail}\n\n${introduction}\n\n${footer}`,
  };
}

export function buildOneTimeCodeEmail(
  otp: string,
  purpose: OneTimeCodeEmailPurpose,
): OneTimeCodeEmailContent {
  const signIn = purpose === "sign-in";
  const subject = signIn
    ? "Your Choir Management sign-in code"
    : "Verify your Choir Management email";
  const heading = signIn ? "Your sign-in code" : "Verify your email address";
  const introduction = signIn
    ? "We received a request to sign in to Choir Management. Enter the code below in the browser window where you started signing in."
    : "Use the code below to verify your email address for Choir Management.";
  const text = `${signIn ? `Use ${otp} to sign in.` : `Use ${otp} to verify your email.`}\n\n${introduction}\n\nThis code expires in 10 minutes. If you did not request it, you can safely ignore this email.`;
  const safeOtp = escapeHtml(otp);
  const safeHeading = escapeHtml(heading);
  const safeIntroduction = escapeHtml(introduction);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeHeading}</title>
  </head>
  <body style="margin:0;background:#f5f4fb;color:#17181d;font-family:Arial,Helvetica,sans-serif;">
    <div style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e3e2e9;border-radius:20px;">
        <tr>
          <td style="padding:40px 40px 36px;text-align:center;">
            <div style="display:inline-block;width:44px;height:44px;line-height:44px;border-radius:12px;background:#1b4d3e;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:.04em;">CM</div>
            <div style="margin-top:10px;color:#1b4d3e;font-size:15px;font-weight:700;letter-spacing:.02em;">Choir Management</div>
            <h1 style="margin:44px 0 20px;font-size:32px;line-height:1.2;font-weight:700;">${safeHeading}</h1>
            <p style="max-width:520px;margin:0 auto;color:#30323a;font-size:17px;line-height:1.55;">${safeIntroduction}</p>
            <div style="margin:34px 0 28px;padding:28px 20px;background:#f0f2f1;border-radius:14px;color:#17181d;font-size:42px;line-height:1;font-weight:700;letter-spacing:.18em;">${safeOtp}</div>
            <p style="max-width:520px;margin:0 auto;color:#6d6f77;font-size:15px;line-height:1.55;">This code expires in 10 minutes. If you did not request it, you can safely ignore this email.</p>
            <div style="height:1px;margin:40px auto 24px;background:#e3e2e9;"></div>
            <p style="margin:0;color:#777982;font-size:13px;line-height:1.5;">This is an automated message from Choir Management.</p>
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`;

  return { html, subject, text };
}
