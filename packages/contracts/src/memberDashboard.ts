import { z } from "zod";

import { requestIdSchema } from "./primitives";
import { moduleStateSchema } from "./setup";
import { singerEventSchema } from "./events";
import { organizationResourceSchema } from "./resources";
import { duesStatusSchema, seasonSchema } from "./seasons";

export const memberDashboardWidgetStateSchema = z.enum(["disabled", "ready", "unavailable"]);

export const memberDashboardBulletinSchema = z.object({
  contentMarkdown: z.string().max(100_000),
  id: z.uuid(),
  sentAt: z.iso.datetime(),
  subject: z.string().max(300),
  preview: z.string().max(320),
});

export const memberDashboardPollSchema = z.object({
  expiresAt: z.string().max(100),
  id: z.uuid(),
  linkToken: z.string().min(1).max(4_096),
  title: z.string().min(1).max(500),
});

export const memberDashboardActiveSeasonSchema = z.object({
  duesStatus: duesStatusSchema.nullable(),
  season: seasonSchema,
});

export const memberDashboardResponseSchema = z.object({
  activeSeason: memberDashboardActiveSeasonSchema.nullable(),
  activeSeasonState: memberDashboardWidgetStateSchema,
  bulletins: z.array(memberDashboardBulletinSchema).max(5),
  bulletinsState: memberDashboardWidgetStateSchema,
  events: z.array(singerEventSchema).max(500),
  modules: z.array(moduleStateSchema),
  organizationName: z.string().min(1).max(200),
  performerLabel: z.string().min(1).max(50),
  polls: z.array(memberDashboardPollSchema).max(500),
  pollsState: memberDashboardWidgetStateSchema,
  profile: z
    .object({
      displayName: z.string().min(1).max(200),
      id: z.uuid(),
      voicePart: z.string().max(100),
    })
    .nullable(),
  profileLinkRequired: z.boolean(),
  requestId: requestIdSchema,
  resources: z.array(organizationResourceSchema).max(5),
  resourcesState: memberDashboardWidgetStateSchema,
  timezone: z.string().min(1).max(100),
});

export type MemberDashboardResponse = z.infer<typeof memberDashboardResponseSchema>;
