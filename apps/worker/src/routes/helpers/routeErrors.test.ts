import { describe, expect, it } from "vitest";

import { CommunicationRepositoryError } from "../../organization/organizationCommunications";
import { communicationProblem } from "./routeErrors";

describe("routeErrors communicationProblem", () => {
  it("maps typed promotion errors to actionable problem details", () => {
    const overflow = communicationProblem(
      new CommunicationRepositoryError("event_promotion_audience_exceeds_limit", 409),
      "req-1",
      "Fallback message",
    );
    expect(overflow.status).toBe(409);
    expect(overflow.problem).toMatchObject({
      code: "event_promotion_audience_exceeds_limit",
      message:
        "This audience exceeds the 500-recipient promotion limit. Narrow the source events or Contact filters.",
      requestId: "req-1",
    });

    const stale = communicationProblem(
      new CommunicationRepositoryError("event_promotion_review_stale", 409),
      "req-2",
      "Fallback message",
    );
    expect(stale.status).toBe(409);
    expect(stale.problem).toMatchObject({
      code: "event_promotion_review_stale",
      message:
        "The audience or message changed after review. Review the recipients again before sending.",
      requestId: "req-2",
    });

    const expired = communicationProblem(
      new CommunicationRepositoryError("event_promotion_review_expired", 409),
      "req-3",
      "Fallback message",
    );
    expect(expired.status).toBe(409);
    expect(expired.problem).toMatchObject({
      code: "event_promotion_review_expired",
      message: "The recipient review has expired. Review the recipients again before sending.",
      requestId: "req-3",
    });

    const conflict = communicationProblem(
      new CommunicationRepositoryError("communication_draft_revision_conflict", 409),
      "req-4",
      "Fallback message",
    );
    expect(conflict.status).toBe(409);
    expect(conflict.problem).toMatchObject({
      code: "communication_draft_revision_conflict",
      message:
        "This draft was modified in another session. Reload the draft to view current changes.",
      requestId: "req-4",
    });
  });

  it("uses the fallback message when the error code is unknown", () => {
    const unknownError = communicationProblem(
      new CommunicationRepositoryError("unknown_code", 400),
      "req-5",
      "Custom fallback message",
    );
    expect(unknownError.status).toBe(400);
    expect(unknownError.problem).toMatchObject({
      code: "unknown_code",
      message: "Custom fallback message",
      requestId: "req-5",
    });
  });
});
