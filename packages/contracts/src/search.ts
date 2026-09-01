import { z } from "zod";
import { requestIdSchema } from "./primitives";

export const searchCategorySchema = z.enum([
  "navigation",
  "settings",
  "roster",
  "events",
  "music",
  "polls",
  "actions",
]);

export const searchResultItemSchema = z.object({
  actionId: z.string().max(100).optional(),
  badge: z.string().max(100).optional(),
  category: searchCategorySchema,
  href: z.string().max(1_000).optional(),
  id: z.string().min(1).max(200),
  subtitle: z.string().max(300).optional(),
  title: z.string().min(1).max(300),
});

export const adminSearchQueryRequestSchema = z.object({
  category: searchCategorySchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
  query: z.string().trim().max(200),
});

export const adminSearchQueryResponseSchema = z.object({
  requestId: requestIdSchema,
  results: z.array(searchResultItemSchema),
});

export type SearchCategory = z.infer<typeof searchCategorySchema>;
export type SearchResultItem = z.infer<typeof searchResultItemSchema>;
export type AdminSearchQueryRequest = z.infer<typeof adminSearchQueryRequestSchema>;
export type AdminSearchQueryResponse = z.infer<typeof adminSearchQueryResponseSchema>;
