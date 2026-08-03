import { ticketMessageTemplates } from "../ticketMessageTemplates";

const supportedSystemCommunicationTemplates = [
  {
    channel: "Email",
    contentMarkdown:
      "Hello everyone,\n\nI have an important announcement regarding our upcoming schedule.\n\n[Your message here]\n\nBest regards,\nChoir Management",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000001",
    subject: "Choir Announcement",
    title: "General Announcement",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hello {singerName},\n\nOur seasonal dues for the current term are now being collected. If you haven't had a chance to pay yet, please do so at your earliest convenience.\n\nIf you've already paid, please ignore this message.\n\nThank you for your support!",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000002",
    subject: "Choir Dues Payment Reminder",
    title: "Dues Payment Notice",
  },
  {
    channel: "Both",
    contentMarkdown:
      "Attention Choir Members,\n\nDue to inclement weather, today's rehearsal/performance for {eventTitle} has been delayed or cancelled.\n\nNew Time/Status: [Details here]\n\nPlease stay safe!",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000003",
    subject: "IMPORTANT: Schedule Change for {eventTitle}",
    title: "Weather / Schedule Delay Alert",
  },
] as const;

export function seedSupportedSystemCommunicationTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of supportedSystemCommunicationTemplates) {
    sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE id = ?)`,
      template.id,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      now,
      template.id,
    );
  }
}

const rsvpSystemCommunicationTemplates = [
  {
    channel: "Email",
    contentMarkdown:
      "Hello {singerName},\n\nRSVP is now open for our upcoming {eventType}: {eventTitle}.\n\nDate: {eventDate}\nLocation: {eventLocation}\n\nPlease let us know if you can attend using the link below:\n\n{{RSVP_LINKS}}\n\nDetails:\n{eventDetails}",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000004",
    subject: "Invitation: {eventTitle}",
    title: "Event RSVP Invitation",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\nThis is a friendly reminder for our upcoming rehearsal: {eventTitle}.\n\nDate & Time: {eventDate}\nLocation: {eventLocation}\n\nPlease let us know if you will be attending.\n\nRSVP:\n{{RSVP_LINKS}}\n\nThank you,\nChoir Management",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000005",
    subject: "Reminder: Rehearsal for {eventTitle}",
    title: "Rehearsal Reminder",
  },
] as const;

const scheduledEventSystemCommunicationTemplates = [
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\nThis is a follow-up reminder to RSVP for our upcoming Performance: {eventTitle}.\n\nDate & Time: {eventDate}\nLocation: {eventLocation}\n\nPlease let us know whether you can attend:\n\n{{RSVP_LINKS}}\n\nThank you,\nChoir Management",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000015",
    subject: "RSVP follow-up: {eventTitle}",
    title: "Event RSVP Follow-up",
  },
  {
    channel: "Email",
    contentMarkdown:
      "## Attendance Report\n\n**{eventTitle}**\n\nDate & Time: {eventDate}\nEvent type: {eventType}\n\nAttendance rate: **{attendanceRate}%**\nPresent: {presentCount} / {totalCount}\n\n### Absences\n{absenteesList}\n\n{thresholdWarningsSection}\n\nThank you,\nChoir Management",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000016",
    subject: "Attendance report: {eventTitle}",
    title: "Attendance Report",
  },
] as const;

export function seedRsvpSystemCommunicationTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of rsvpSystemCommunicationTemplates) {
    sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE id = ?)`,
      template.id,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      now,
      template.id,
    );
  }
}

export function seedScheduledEventSystemCommunicationTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of scheduledEventSystemCommunicationTemplates) {
    sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE id = ?)`,
      template.id,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      now,
      template.id,
    );
  }
}

const playerSystemCommunicationTemplates = [
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\nThis is a friendly reminder for our upcoming performance: {eventTitle}.\n\nDate & Time: {eventDate}\nLocation: {eventLocation}\nCall Time: {eventCallTime}\n\nSet List:\n{setlist}\n\nPractice Player:\n{{PLAYER_LINK}}\n\nRSVP:\n{{RSVP_LINKS}}\n\nThank you,\nChoir Management",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000006",
    subject: "Reminder: Upcoming Performance - {eventTitle}",
    title: "Performance Reminder",
  },
] as const;

export const auditionSystemCommunicationTemplateIds = {
  confirmation: "5f0ca4a5-7e4c-4e1a-9a1c-000000000010",
  reminder: "5f0ca4a5-7e4c-4e1a-9a1c-000000000012",
  submission: "5f0ca4a5-7e4c-4e1a-9a1c-000000000011",
} as const;

export const auditionSystemCommunicationTemplates = [
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\nThanks for submitting your audition inquiry. We received your information and will be in touch soon.\n\nBest,\nChoir Management",
    id: auditionSystemCommunicationTemplateIds.submission,
    subject: "Thanks for submitting your audition inquiry",
    title: "Audition Submission Thanks",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\nYour audition is confirmed for {auditionDate} at {auditionTime}.\n\nLocation: {auditionLocation}\n\n{{AUDITION_LINK}}\n\nWe look forward to meeting you!\n\nBest,\nChoir Management",
    id: auditionSystemCommunicationTemplateIds.confirmation,
    subject: "Your audition is confirmed",
    title: "Audition Confirmed",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\nThis is a reminder that your audition is scheduled for {auditionDate} at {auditionTime}.\n\nLocation: {auditionLocation}\n\n{{AUDITION_LINK}}\n\nSee you soon!\n\nBest,\nChoir Management",
    id: auditionSystemCommunicationTemplateIds.reminder,
    subject: "Reminder: your audition is tomorrow",
    title: "Audition Reminder",
  },
] as const;

export function seedPlayerSystemCommunicationTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of playerSystemCommunicationTemplates) {
    sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE id = ?)`,
      template.id,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      now,
      template.id,
    );
  }
}

export function seedAuditionSystemCommunicationTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of auditionSystemCommunicationTemplates) {
    sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE id = ?)`,
      template.id,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      now,
      template.id,
    );
  }
}

export function seedTicketSystemCommunicationTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of ticketMessageTemplates) {
    sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE id = ?)`,
      template.id,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      now,
      template.id,
    );
  }
}
