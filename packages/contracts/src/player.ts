import { z } from "zod";
export const playerPlaylistItemSchema = z.object({
  arranger: z.string().optional(),
  composer: z.string().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  isFeaturedNumber: z.boolean().optional(),
  notes: z.string().optional(),
  pieceId: z.uuid().optional(),
  title: z.string().min(1).max(300),
  trackFileIds: z.record(z.string(), z.string()),
});

export type PlayerPlaylistItem = z.infer<typeof playerPlaylistItemSchema>;

export const publicPlayerDetailsResponseSchema = z.object({
  eventId: z.uuid(),
  eventTitle: z.string(),
  eventStartsAt: z.string(),
  items: z.array(playerPlaylistItemSchema),
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
