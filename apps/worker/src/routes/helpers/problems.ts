import type { ProblemDetails } from "@choir/contracts";

import { PublicWebsiteError } from "../../organization/organizationPublicWebsite";
import { ResourceRepositoryError } from "../../organization/organizationResources";

export function resourceProblem(error: unknown, requestIdValue: string, message: string) {
  const status = error instanceof ResourceRepositoryError ? error.status : 503;
  return {
    problem: {
      code: error instanceof ResourceRepositoryError ? error.code : "service_unavailable",
      message,
      requestId: requestIdValue,
    } satisfies ProblemDetails,
    status,
  };
}

export function publicWebsiteProblem(error: unknown, requestIdValue: string, message: string) {
  return {
    problem: {
      code: error instanceof PublicWebsiteError ? "public_website_error" : "service_unavailable",
      message: error instanceof PublicWebsiteError ? error.message : message,
      requestId: requestIdValue,
    } satisfies ProblemDetails,
    status: error instanceof PublicWebsiteError ? error.status : 503,
  };
}
