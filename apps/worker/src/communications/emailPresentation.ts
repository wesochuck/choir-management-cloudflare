export interface EmailDocumentOptions {
  readonly bodyHtml: string;
  readonly footerHtml?: string | undefined;
  readonly heading: string;
  readonly organizationInitials?: string | null | undefined;
  readonly organizationLogoUrl?: string | null | undefined;
  readonly organizationName?: string | null | undefined;
  readonly preheader: string;
}

export function escapeEmailHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeEmailUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? escapeEmailHtml(value)
      : null;
  } catch {
    return null;
  }
}

export function renderEmailAction(label: string, url: string): string {
  const safeUrl = safeEmailUrl(url);
  if (!safeUrl) return `<p>${escapeEmailHtml(label)}</p>`;
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:24px 0;width:auto;">
  <tr>
    <td bgcolor="#1b4d3e" style="background-color:#1b4d3e;border:1px solid #1b4d3e;border-radius:8px;padding:13px 22px;text-align:center;">
      <a href="${safeUrl}" style="color:#ffffff;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:20px;text-decoration:none;">${escapeEmailHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

export function renderEmailHighlight(contentHtml: string): string {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:24px 0;width:100%;">
  <tr>
    <td bgcolor="#edf5f1" style="background-color:#edf5f1;border-left:4px solid #1b4d3e;padding:18px 20px;">${contentHtml}</td>
  </tr>
</table>`;
}

export function renderEmailDocument({
  bodyHtml,
  footerHtml,
  heading,
  organizationInitials,
  organizationLogoUrl,
  organizationName,
  preheader,
}: EmailDocumentOptions): string {
  const safeHeading = escapeEmailHtml(heading);
  const safePreheader = escapeEmailHtml(preheader);
  const trimmedName = organizationName?.trim();
  const orgName = trimmedName && trimmedName.length > 0 ? trimmedName : "Choir Management";
  const trimmedInitials = organizationInitials?.trim();
  const computedInitials = orgName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const orgInitials =
    trimmedInitials && trimmedInitials.length > 0
      ? trimmedInitials
      : computedInitials.length > 0
        ? computedInitials
        : "CM";
  const safeLogoUrl = organizationLogoUrl ? safeEmailUrl(organizationLogoUrl) : null;
  const renderedFooter =
    footerHtml ??
    `<p style="margin:0;color:#687078;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">This automated message was sent by ${escapeEmailHtml(orgName)}.</p>`;
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta http-equiv="x-ua-compatible" content="ie=edge">
    <title>${safeHeading}</title>
    <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
    <style>
      table, td { border-collapse: collapse; }
      a { color: #1b4d3e; }
      @media only screen and (max-width: 620px) {
        .email-shell { width: 100% !important; }
        .email-pad { padding-left: 24px !important; padding-right: 24px !important; }
        .email-heading { font-size: 28px !important; line-height: 34px !important; }
      }
    </style>
  </head>
  <body style="background-color:#f4f3f8;margin:0;padding:0;width:100%;word-spacing:normal;">
    <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${safePreheader}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f4f3f8" style="background-color:#f4f3f8;border-collapse:collapse;width:100%;">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600"><tr><td><![endif]-->
          <table class="email-shell" role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #dedde5;border-collapse:separate;border-radius:12px;max-width:600px;width:100%;">
            <tr>
              <td class="email-pad" style="border-bottom:1px solid #e8e7ed;padding:24px 40px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <tr>
                    ${
                      safeLogoUrl
                        ? `<td style="vertical-align:middle;"><img src="${safeLogoUrl}" alt="${escapeEmailHtml(orgName)}" height="32" style="border:0;display:block;max-height:32px;max-width:120px;width:auto;" /></td>`
                        : `<td bgcolor="#1b4d3e" style="background-color:#1b4d3e;border-radius:6px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:32px;text-align:center;width:32px;">${escapeEmailHtml(orgInitials)}</td>`
                    }
                    <td style="color:#1b4d3e;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:22px;padding-left:12px;">${escapeEmailHtml(orgName)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-pad" style="padding:36px 40px 32px;">
                <h1 class="email-heading" style="color:#17181d;font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:700;letter-spacing:-0.3px;line-height:39px;margin:0 0 24px;">${safeHeading}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td class="email-pad" bgcolor="#f8f8fa" style="background-color:#f8f8fa;border-top:1px solid #e8e7ed;padding:22px 40px;">
                ${renderedFooter}
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
