import { ticketMessageTemplates } from "../ticketMessageTemplates";

const supportedSystemCommunicationTemplates = [
  {
    channel: "Email",
    contentMarkdown:
      "## Your announcement\n\n[Lead with the most important update.]\n\n- What is changing: [Add details]\n- When: [Add date and time]\n- What members should do: [Add next step]\n\nThank you,\nChoir Management",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000001",
    subject: "Choir update: [Key message]",
    title: "General Announcement",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\n## Seasonal dues are ready for payment\n\n**Action needed:** Please submit your dues for the current term at your earliest convenience.\n\nIf you have already paid, no further action is needed.\n\nThank you for supporting the choir.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000002",
    subject: "Reminder: seasonal dues are ready for payment",
    title: "Dues Payment Notice",
  },
  {
    channel: "Both",
    contentMarkdown:
      "Schedule update for {eventTitle}\n\n[State whether the event is delayed, cancelled, or relocated.]\n\nNew time or status: [Add details]\nWhat you need to do: [Add next step]\n\nPlease stay safe.",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000003",
    subject: "Schedule change: {eventTitle}",
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
      "Hi {singerName},\n\n## Please RSVP for {eventTitle}\n\n- **Date and time:** {eventDate}\n- **Location:** {eventLocation}\n- **Event type:** {eventType}\n\n{{RSVP_LINKS}}\n\n### Event details\n\n{eventDetails}",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000004",
    subject: "Please RSVP: {eventTitle}",
    title: "Event RSVP Invitation",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\n## Rehearsal reminder\n\n- **Rehearsal:** {eventTitle}\n- **Date and time:** {eventDate}\n- **Location:** {eventLocation}\n\nPlease confirm whether you can attend.\n\n{{RSVP_LINKS}}\n\nThank you,\nChoir Management",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000005",
    subject: "Rehearsal reminder: {eventTitle}",
    title: "Rehearsal Reminder",
  },
] as const;

const scheduledEventSystemCommunicationTemplates = [
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\n## Your RSVP is still needed\n\n- **Event:** {eventTitle}\n- **Date and time:** {eventDate}\n- **Location:** {eventLocation}\n\nPlease let us know whether you can attend.\n\n{{RSVP_LINKS}}\n\nThank you,\nChoir Management",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000015",
    subject: "RSVP needed: {eventTitle}",
    title: "Event RSVP Follow-up",
  },
  {
    channel: "Email",
    contentMarkdown:
      "## {attendanceRate}% attendance for {eventTitle}\n\n- **Present:** {presentCount} of {totalCount}\n- **Date and time:** {eventDate}\n- **Event type:** {eventType}\n\n{thresholdWarningsSection}\n\n### Absences\n\n{absenteesList}\n\nThank you,\nChoir Management",
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
      "Hi {singerName},\n\n## Performance reminder: {eventTitle}\n\n- **Call time:** {eventCallTime}\n- **Performance:** {eventDate}\n- **Location:** {eventLocation}\n\n{{RSVP_LINKS}}\n\n### Set list\n\n{setlist}\n\n### Practice materials\n\n{{PLAYER_LINK}}\n\nThank you,\nChoir Management",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000006",
    subject: "Performance reminder: {eventTitle}",
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
      "Hi {singerName},\n\n## We received your audition inquiry\n\nThank you for your interest. Our team will review your information and contact you with next steps.\n\nNo action is needed right now.\n\nBest,\nChoir Management",
    id: auditionSystemCommunicationTemplateIds.submission,
    subject: "We received your audition inquiry",
    title: "Audition Submission Thanks",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\n## Your audition is confirmed\n\n- **Date:** {auditionDate}\n- **Time:** {auditionTime}\n- **Location:** {auditionLocation}\n\n{{AUDITION_LINK}}\n\nUse the link above if you need to review or update your audition. We look forward to meeting you.\n\nBest,\nChoir Management",
    id: auditionSystemCommunicationTemplateIds.confirmation,
    subject: "Your audition is confirmed",
    title: "Audition Confirmed",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\n## Your audition is tomorrow\n\n- **Date:** {auditionDate}\n- **Time:** {auditionTime}\n- **Location:** {auditionLocation}\n\n{{AUDITION_LINK}}\n\nUse the link above if you need to review or update your audition. We look forward to seeing you.\n\nBest,\nChoir Management",
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

export function refreshUnmodifiedSystemCommunicationTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  const templates = [
    ...supportedSystemCommunicationTemplates,
    ...rsvpSystemCommunicationTemplates,
    ...scheduledEventSystemCommunicationTemplates,
    ...playerSystemCommunicationTemplates,
    ...auditionSystemCommunicationTemplates,
    ...ticketMessageTemplates,
  ];
  for (const template of templates) {
    sql.exec(
      `UPDATE communication_templates
       SET title = ?, channel = ?, subject = ?, content_markdown = ?, updated_at = ?
       WHERE id = ? AND is_system = 1 AND updated_at = created_at`,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      template.id,
    );
  }
}
