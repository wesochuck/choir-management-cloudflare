import { z } from "zod";
import { requestIdSchema } from "./primitives";
export const publicRsvpDetailsResponseSchema = z.object({
  canSubmit: z.boolean(),
  event: z.object({
    callTime: z.string(),
    details: z.string(),
    durationMinutes: z.number().int().positive().nullable(),
    id: z.uuid(),
    location: z.string(),
    startsAt: z.iso.datetime(),
    title: z.string(),
    type: z.enum(["Performance", "Rehearsal"]),
    venueAddress: z.string(),
    venueName: z.string(),
  }),
  profileId: z.uuid(),
  profileName: z.string(),
  rsvp: z.enum(["Yes", "No", "Pending"]),
  rsvpNote: z.string(),
});

export type PublicRsvpDetailsResponse = z.infer<typeof publicRsvpDetailsResponseSchema>;

export const publicQuickRsvpRequestSchema = z.object({
  rsvp: z.enum(["Yes", "No", "Pending"]),
  rsvpNote: z.string().trim().max(2_000).default(""),
  token: z.string().min(1).max(4_096),
});

export type PublicQuickRsvpRequest = z.infer<typeof publicQuickRsvpRequestSchema>;

export const generateRsvpTokensRequestSchema = z.object({
  eventId: z.uuid(),
  profileIds: z.array(z.uuid()).min(1).max(500),
});

export type GenerateRsvpTokensRequest = z.infer<typeof generateRsvpTokensRequestSchema>;

export const generateRsvpTokensResponseSchema = z.object({
  tokens: z.record(z.uuid(), z.string().min(1).max(4_096)),
});

export type GenerateRsvpTokensResponse = z.infer<typeof generateRsvpTokensResponseSchema>;

export const organizationPollOptionSchema = z.object({
  id: z.uuid(),
  label: z.string().trim().min(1).max(500),
  sortOrder: z.number().int().nonnegative().default(0),
});

export type OrganizationPollOption = z.infer<typeof organizationPollOptionSchema>;

export const organizationPollRequestSchema = z.object({
  archivedAt: z.union([z.literal(""), z.iso.datetime()]).default(""),
  description: z.string().trim().max(10_000).default(""),
  expiresAt: z.iso.datetime(),
  multipleChoice: z.boolean().default(false),
  options: z.array(organizationPollOptionSchema).min(2).max(100),
  title: z.string().trim().min(1).max(500),
});

export type OrganizationPollRequest = z.infer<typeof organizationPollRequestSchema>;

export const organizationPollSchema = organizationPollRequestSchema.extend({
  createdAt: z.iso.datetime(),
  createdBy: z.string().min(1),
  id: z.uuid(),
  updatedAt: z.iso.datetime(),
});

export type OrganizationPoll = z.infer<typeof organizationPollSchema>;

export const organizationPollSummarySchema = z.object({
  archivedAt: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  id: z.uuid(),
  responseCount: z.number().int().nonnegative(),
  title: z.string(),
});

export const organizationPollSummariesResponseSchema = z.object({
  polls: z.array(organizationPollSummarySchema).max(500),
  requestId: requestIdSchema,
});

export type OrganizationPollSummary = z.infer<typeof organizationPollSummarySchema>;
export type OrganizationPollSummariesResponse = z.infer<
  typeof organizationPollSummariesResponseSchema
>;

export const organizationPollResponseSchema = z.object({
  optionIds: z.array(z.uuid()).min(1).max(100),
  profileId: z.uuid(),
  profileName: z.string(),
});

export type OrganizationPollResponse = z.infer<typeof organizationPollResponseSchema>;

export const publicPollDetailsResponseSchema = z.object({
  canSubmit: z.boolean(),
  description: z.string(),
  expiresAt: z.iso.datetime(),
  multipleChoice: z.boolean(),
  options: z.array(organizationPollOptionSchema),
  pollId: z.uuid(),
  profileId: z.string(),
  profileName: z.string(),
  responseOptionIds: z.array(z.uuid()),
  title: z.string(),
});

export type PublicPollDetailsResponse = z.infer<typeof publicPollDetailsResponseSchema>;

export const publicPollSubmitRequestSchema = z.object({
  optionIds: z.array(z.uuid()).min(1).max(100),
  token: z.string().min(1).max(4_096),
});

export type PublicPollSubmitRequest = z.infer<typeof publicPollSubmitRequestSchema>;

export const generatePollTokensRequestSchema = z.object({
  pollId: z.uuid(),
  profileIds: z.array(z.uuid()).min(1).max(500),
});

export type GeneratePollTokensRequest = z.infer<typeof generatePollTokensRequestSchema>;

export const generatePollTokensResponseSchema = z.object({
  tokens: z.record(z.uuid(), z.string().min(1).max(4_096)),
});

export type GeneratePollTokensResponse = z.infer<typeof generatePollTokensResponseSchema>;
