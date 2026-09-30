import { describe, expect, it } from "vitest";

import { renderCommunicationMarkdown } from "../communications/provider";
import { verifySignedLink } from "../security/signedLinks";
import {
  MAX_CONCURRENT_ORGANIZATION_LANES,
  processDeliveryBatch,
  renderPlayerLinks,
  renderRsvpLinks,
} from "./consumer";
import type { OrganizationStore } from "../organization/OrganizationStore";
import type { OrganizationRpcCall } from "../organization/rpc/types";
import {
  deliveryOrigin,
  type JobConsumerEnv,
  renderPollLinks,
  renderTicketLinks,
  resolveCanonicalOrigin,
} from "./deliveries/shared";

const secret = "unit-test-rsvp-link-secret-that-is-at-least-thirty-two-characters";

describe("communication RSVP links", () => {
  it("renders a personalized no-login link scoped to the event and profile", async () => {
    const content = await renderRsvpLinks(
      { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
      "organization-alpha",
      "Please respond here: {{RSVP_LINKS}}",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      {
        profileId: "11111111-1111-4111-8111-111111111111",
        unsubscribeUrl: "https://alpha.staging.example.test/unsubscribe?token=test",
      },
    );
    const link = /https:\/\/alpha\.staging\.example\.test\/rsvp\?token=([^\s)]+)/.exec(
      content,
    )?.[1];
    expect(link).toBeTruthy();
    expect(content).toContain("No login required");
    await expect(
      verifySignedLink(secret, decodeURIComponent(link ?? ""), {
        expectedOrganizationId: "organization-alpha",
        expectedPurpose: "rsvp",
        expectedResourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expectedSubjectId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toMatchObject({
      organizationId: "organization-alpha",
      purpose: "rsvp",
      resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      subjectId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("explains when an RSVP placeholder is used without an event", async () => {
    await expect(
      renderRsvpLinks(
        { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
        "organization-alpha",
        "{{RSVP_LINKS}}",
        null,
        { profileId: "11111111-1111-4111-8111-111111111111", unsubscribeUrl: null },
      ),
    ).resolves.toBe("RSVP link unavailable; select an event before sending this message.");
  });
});

describe("communication practice-player links", () => {
  it("renders a personalized no-login link scoped to the event and profile", async () => {
    const content = await renderPlayerLinks(
      { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
      "organization-alpha",
      "Practice here: {{PLAYER_LINK}}",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      {
        profileId: "11111111-1111-4111-8111-111111111111",
        unsubscribeUrl: "https://alpha.staging.example.test/unsubscribe?token=test",
      },
    );
    const link = /https:\/\/alpha\.staging\.example\.test\/player\?token=([^\s)]+)/.exec(
      content,
    )?.[1];
    expect(link).toBeTruthy();
    expect(content).toContain("No login required");
    await expect(
      verifySignedLink(secret, decodeURIComponent(link ?? ""), {
        expectedOrganizationId: "organization-alpha",
        expectedPurpose: "player",
        expectedResourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expectedSubjectId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toMatchObject({
      organizationId: "organization-alpha",
      purpose: "player",
      resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      subjectId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("explains when a practice-player placeholder is used without an event", async () => {
    await expect(
      renderPlayerLinks(
        { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
        "organization-alpha",
        "{{PLAYER_LINK}}",
        null,
        { profileId: "11111111-1111-4111-8111-111111111111", unsubscribeUrl: null },
      ),
    ).resolves.toBe("Practice player unavailable; select an event before sending this message.");
  });
});

describe("communication poll links", () => {
  it("renders a personalized no-login call to action with an exact signed URL", async () => {
    const content = await renderPollLinks(
      { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
      "organization-alpha",
      "Poll: Favorite color?\n\n{{POLL_LINK:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa}}",
      {
        profileId: "11111111-1111-4111-8111-111111111111",
        unsubscribeUrl: "https://alpha.staging.example.test/unsubscribe?token=test",
      },
    );
    const link = /\[Respond Here \(No login required\)\]\((https:\/\/[^)]+)\)/.exec(content)?.[1];
    expect(link).toBeTruthy();
    expect(content).toContain("Poll: Favorite color?");
    expect(content).not.toMatch(/^https?:\/\//m);
    const rendered = renderCommunicationMarkdown(content);
    expect(rendered).toContain(`href="${link ?? ""}"`);
    expect(rendered).toContain(">Respond Here (No login required)</a>");
    expect(rendered).toContain('role="presentation"');

    const token = new URL(link ?? "https://invalid.test").searchParams.get("token");
    await expect(
      verifySignedLink(secret, token ?? "", {
        expectedOrganizationId: "organization-alpha",
        expectedPurpose: "poll",
        expectedResourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expectedSubjectId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toMatchObject({
      organizationId: "organization-alpha",
      purpose: "poll",
      resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      subjectId: "11111111-1111-4111-8111-111111111111",
    });
  });
});

describe("ticket order links", () => {
  it("uses a refund-safe order-details label while preserving the ticket link label", async () => {
    const content = await renderTicketLinks(
      { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
      "organization-alpha",
      "{{TICKET_ORDER_LINK}}\n\n{{TICKET_LINK}}",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "2026-10-01T20:00:00Z",
    );

    const [refundAction, confirmationAction] = content.split("\n\n");
    expect(refundAction).toMatch(
      /^\[View order details\]\(https:\/\/staging\.example\.test\/tickets\/order\/success\?token=/,
    );
    expect(refundAction).not.toContain("View ticket / QR code");
    expect(confirmationAction).toContain(
      "[View ticket / QR code](https://staging.example.test/tickets/order/success?token=",
    );
    const token = new URL(
      /\((https:\/\/[^)]+)\)/.exec(refundAction ?? "")?.[1] ?? "https://invalid.test",
    ).searchParams.get("token");
    await expect(
      verifySignedLink(secret, token ?? "", {
        expectedOrganizationId: "organization-alpha",
        expectedPurpose: "ticket_receipt",
        expectedResourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).resolves.toMatchObject({
      organizationId: "organization-alpha",
      purpose: "ticket_receipt",
      resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    const refundUsingLegacyPlaceholder = await renderTicketLinks(
      { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
      "organization-alpha",
      "{{TICKET_LINK}}",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "2026-10-01T20:00:00Z",
      true,
    );
    expect(refundUsingLegacyPlaceholder).toContain("[View order details](");
    expect(refundUsingLegacyPlaceholder).not.toContain("View ticket / QR code");
  });
});

describe("canonical origin resolution and link render query deduplication", () => {
  function createMockControlDb(hostnames: Record<string, string>): {
    readonly db: NonNullable<JobConsumerEnv["CONTROL_DB"]>;
    getQueryCount: () => number;
  } {
    let queryCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    const db = {
      prepare: () => {
        queryCount += 1;
        return {
          bind: (organizationId: string) => ({
            first: <T>() => {
              const hostname = hostnames[organizationId];
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
              return Promise.resolve((hostname ? { hostname } : null) as T);
            },
          }),
        };
      },
    } as unknown as NonNullable<JobConsumerEnv["CONTROL_DB"]>;

    return {
      db,
      getQueryCount: () => queryCount,
    };
  }

  it("resolves canonical active domain from CONTROL_DB", async () => {
    const { db, getQueryCount } = createMockControlDb({
      "org-1": "singers.org-1.com",
    });

    const origin = await resolveCanonicalOrigin({ CONTROL_DB: db }, "org-1");
    expect(origin).toBe("https://singers.org-1.com");
    expect(getQueryCount()).toBe(1);

    const missingOrigin = await resolveCanonicalOrigin({ CONTROL_DB: db }, "org-none");
    expect(missingOrigin).toBeNull();
    expect(getQueryCount()).toBe(2);

    const noDbOrigin = await resolveCanonicalOrigin({}, "org-1");
    expect(noDbOrigin).toBeNull();
  });

  it("preserves fallback to recipient unsubscribeUrl when canonicalOrigin is null", async () => {
    const { db, getQueryCount } = createMockControlDb({});
    const env = {
      CONTROL_DB: db,
      PRODUCT_BASE_DOMAIN: "base.example.test",
    };

    // Passing canonicalOrigin = null explicitly avoids D1 queries and falls back to recipient unsubscribeUrl
    const origin = await deliveryOrigin(
      env,
      "org-without-domain",
      { unsubscribeUrl: "https://recipient-specific.example.test/unsub?t=1" },
      null,
    );
    expect(origin).toBe("https://recipient-specific.example.test");
    expect(getQueryCount()).toBe(0);

    // When unsubscribeUrl is also null, falls back to PRODUCT_BASE_DOMAIN
    const baseOrigin = await deliveryOrigin(
      env,
      "org-without-domain",
      { unsubscribeUrl: null },
      null,
    );
    expect(baseOrigin).toBe("https://base.example.test");
    expect(getQueryCount()).toBe(0);
  });

  it("reuses resolved canonicalOrigin across all recipients and link renderers with exactly one D1 query", async () => {
    const { db, getQueryCount } = createMockControlDb({
      "org-alpha": "choir.alpha.org",
    });
    const env = {
      CONTROL_DB: db,
      PRODUCT_BASE_DOMAIN: "staging.example.test",
      SIGNED_LINK_SECRET: secret,
    };

    // Resolve canonical origin once at the job boundary
    const canonicalOrigin = await resolveCanonicalOrigin(env, "org-alpha");
    expect(canonicalOrigin).toBe("https://choir.alpha.org");
    expect(getQueryCount()).toBe(1);

    const recipients = [
      {
        profileId: "11111111-1111-4111-8111-111111111111",
        unsubscribeUrl: "https://fallback.test/u1",
      },
      {
        profileId: "22222222-2222-4222-8222-222222222222",
        unsubscribeUrl: "https://fallback.test/u2",
      },
      {
        profileId: "33333333-3333-4333-8333-333333333333",
        unsubscribeUrl: "https://fallback.test/u3",
      },
    ];

    const template =
      "Hello!\n\nRSVP: {{RSVP_LINKS}}\n\nPlayer: {{PLAYER_LINK}}\n\nPoll: {{POLL_LINK:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb}}";

    for (const recipient of recipients) {
      let content = await renderRsvpLinks(
        env,
        "org-alpha",
        template,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        recipient,
        canonicalOrigin,
      );
      content = await renderPlayerLinks(
        env,
        "org-alpha",
        content,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        recipient,
        canonicalOrigin,
      );
      content = await renderPollLinks(env, "org-alpha", content, recipient, canonicalOrigin);

      expect(content).toContain("https://choir.alpha.org/rsvp?token=");
      expect(content).toContain("https://choir.alpha.org/player?token=");
      expect(content).toContain("https://choir.alpha.org/poll?token=");
    }

    // Crucial assertion: despite 3 recipients * 3 link types = 9 link renderings,
    // the query count remains 1 because canonicalOrigin was reused!
    expect(getQueryCount()).toBe(1);
  });

  it("isolates canonical origins when two organizations are processed in succession", async () => {
    const { db, getQueryCount } = createMockControlDb({
      "org-1": "org1.com",
      "org-2": "org2.com",
    });
    const env = {
      CONTROL_DB: db,
      PRODUCT_BASE_DOMAIN: "staging.example.test",
      SIGNED_LINK_SECRET: secret,
    };

    const origin1 = await resolveCanonicalOrigin(env, "org-1");
    const origin2 = await resolveCanonicalOrigin(env, "org-2");
    expect(origin1).toBe("https://org1.com");
    expect(origin2).toBe("https://org2.com");
    expect(getQueryCount()).toBe(2);

    const rsvp1 = await renderRsvpLinks(
      env,
      "org-1",
      "{{RSVP_LINKS}}",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { profileId: "11111111-1111-4111-8111-111111111111", unsubscribeUrl: null },
      origin1,
    );
    const rsvp2 = await renderRsvpLinks(
      env,
      "org-2",
      "{{RSVP_LINKS}}",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { profileId: "22222222-2222-4222-8222-222222222222", unsubscribeUrl: null },
      origin2,
    );

    expect(rsvp1).toContain("https://org1.com/rsvp?token=");
    expect(rsvp2).toContain("https://org2.com/rsvp?token=");
    expect(getQueryCount()).toBe(2);
  });
});

interface MockMessageItem {
  readonly attempts: number;
  readonly body: unknown;
  readonly id: string;
  readonly timestamp: Date;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
}

function createMockQueueMessage(
  id: string,
  body: unknown,
  onAck?: () => void,
  onRetry?: () => void,
): MockMessageItem {
  return {
    ack: () => {
      onAck?.();
    },
    attempts: 1,
    body,
    id,
    retry: () => {
      onRetry?.();
    },
    timestamp: new Date("2026-07-21T12:00:00.000Z"),
  };
}

function createMockConsumerEnv(
  onJobRpc?: (orgId: string, operation: string, body: unknown) => Promise<void> | void,
): JobConsumerEnv {
  return {
    EXTERNAL_EFFECTS_MODE: "fake",
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- mock bucket
    ORGANIZATION_FILES: {} as unknown as R2Bucket,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- mock store namespace
    ORGANIZATION_STORE: {
      getByName(orgId: string) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- mock store stub
        return {
          async jobRpc(call: OrganizationRpcCall) {
            const isClaim =
              call.path === "/internal/jobs/claim" || call.operation.includes("claim");
            const isComplete =
              call.path === "/internal/jobs/complete" || call.operation.includes("complete");
            if (onJobRpc) {
              await onJobRpc(
                orgId,
                isClaim ? "claim" : isComplete ? "complete" : call.operation,
                call.body,
              );
            }
            if (isClaim) {
              return {
                headers: {},
                ok: true,
                status: 200,
                value: { claimed: true, status: "claimed" },
              };
            }
            if (isComplete) {
              return {
                headers: {},
                ok: true,
                status: 200,
                value: { completed: true },
              };
            }
            return {
              headers: {},
              ok: true,
              status: 200,
              value: {},
            };
          },
        } as unknown as DurableObjectStub<OrganizationStore>;
      },
    } as unknown as NonNullable<JobConsumerEnv["ORGANIZATION_STORE"]>,
    PRODUCT_BASE_DOMAIN: "staging.example.test",
    SIGNED_LINK_SECRET: secret,
  };
}

function createAttendanceJobBody(orgId: string, jobId: string) {
  return {
    attempt: 1,
    idempotencyKey: `attendance-report:${jobId}:2026-07-21`,
    jobId,
    kind: "attendance_report" as const,
    organizationId: orgId,
    version: 1,
  };
}

describe("processDeliveryBatch lane concurrency", () => {
  it("progresses independent organization B while organization A waits on a slow job", async () => {
    let resolveGateA: () => void = () => {
      /* gate init */
    };
    const gateA = new Promise<void>((resolve) => {
      resolveGateA = resolve;
    });

    const completionEvents: string[] = [];
    let b1Acked = false;
    let a1Acked = false;
    let a2Acked = false;

    const jobA1Id = "11111111-1111-4111-8111-111111111111";
    const jobA2Id = "22222222-2222-4222-8222-222222222222";
    const jobB1Id = "33333333-3333-4333-8333-333333333333";

    const env = createMockConsumerEnv(async (orgId, operation, body) => {
      let jobId: string | undefined;
      if (
        typeof body === "object" &&
        body !== null &&
        "jobId" in body &&
        typeof body.jobId === "string"
      ) {
        jobId = body.jobId;
      }
      if (orgId === "organization-alpha" && jobId === jobA1Id && operation === "claim") {
        await gateA;
      }
      if (operation === "complete") {
        completionEvents.push(`${orgId}:${jobId ?? "unknown"}`);
      }
    });

    const msgA1 = createMockQueueMessage(
      "m-a1",
      createAttendanceJobBody("organization-alpha", jobA1Id),
      () => {
        a1Acked = true;
      },
    );
    const msgB1 = createMockQueueMessage(
      "m-b1",
      createAttendanceJobBody("organization-bravo", jobB1Id),
      () => {
        b1Acked = true;
      },
    );
    const msgA2 = createMockQueueMessage(
      "m-a2",
      createAttendanceJobBody("organization-alpha", jobA2Id),
      () => {
        a2Acked = true;
      },
    );

    // Batch contains interleaved messages: [A1, B1, A2]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- mock batch
    const batch = {
      messages: [msgA1, msgB1, msgA2],
      queue: "test-queue",
    } as unknown as MessageBatch;

    const batchPromise = processDeliveryBatch(batch, env);

    // Yield macro-task / micro-tasks so concurrent lanes get scheduled
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Organization B must have completed and acked even while Org A is blocked on gateA!
    expect(b1Acked).toBe(true);
    expect(a1Acked).toBe(false);
    expect(a2Acked).toBe(false);
    expect(completionEvents).toContain(`organization-bravo:${jobB1Id}`);

    // Release Organization A's slow job
    resolveGateA();
    await batchPromise;

    expect(a1Acked).toBe(true);
    expect(a2Acked).toBe(true);
    // Within Org A, job A1 must complete before job A2
    const a1Index = completionEvents.indexOf(`organization-alpha:${jobA1Id}`);
    const a2Index = completionEvents.indexOf(`organization-alpha:${jobA2Id}`);
    expect(a1Index).toBeGreaterThanOrEqual(0);
    expect(a2Index).toBeGreaterThan(a1Index);
  });

  it("bounds active concurrency to at most 3 lanes across multiple organizations", async () => {
    const activeLanes = new Set<string>();
    let peakLanes = 0;
    let releaseBarrier: () => void = () => {
      /* barrier init */
    };
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    const orgIds = [
      "organization-alpha",
      "organization-bravo",
      "organization-charlie",
      "organization-delta",
      "organization-echo",
    ];

    const env = createMockConsumerEnv(async (orgId, operation) => {
      if (operation === "claim") {
        activeLanes.add(orgId);
        peakLanes = Math.max(peakLanes, activeLanes.size);
        if (activeLanes.size === 3) {
          // Once 3 lanes are active, release all workers so they can complete
          releaseBarrier();
        } else if (activeLanes.size < 3) {
          await barrier;
        }
      }
      if (operation === "complete") {
        activeLanes.delete(orgId);
      }
    });

    const acks: string[] = [];
    const jobIds = [
      "11111111-1111-4111-8111-111111111101",
      "11111111-1111-4111-8111-111111111102",
      "11111111-1111-4111-8111-111111111103",
      "11111111-1111-4111-8111-111111111104",
      "11111111-1111-4111-8111-111111111105",
    ];
    const messages = orgIds.map((orgId, idx) =>
      createMockQueueMessage(
        `m-${String(idx)}`,
        createAttendanceJobBody(orgId, jobIds[idx] ?? "11111111-1111-4111-8111-111111111199"),
        () => {
          acks.push(orgId);
        },
      ),
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- mock batch
    const batch = { messages, queue: "test-queue" } as unknown as MessageBatch;
    await processDeliveryBatch(batch, env);

    expect(peakLanes).toBe(MAX_CONCURRENT_ORGANIZATION_LANES);
    expect(peakLanes).toBeLessThanOrEqual(3);
    expect(acks).toHaveLength(5);
  });

  it("handles malformed message bodies without crashing or creating unbounded lanes", async () => {
    let invalidAcked = false;
    let validAcked = false;

    const invalidMsg = createMockQueueMessage("m-invalid", { notAJob: true }, () => {
      invalidAcked = true;
    });
    const validMsg = createMockQueueMessage(
      "m-valid",
      createAttendanceJobBody("organization-alpha", "44444444-4444-4444-8444-444444444444"),
      () => {
        validAcked = true;
      },
    );

    const env = createMockConsumerEnv();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- mock batch
    const batch = {
      messages: [invalidMsg, validMsg],
      queue: "test-queue",
    } as unknown as MessageBatch;
    await processDeliveryBatch(batch, env);

    expect(invalidAcked).toBe(true);
    expect(validAcked).toBe(true);
  });

  it("handles an empty message batch cleanly", async () => {
    const env = createMockConsumerEnv();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- mock batch
    const batch = { messages: [], queue: "test-queue" } as unknown as MessageBatch;
    await expect(processDeliveryBatch(batch, env)).resolves.toBeUndefined();
  });

  it("isolates lane failures so a failure in one organization does not block or abandon others", async () => {
    let orgAFailed = false;
    let orgBCompleted = false;

    const env = createMockConsumerEnv((orgId, operation) => {
      if (orgId === "organization-failing" && operation === "claim") {
        throw new Error("Simulated DO crash in org-failing");
      }
    });

    const msgFail = createMockQueueMessage(
      "m-fail",
      createAttendanceJobBody("organization-failing", "55555555-5555-4555-8555-555555555555"),
      () => {
        /* no-op ack */
      },
      () => {
        orgAFailed = true;
      },
    );
    const msgSuccess = createMockQueueMessage(
      "m-success",
      createAttendanceJobBody("organization-alpha", "66666666-6666-4666-8666-666666666666"),
      () => {
        orgBCompleted = true;
      },
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- mock batch
    const batch = {
      messages: [msgFail, msgSuccess],
      queue: "test-queue",
    } as unknown as MessageBatch;
    await processDeliveryBatch(batch, env);

    expect(orgAFailed).toBe(true);
    expect(orgBCompleted).toBe(true);
  });
});
