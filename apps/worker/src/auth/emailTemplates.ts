import {
  escapeEmailHtml,
  renderEmailAction,
  renderEmailDocument,
  renderEmailHighlight,
} from "../communications/emailPresentation";

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

const paragraphStyle =
  "color:#30343b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;margin:0 0 18px;";
const mutedStyle =
  "color:#626971;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;margin:20px 0 0;";

function paragraph(value: string, muted = false): string {
  return `<p style="${muted ? mutedStyle : paragraphStyle}">${escapeEmailHtml(value)}</p>`;
}

function emphasizedValue(value: string): string {
  return renderEmailHighlight(
    `<p style="color:#17181d;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;line-height:26px;margin:0;overflow-wrap:anywhere;">${escapeEmailHtml(value)}</p>`,
  );
}

export function buildEmailChangeConfirmationEmail(
  confirmationUrl: string,
  newEmail: string,
): EmailChangeEmailContent {
  const subject = "Confirm your new email address";
  const introduction = "Confirm this address to finish updating your Choir Management account.";
  const footer = "This confirmation link expires in 30 minutes.";
  return {
    html: renderEmailDocument({
      bodyHtml: `${paragraph(introduction)}${emphasizedValue(newEmail)}${renderEmailAction("Confirm email address", confirmationUrl)}${paragraph(footer, true)}${paragraph("If you did not request this change, you can ignore this message. Your account will keep its current email address.", true)}`,
      heading: subject,
      preheader: `${footer} Confirm ${newEmail}.`,
    }),
    subject,
    text: `${subject}\n\n${introduction}\n\nNew email: ${newEmail}\n\nConfirm email address: ${confirmationUrl}\n\n${footer}\n\nIf you did not request this change, you can ignore this message. Your account will keep its current email address.`,
  };
}

export function buildEmailChangeNoticeEmail(
  newEmail: string,
  stage: "confirmed" | "requested",
): EmailChangeEmailContent {
  const confirmed = stage === "confirmed";
  const subject = confirmed ? "Your email address was changed" : "Email address change requested";
  const introduction = confirmed
    ? "Your Choir Management sign-in email address has been updated."
    : "A request was made to change the sign-in email address for your Choir Management account.";
  const detail = confirmed
    ? `The new sign-in email is ${newEmail}.`
    : `The requested new sign-in email is ${newEmail}.`;
  const footer = confirmed
    ? "If you did not make this change, sign in and update your password, then contact your Organization administrator."
    : "If you did not request this change, sign in and update your password, then contact your Organization administrator. The change will not complete unless the new address is confirmed.";
  return {
    html: renderEmailDocument({
      bodyHtml: `${paragraph(introduction)}${emphasizedValue(detail)}${paragraph(footer, true)}`,
      heading: subject,
      preheader: detail,
    }),
    subject,
    text: `${subject}\n\n${introduction}\n\n${detail}\n\n${footer}`,
  };
}

export function buildPasswordResetEmail(resetUrl: string): OneTimeCodeEmailContent {
  const subject = "Reset your Choir Management password";
  const introduction = "A password reset was requested for your Choir Management account.";
  const expiry = "This link expires in 30 minutes and can be used only once.";
  return {
    html: renderEmailDocument({
      bodyHtml: `${paragraph(introduction)}${renderEmailAction("Reset password", resetUrl)}${paragraph(expiry, true)}${paragraph("If you did not request a password reset, you can ignore this message. Your password has not changed.", true)}`,
      heading: "Reset your password",
      preheader: expiry,
    }),
    subject,
    text: `Reset your password\n\n${introduction}\n\nReset password: ${resetUrl}\n\n${expiry}\n\nIf you did not request a password reset, you can ignore this message. Your password has not changed.`,
  };
}

export function buildOrganizationInvitationEmail(
  invitationUrl: string,
  organizationName: string,
): OneTimeCodeEmailContent {
  const subject = `You're invited to join ${organizationName}`;
  const introduction = `${organizationName} invited you to join its Choir Management workspace.`;
  const expiry = "This invitation expires in 8 days.";
  return {
    html: renderEmailDocument({
      bodyHtml: `${paragraph(introduction)}${renderEmailAction("Review invitation", invitationUrl)}${paragraph(expiry, true)}${paragraph("If you were not expecting this invitation, you can ignore this message.", true)}`,
      heading: `Join ${organizationName}`,
      preheader: `${introduction} ${expiry}`,
    }),
    subject,
    text: `Join ${organizationName}\n\n${introduction}\n\nReview invitation: ${invitationUrl}\n\n${expiry}\n\nIf you were not expecting this invitation, you can ignore this message.`,
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
  const expiry = "This code expires in 10 minutes.";
  const text = `${heading}\n\n${signIn ? `Use ${otp} to sign in.` : `Use ${otp} to verify your email.`}\n\n${introduction}\n\n${expiry} If you did not request it, you can safely ignore this message.`;
  const html = renderEmailDocument({
    bodyHtml: `${paragraph(introduction)}${renderEmailHighlight(`<p style="color:#17181d;font-family:Arial,Helvetica,sans-serif;font-size:40px;font-weight:700;letter-spacing:8px;line-height:48px;margin:0;text-align:center;">${escapeEmailHtml(otp)}</p>`)}${paragraph(expiry, true)}${paragraph("If you did not request this code, you can safely ignore this message.", true)}`,
    heading,
    preheader: `${signIn ? "Sign-in" : "Verification"} code: ${otp}. ${expiry}`,
  });

  return { html, subject, text };
}
