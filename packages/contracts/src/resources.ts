import { z } from "zod";
import { requestIdSchema } from "./primitives";
const organizationResourceBaseSchema = z.object({
  fileId: z.uuid().nullable().default(null),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  title: z.string().trim().min(1).max(300),
  url: z
    .url()
    .max(2_000)
    .refine((value) => new URL(value).protocol === "https:", "Resource links must use HTTPS.")
    .nullable()
    .default(null),
});

export const organizationResourceRequestSchema = organizationResourceBaseSchema.superRefine(
  ({ fileId, url }, context) => {
    if ((fileId === null) === (url === null)) {
      context.addIssue({
        code: "custom",
        message: "A resource must contain exactly one private file or HTTPS link.",
      });
    }
  },
);

export const organizationResourceSchema = organizationResourceBaseSchema
  .extend({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine(({ fileId, url }, context) => {
    if ((fileId === null) === (url === null)) {
      context.addIssue({ code: "custom", message: "Invalid resource target." });
    }
  });

export const organizationResourcesResponseSchema = z.object({
  requestId: requestIdSchema,
  resources: z.array(organizationResourceSchema).max(500),
});

export const organizationResourceResponseSchema = organizationResourceSchema.and(
  z.object({ requestId: requestIdSchema }),
);

export const organizationResourceOrderRequestSchema = z.object({
  resourceIds: z.array(z.uuid()).max(500),
});

export const organizationResourceDeleteResponseSchema = z.object({
  requestId: requestIdSchema,
  resourceId: z.uuid(),
  status: z.literal("deleted"),
});

export type OrganizationResourceRequest = z.infer<typeof organizationResourceRequestSchema>;
export type OrganizationResource = z.infer<typeof organizationResourceSchema>;
