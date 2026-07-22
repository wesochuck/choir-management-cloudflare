import { z } from "zod";

const deliverySchema = z.object({
  channel: z.enum(["email", "sms"]),
  contentMarkdown: z.string().max(100_000),
  deliveryId: z.uuid(),
  destination: z.string().min(1).max(320),
  messageId: z.uuid(),
  recipientName: z.string().min(1).max(200),
  subject: z.string().max(300),
});

export interface CommunicationProviderResult {
  readonly failureDetail: string;
  readonly providerMessageId: string | null;
  readonly status: "failed" | "sent" | "suppressed";
}

export function deliverOrganizationCommunication(
  mode: string,
  input: z.infer<typeof deliverySchema>,
): Promise<CommunicationProviderResult> {
  const delivery = deliverySchema.parse(input);
  if (mode === "fake") {
    return Promise.resolve({
      failureDetail: "",
      providerMessageId: `fake:${delivery.deliveryId}`,
      status: "sent",
    });
  }
  if (mode === "disabled") {
    return Promise.resolve({ failureDetail: "", providerMessageId: null, status: "suppressed" });
  }
  throw new Error("The Organization communications sandbox provider is not configured.");
}
