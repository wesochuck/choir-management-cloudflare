import { z } from "zod";
import { musicTrackFileIdsSchema } from "./music";
export const playerPlaylistItemSchema = z.object({
  arranger: z.string().nullable().optional(),
  composer: z.string().nullable().optional(),
  durationSeconds: z.number().int().nonnegative().nullable().optional(),
  isFeaturedNumber: z.boolean().nullable().optional(),
  notes: z.string().nullable().optional(),
  pieceId: z.uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  trackFileIds: musicTrackFileIdsSchema,
});

export type PlayerPlaylistItem = z.infer<typeof playerPlaylistItemSchema>;

export const publicPlayerDetailsResponseSchema = z.object({
  eventArtworkFileId: z.uuid().nullable().optional(),
  eventId: z.uuid(),
  eventTitle: z.string(),
  eventStartsAt: z.string(),
  items: z.array(playerPlaylistItemSchema),
  performerLabel: z.string().optional(),
  profileId: z.string(),
  profileName: z.string(),
});

export type PublicPlayerDetailsResponse = z.infer<typeof publicPlayerDetailsResponseSchema>;

export const generatePlayerTokensRequestSchema = z.object({
  eventId: z.uuid(),
  profileIds: z.array(z.uuid()).min(1).max(500),
});

export type GeneratePlayerTokensRequest = z.infer<typeof generatePlayerTokensRequestSchema>;

export const generatePlayerTokensResponseSchema = z.object({
  tokens: z.record(z.uuid(), z.string().min(1).max(4_096)),
});

export type GeneratePlayerTokensResponse = z.infer<typeof generatePlayerTokensResponseSchema>;
