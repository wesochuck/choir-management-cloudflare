import type { ProblemDetails } from "@choir/contracts";
import { MusicCsvError } from "@choir/domain";
import { z } from "zod";

import { EmailRecipientSuppressedError } from "../../communications/emailFeedback";
import { CommunicationRepositoryError } from "../../organization/organizationCommunications";
import { MusicRepositoryError } from "../../organization/organizationMusic";

export function communicationProblem(error: unknown, requestIdValue: string, message: string) {
  console.error(
    JSON.stringify({
      event: "communication_route_error",
      error: error instanceof Error ? error.message : String(error),
      requestId: requestIdValue,
    }),
  );
  const suppression = error instanceof EmailRecipientSuppressedError;
  const ticketAudienceLimit =
    error instanceof CommunicationRepositoryError &&
    error.code === "ticket_service_audience_exceeds_limit";
  const status = suppression
    ? error.status
    : error instanceof CommunicationRepositoryError
      ? error.status
      : 503;
  return {
    problem: {
      code: suppression
        ? error.code
        : error instanceof CommunicationRepositoryError
          ? error.code
          : "service_unavailable",
      message: suppression
        ? error.message
        : ticketAudienceLimit
          ? "This performance has more than 1,000 paid ticket orders, so its complete ticket-holder audience exceeds the message limit. No message was sent."
          : message,
      requestId: requestIdValue,
    } satisfies ProblemDetails,
    status,
  };
}

export function musicImportProblem(
  error: unknown,
  requestIdValue: string,
): { readonly problem: ProblemDetails; readonly status: 400 | 404 | 409 | 500 | 503 } {
  if (error instanceof MusicRepositoryError) {
    return {
      problem: {
        code: error.code,
        message: "The music catalog import could not be completed.",
        requestId: requestIdValue,
      },
      status: error.status,
    };
  }
  if (error instanceof MusicCsvError) {
    const row = error.row === null ? "" : ` (row ${String(error.row)})`;
    return {
      problem: {
        code: "validation_failed",
        message: `${error.message}${row}`,
        requestId: requestIdValue,
      },
      status: 400,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      problem: {
        code: "validation_failed",
        message: "The music CSV contains invalid values.",
        requestId: requestIdValue,
      },
      status: 400,
    };
  }
  return {
    problem: {
      code: "service_unavailable",
      message: "The music catalog import could not be completed.",
      requestId: requestIdValue,
    },
    status: 503,
  };
}
