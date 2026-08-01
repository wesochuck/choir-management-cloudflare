import { deliverOrganizationCommunication } from "../../communications/provider";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";
import { auditionNotificationJobSchema } from "./shared";

export async function deliverAuditionNotificationJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const objectStub = env.ORGANIZATION_STORE.get(
    env.ORGANIZATION_STORE.idFromName(job.organizationId),
  );
  const url = new URL("https://organization.internal/internal/audition/notification-job");
  url.searchParams.set("organizationId", job.organizationId);
  url.searchParams.set("jobId", job.jobId);
  const response = await objectStub.fetch(url);
  const notification = auditionNotificationJobSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!response.ok || !notification.success) {
    throw new Error("The audition notification job is unavailable.");
  }
  const result = await deliverOrganizationCommunication(env, {
    channel: "email",
    contentMarkdown: notification.data.contentMarkdown,
    deliveryId: notification.data.id,
    destination: notification.data.destination,
    messageId: notification.data.id,
    recipientName: notification.data.recipientName,
    subject: notification.data.subject,
    unsubscribeUrl: null,
  });
  const recordResponse = await objectStub.fetch(
    "https://organization.internal/internal/audition/notification-result",
    {
      body: JSON.stringify({
        failureDetail: result.failureDetail,
        jobId: job.jobId,
        organizationId: job.organizationId,
        providerMessageId: result.providerMessageId,
        status: result.status,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!recordResponse.ok) throw new Error("The audition notification result was rejected.");
}
