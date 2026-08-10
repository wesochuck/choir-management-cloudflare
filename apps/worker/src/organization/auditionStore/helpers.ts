import {
  organizationAuditionSettingsSchema,
  organizationRosterConfigurationRequestSchema,
  type OrganizationAuditionSettings,
} from "@choir/contracts";
import { defaultRosterConfiguration, renderCommunicationTemplate } from "@choir/domain";

import { auditionSystemCommunicationTemplates } from "../schema";
import {
  AUDITION_REMINDER_LEAD_MS,
  defaultAuditionSettings,
  type AuditionSystemCommunicationTemplate,
} from "./contracts";

export function parseRequestedSlots(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item): item is string => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function storedAuditionSettings(
  storage: DurableObjectStorage,
): OrganizationAuditionSettings {
  try {
    const raw = storage.sql
      .exec<{ readonly settings: string }>(
        "SELECT audition_settings_json AS settings FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.settings;
    if (raw) {
      const parsed = organizationAuditionSettingsSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Use the backwards-compatible defaults for Organizations provisioned before audition settings.
  }
  return defaultAuditionSettings;
}

export function publicAuditionRosterOptions(storage: DurableObjectStorage): {
  readonly performerLabel: string;
  readonly sections: readonly { readonly code: string; readonly name: string }[];
  readonly voiceParts: readonly {
    readonly fullName: string;
    readonly label: string;
    readonly sectionCode: string;
  }[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(
      storage.sql
        .exec<{ readonly configuration: string }>(
          "SELECT roster_configuration_json AS configuration FROM organization_metadata LIMIT 1",
        )
        .one().configuration,
    ) as unknown;
  } catch {
    raw = defaultRosterConfiguration;
  }
  const parsed = organizationRosterConfigurationRequestSchema.safeParse(raw);
  const configuration = parsed.success
    ? parsed.data
    : organizationRosterConfigurationRequestSchema.parse(defaultRosterConfiguration);
  const sections = configuration.sections
    .filter(({ trackOnly }) => !trackOnly)
    .map(({ code, name }) => ({ code, name }));
  const sectionCodes = new Set(sections.map(({ code }) => code));
  const voiceParts = configuration.voiceParts
    .filter(({ sectionCode }) => sectionCodes.has(sectionCode))
    .map(({ fullName, label, sectionCode }) => ({ fullName, label, sectionCode }));
  return { performerLabel: configuration.performerLabel, sections, voiceParts };
}

export function readAuditionSystemCommunicationTemplate(
  storage: DurableObjectStorage,
  templateId: string,
): AuditionSystemCommunicationTemplate {
  const stored = storage.sql
    .exec<AuditionSystemCommunicationTemplate>(
      `SELECT content_markdown AS contentMarkdown, subject
       FROM communication_templates
       WHERE id = ? AND is_system = 1 AND channel = 'Email'
       LIMIT 1`,
      templateId,
    )
    .toArray()
    .at(0);
  if (stored) return stored;
  const fallback = auditionSystemCommunicationTemplates.find(({ id }) => id === templateId);
  return fallback ?? auditionSystemCommunicationTemplates[0];
}

export function auditionTemplateValues(
  storage: DurableObjectStorage,
  scheduledAt: string,
): Readonly<Record<string, string>> {
  const organization = storage.sql
    .exec<{ readonly timezone: string }>("SELECT timezone FROM organization_metadata LIMIT 1")
    .toArray()
    .at(0);
  const settings = storedAuditionSettings(storage);
  const venue = settings.venueId
    ? storage.sql
        .exec<{ readonly address: string; readonly name: string }>(
          "SELECT address, name FROM venues WHERE id = ? LIMIT 1",
          settings.venueId,
        )
        .toArray()
        .at(0)
    : undefined;
  const date = new Date(scheduledAt);
  const validDate = !Number.isNaN(date.getTime());
  let timezone = "UTC";
  if (organization?.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: organization.timezone }).format(date);
      timezone = organization.timezone;
    } catch {
      // Fall back to UTC if an older Organization contains an invalid timezone value.
    }
  }
  const auditionDate = validDate
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: timezone }).format(date)
    : scheduledAt;
  const auditionTime = validDate
    ? new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: timezone }).format(date)
    : scheduledAt;
  const auditionLocation = venue
    ? [venue.name, venue.address].filter((value) => value.trim().length > 0).join(", ")
    : "the audition venue";
  return {
    auditionDate,
    auditionDateTime: `${auditionDate} at ${auditionTime}`,
    auditionLocation,
    auditionTime,
  };
}

export function renderAuditionSystemCommunication(
  storage: DurableObjectStorage,
  templateId: string,
  recipientName: string,
  values: Readonly<Record<string, string>> = {},
): AuditionSystemCommunicationTemplate {
  const template = readAuditionSystemCommunicationTemplate(storage, templateId);
  return {
    contentMarkdown: renderCommunicationTemplate(template.contentMarkdown, recipientName, values),
    subject: renderCommunicationTemplate(template.subject, recipientName, values),
  };
}

export function auditionReminderDueAt(scheduledAt: string, now: string): string {
  const scheduledAtMs = new Date(scheduledAt).getTime();
  const nowMs = new Date(now).getTime();
  if (Number.isNaN(scheduledAtMs) || Number.isNaN(nowMs)) return now;
  return new Date(Math.max(nowMs, scheduledAtMs - AUDITION_REMINDER_LEAD_MS)).toISOString();
}

export function auditionSlotsAreConfigured(
  storage: DurableObjectStorage,
  requestedSlots: readonly string[] | undefined,
): boolean {
  if (!requestedSlots || requestedSlots.length === 0) return true;
  const allowed = new Set(storedAuditionSettings(storage).slots.map(({ startsAt }) => startsAt));
  return requestedSlots.every((slot) => allowed.has(slot));
}
