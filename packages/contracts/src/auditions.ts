import { z } from "zod";
import { requestIdSchema } from "./primitives";
export const auditionStatusSchema = z.enum([
  "pending",
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
]);

export type AuditionStatus = z.infer<typeof auditionStatusSchema>;

export const auditionInquirySchema = z.object({
  name: z.string().min(1).max(200),
  email: z.email().max(320),
  phone: z.string().max(50).optional(),
  voicePart: z.string().max(100).optional(),
  experience: z.string().max(5_000).optional(),
  availabilityNotes: z.string().max(5_000).optional(),
  requestedSlots: z.array(z.iso.datetime()).max(20).default([]),
});

export type AuditionInquiry = z.infer<typeof auditionInquirySchema>;

export const auditionSlotSchema = z.object({
  id: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});

export type AuditionSlot = z.infer<typeof auditionSlotSchema>;

export const auditionDetailsSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  email: z.string(),
  name: z.string(),
  phone: z.string().optional(),
  voicePart: z.string().optional(),
  experience: z.string().optional(),
  availabilityNotes: z.string().optional(),
  performanceId: z.uuid().nullable().optional(),
  requestedSlots: z.array(z.iso.datetime()).max(20).default([]),
  scheduledTimeSlot: z.iso.datetime().nullable().optional(),
  status: auditionStatusSchema,
  slots: z.array(auditionSlotSchema),
});

export type AuditionDetails = z.infer<typeof auditionDetailsSchema>;

export const publicAuditionDetailsResponseSchema = z.object({
  availabilityNotes: z.string().max(5_000).optional(),
  createdAt: z.string(),
  id: z.string(),
  name: z.string(),
  requestedSlots: z.array(z.iso.datetime()).max(20).default([]),
  scheduledTimeSlot: z.iso.datetime().nullable().optional(),
  slots: z.array(auditionSlotSchema),
  status: auditionStatusSchema,
  voicePart: z.string().max(100).optional(),
});

export type PublicAuditionDetailsResponse = z.infer<typeof publicAuditionDetailsResponseSchema>;

export const publicAuditionSubmitRequestSchema = z.object({
  availabilityNotes: z.string().max(5_000).optional(),
  voicePart: z.string().max(100).optional(),
  token: z.string().min(1).max(4_096),
});

export type PublicAuditionSubmitRequest = z.infer<typeof publicAuditionSubmitRequestSchema>;

export const publicAuditionInquiryRequestSchema = z.object({
  ...auditionInquirySchema.shape,
  turnstileToken: z.string().optional(),
});

export type PublicAuditionInquiryRequest = z.infer<typeof publicAuditionInquiryRequestSchema>;

export const publicAuditionInquiryResponseSchema = z.object({
  id: z.string(),
  message: z.string(),
});

export type PublicAuditionInquiryResponse = z.infer<typeof publicAuditionInquiryResponseSchema>;

export const organizationAuditionSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string().optional(),
  voicePart: z.string().optional(),
  experience: z.string().optional(),
  availabilityNotes: z.string().optional(),
  adminNotes: z.string().optional(),
  performanceId: z.uuid().nullable().optional(),
  requestedSlots: z.array(z.iso.datetime()).max(20).default([]),
  scheduledTimeSlot: z.iso.datetime().nullable().optional(),
  status: auditionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  slots: z.array(auditionSlotSchema),
});

export type OrganizationAudition = z.infer<typeof organizationAuditionSchema>;

export const organizationAuditionResponseSchema = organizationAuditionSchema.extend({
  requestId: requestIdSchema,
});

export const organizationAuditionListResponseSchema = z.object({
  auditions: z.array(organizationAuditionSchema),
});

export type OrganizationAuditionListResponse = z.infer<
  typeof organizationAuditionListResponseSchema
>;

export const auditionSlotInputSchema = z.object({
  endsAt: z.iso.datetime(),
  id: z.string().min(1).max(128).optional(),
  startsAt: z.iso.datetime(),
});

export const organizationAuditionSettingsSchema = z
  .object({
    adminNotifyEnabled: z.boolean(),
    adminNotifyUsers: z.array(z.string().min(1).max(128)).max(100),
    confirmationMessage: z.string().max(5_000),
    defaultPerformanceId: z.uuid().nullable(),
    enabled: z.boolean(),
    slots: z.array(auditionSlotInputSchema).max(200),
    venueId: z.uuid().nullable().default(null),
  })
  .superRefine((settings, context) => {
    const starts = new Set<string>();
    const ids = new Set<string>();
    settings.slots.forEach((slot, index) => {
      if (new Date(slot.startsAt).getTime() >= new Date(slot.endsAt).getTime()) {
        context.addIssue({
          code: "custom",
          message: "An audition slot must end after it starts.",
          path: ["slots", index, "endsAt"],
        });
      }
      if (starts.has(slot.startsAt)) {
        context.addIssue({
          code: "custom",
          message: "Audition slots must have unique start times.",
          path: ["slots", index, "startsAt"],
        });
      }
      starts.add(slot.startsAt);
      if (slot.id !== undefined) {
        if (ids.has(slot.id)) {
          context.addIssue({
            code: "custom",
            message: "Audition slot IDs must be unique.",
            path: ["slots", index, "id"],
          });
        }
        ids.add(slot.id);
      }
    });
  });

export const organizationAuditionSettingsResponseSchema = organizationAuditionSettingsSchema.extend(
  {
    requestId: requestIdSchema,
  },
);

export type OrganizationAuditionSettings = z.infer<typeof organizationAuditionSettingsSchema>;

export const publicAuditionSettingsSchema = z.object({
  confirmationMessage: z.string().max(5_000),
  defaultPerformanceId: z.uuid().nullable(),
  enabled: z.boolean(),
  performance: z
    .object({
      id: z.uuid(),
      startsAt: z.iso.datetime(),
      title: z.string().min(1).max(500),
    })
    .nullable()
    .default(null),
  sections: z
    .array(
      z.object({
        code: z.string().min(1).max(20),
        name: z.string().min(1).max(100),
      }),
    )
    .max(50)
    .default([]),
  slots: z.array(auditionSlotInputSchema).max(200),
  timezone: z.string().min(1).max(128).default("UTC"),
  venue: z
    .object({
      address: z.string().max(2_000),
      name: z.string().min(1).max(500),
    })
    .nullable()
    .default(null),
  voiceParts: z
    .array(
      z.object({
        fullName: z.string().min(1).max(100),
        label: z.string().min(1).max(50),
        sectionCode: z.string().min(1).max(20),
      }),
    )
    .max(100)
    .default([]),
});

export type PublicAuditionSettings = z.infer<typeof publicAuditionSettingsSchema>;

export const organizationAuditionCreateRequestSchema = auditionInquirySchema.extend({
  performanceId: z.uuid().nullable().optional(),
  scheduledTimeSlot: z.iso.datetime().nullable().optional(),
  status: auditionStatusSchema.default("pending"),
});

export type OrganizationAuditionCreateRequest = z.infer<
  typeof organizationAuditionCreateRequestSchema
>;

export const organizationAuditionUpdateRequestSchema = z.object({
  adminNotes: z.string().max(10_000).optional(),
  availabilityNotes: z.string().max(5_000).optional(),
  email: z.email().max(320).optional(),
  experience: z.string().max(5_000).optional(),
  name: z.string().min(1).max(200).optional(),
  performanceId: z.uuid().nullable().optional(),
  phone: z.string().max(50).optional(),
  requestedSlots: z.array(z.iso.datetime()).max(20).optional(),
  scheduledTimeSlot: z.iso.datetime().nullable().optional(),
  status: auditionStatusSchema.optional(),
  voicePart: z.string().max(100).optional(),
});

export type OrganizationAuditionUpdateRequest = z.infer<
  typeof organizationAuditionUpdateRequestSchema
>;
