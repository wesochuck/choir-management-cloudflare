import { Hono } from "hono";
import { requestId } from "hono/request-id";
import type { ProblemDetails } from "@choir/contracts";
import type { WorkerHonoEnvironment } from "./routes/helpers";
import { boundJsonRequestBody, MAX_JSON_BODY_BYTES } from "./routes/helpers";
import { registerRoutes as registerPublicRoutes } from "./routes/public";
import { registerRoutes as registerPlatformSetupRoutes } from "./routes/platformSetup";
import { registerRoutes as registerPublicCommerceRoutes } from "./routes/publicCommerce";
import { registerRoutes as registerPublicDonationsRoutes } from "./routes/publicDonations";
import { registerRoutes as registerPublicTicketsRoutes } from "./routes/publicTickets";
import { registerRoutes as registerPublicRsvpPollsRoutes } from "./routes/publicRsvpPolls";
import { registerRoutes as registerPublicEngagementRoutes } from "./routes/publicEngagement";
import { registerRoutes as registerCalendarRoutes } from "./routes/calendar";
import { registerRoutes as registerSingerRoutes } from "./routes/singer";
import { registerRoutes as registerOrganizationFilesRoutes } from "./routes/organizationFiles";
import { registerRoutes as registerOrganizationProfilesRoutes } from "./routes/organizationProfiles";
import { registerRoutes as registerAuthRoutes } from "./routes/auth";
import { registerRoutes as registerOrganizationProfileRecordsRoutes } from "./routes/organizationProfileRecords";
import { registerRoutes as registerOrganizationMusicFolderReportRoutes } from "./routes/organizationMusicFolderReports";
import { registerRoutes as registerOrganizationExportRoutes } from "./routes/organizationExport";
import { registerRoutes as registerOrganizationProfileMutationsRoutes } from "./routes/organizationProfileMutations";
import { registerRoutes as registerSingerBillingRoutes } from "./routes/singerBilling";
import { registerRoutes as registerOrganizationProfilePhotosRoutes } from "./routes/organizationProfilePhotos";
import { registerRoutes as registerOrganizationProfileDeliveriesRoutes } from "./routes/organizationProfileDeliveries";
import { registerRoutes as registerSingerDirectoryRoutes } from "./routes/singerDirectory";
import { registerRoutes as registerOrganizationWebsiteRoutes } from "./routes/organizationWebsite";
import { registerRoutes as registerOrganizationTicketingRoutes } from "./routes/organizationTicketing";
import { registerRoutes as registerOrganizationDonationsRoutes } from "./routes/organizationDonations";
import { registerRoutes as registerOrganizationCommerceSettingsRoutes } from "./routes/organizationCommerceSettings";
import { registerRoutes as registerOrganizationPatronsRoutes } from "./routes/organizationPatrons";
import { registerRoutes as registerOrganizationSeasonsRoutes } from "./routes/organizationSeasons";
import { registerRoutes as registerOrganizationDonationRefundsRoutes } from "./routes/organizationDonationRefunds";
import { registerRoutes as registerOrganizationTicketingOrdersRoutes } from "./routes/organizationTicketingOrders";
import { registerRoutes as registerOrganizationResourcesRoutes } from "./routes/organizationResources";
import { registerRoutes as registerOrganizationCommunicationsRoutes } from "./routes/organizationCommunications";
import { registerRoutes as registerOrganizationMusicCatalogRoutes } from "./routes/organizationMusicCatalog";
import { registerRoutes as registerSingerMusicRoutes } from "./routes/singerMusic";
import { registerRoutes as registerOrganizationMusicMutationsRoutes } from "./routes/organizationMusicMutations";
import { registerRoutes as registerSingerEventsRoutes } from "./routes/singerEvents";
import { registerRoutes as registerOrganizationEventsRoutes } from "./routes/organizationEvents";
import { registerRoutes as registerOrganizationPaymentSettingsRoutes } from "./routes/organizationPaymentSettings";
import { registerRoutes as registerOrganizationCalendarSettingsRoutes } from "./routes/organizationCalendarSettings";
import { registerRoutes as registerOrganizationRosterSettingsRoutes } from "./routes/organizationRosterSettings";
import { registerRoutes as registerOrganizationSeatingRoutes } from "./routes/organizationSeating";
import { registerRoutes as registerOrganizationEventSeatingRoutes } from "./routes/organizationEventSeating";
import { registerRoutes as registerSingerSeatingRoutes } from "./routes/singerSeating";
import { registerRoutes as registerOrganizationEventCatalogRoutes } from "./routes/organizationEventCatalog";
import { registerRoutes as registerOrganizationDashboardRoutes } from "./routes/organizationDashboard";
import { registerRoutes as registerOrganizationEventManagementRoutes } from "./routes/organizationEventManagement";
import { registerRoutes as registerOrganizationTokensRoutes } from "./routes/organizationTokens";
import { registerRoutes as registerOrganizationAuditionsRoutes } from "./routes/organizationAuditions";
import { registerRoutes as registerOrganizationAuditionLifecycleRoutes } from "./routes/organizationAuditionLifecycle";
import { registerRoutes as registerOrganizationRsvpExportsRoutes } from "./routes/organizationRsvpExports";
import { registerRoutes as registerOrganizationPollsRoutes } from "./routes/organizationPolls";
import { registerRoutes as registerOrganizationEventAttendanceRoutes } from "./routes/organizationEventAttendance";
import { registerRoutes as registerOrganizationInvitationsRoutes } from "./routes/organizationInvitations";
import { registerRoutes as registerOrganizationAccessRoutes } from "./routes/organizationAccess";
import { registerRoutes as registerOrganizationDomainsRoutes } from "./routes/organizationDomains";
import { registerRoutes as registerPlatformAdministrationRoutes } from "./routes/platformAdministration";
import { registerRoutes as registerPlatformEmailSuppressionRoutes } from "./routes/platformEmailSuppressions";
import { registerRoutes as registerPlatformEmailFeedbackRoutes } from "./routes/platformEmailFeedback";
import { registerRoutes as registerPlatformOperationsRoutes } from "./routes/platformOperations";
import { registerRoutes as registerSingerDashboardRoutes } from "./routes/singerDashboard";
import { registerRoutes as registerSetupRoutes } from "./routes/setup";
import { registerRoutes as registerOrganizationModulesRoutes } from "./routes/organizationModules";
import { registerRoutes as registerSetupRecoveryRoutes } from "./routes/setupRecovery";
import { registerRoutes as registerPlatformMaintenanceRoutes } from "./routes/platformMaintenance";
import { registerRoutes as registerPaymentsRoutes } from "./routes/payments";
import { registerRoutes as registerMemberEmailChangeRoutes } from "./routes/memberEmailChange";

export const router = new Hono<WorkerHonoEnvironment>();

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'";

export function setSecurityHeaders(
  headers: Headers,
  referrerPolicy = "strict-origin-when-cross-origin",
): void {
  headers.set("referrer-policy", referrerPolicy);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
}

router.use("*", requestId());
router.use("*", async (context, next) => {
  const method = context.req.method.toUpperCase();
  const cookie = context.req.header("cookie") ?? "";
  const authorization = context.req.header("authorization") ?? "";
  const hasSessionCookie = /(?:^|;\s*)(?:__Secure-)?choir-management\.session_token=/.test(cookie);
  const isBearerClient = /^Bearer\s+/i.test(authorization);
  const path = new URL(context.req.url).pathname;
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    hasSessionCookie &&
    !isBearerClient &&
    !path.startsWith("/api/auth/")
  ) {
    const origin = context.req.header("origin");
    if (origin !== new URL(context.req.url).origin) {
      return context.json(
        {
          code: "csrf_origin_mismatch",
          message: "This request must originate from the current application origin.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        403,
      );
    }
  }
  await next();
});
router.use("*", async (context, next) => {
  if (context.req.method === "OPTIONS") {
    context.res.headers.set(
      "access-control-allow-origin",
      context.env.PRODUCT_BASE_DOMAIN === "localhost"
        ? "*"
        : `https://${context.env.PRODUCT_BASE_DOMAIN}`,
    );
    context.res.headers.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
    context.res.headers.set("access-control-allow-headers", "Content-Type, Authorization");
    context.res.headers.set("access-control-allow-credentials", "true");
    context.res.headers.set("access-control-max-age", "86400");
    return context.body(null, 204);
  }
  await next();
});
router.use("*", async (context, next) => {
  await next();
  const responsePath = new URL(context.req.url).pathname;
  const publicProjectionResponse =
    responsePath === "/api/public/projection" &&
    (context.res.status === 200 || context.res.status === 304);
  const publicMediaResponse =
    responsePath.startsWith("/api/public/media/") &&
    (context.res.status === 200 || context.res.status === 304);
  const routeCacheControl = context.res.headers.get("cache-control");
  context.header(
    "cache-control",
    publicProjectionResponse
      ? "public, max-age=60, stale-while-revalidate=300"
      : publicMediaResponse
        ? "public, max-age=31536000, immutable"
        : (routeCacheControl ?? "no-store"),
  );
  setSecurityHeaders(
    context.res.headers,
    responsePath === "/api/calendar/feed" || responsePath === "/api/public/unsubscribe"
      ? "no-referrer"
      : "strict-origin-when-cross-origin",
  );
  context.res.headers.set(
    "access-control-allow-origin",
    context.env.PRODUCT_BASE_DOMAIN === "localhost"
      ? "*"
      : `https://${context.env.PRODUCT_BASE_DOMAIN}`,
  );
  context.res.headers.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  context.res.headers.set("access-control-allow-headers", "Content-Type, Authorization");
  context.res.headers.set("access-control-allow-credentials", "true");
  context.res.headers.set("access-control-max-age", "86400");
});
router.use("*", async (context, next) => {
  if (!(await boundJsonRequestBody(context))) {
    return context.json(
      {
        code: "request_body_too_large",
        message: `JSON request bodies must be ${String(MAX_JSON_BODY_BYTES)} bytes or smaller.`,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      413,
    );
  }
  await next();
});

registerPublicRoutes(router);
registerPlatformSetupRoutes(router);
registerPublicCommerceRoutes(router);
registerPublicDonationsRoutes(router);
registerPublicTicketsRoutes(router);
registerPublicRsvpPollsRoutes(router);
registerPublicEngagementRoutes(router);
registerCalendarRoutes(router);
registerSingerRoutes(router);
registerOrganizationFilesRoutes(router);
registerOrganizationProfilesRoutes(router);
registerAuthRoutes(router);
registerOrganizationProfileRecordsRoutes(router);
registerOrganizationMusicFolderReportRoutes(router);
registerOrganizationExportRoutes(router);
registerOrganizationProfileMutationsRoutes(router);
registerSingerBillingRoutes(router);
registerOrganizationProfilePhotosRoutes(router);
registerOrganizationProfileDeliveriesRoutes(router);
registerSingerDirectoryRoutes(router);
registerOrganizationWebsiteRoutes(router);
registerOrganizationTicketingRoutes(router);
registerOrganizationDonationsRoutes(router);
registerOrganizationCommerceSettingsRoutes(router);
registerOrganizationPatronsRoutes(router);
registerOrganizationSeasonsRoutes(router);
registerOrganizationDonationRefundsRoutes(router);
registerOrganizationTicketingOrdersRoutes(router);
registerOrganizationResourcesRoutes(router);
registerOrganizationCommunicationsRoutes(router);
registerOrganizationMusicCatalogRoutes(router);
registerSingerMusicRoutes(router);
registerOrganizationMusicMutationsRoutes(router);
registerSingerEventsRoutes(router);
registerOrganizationEventsRoutes(router);
registerOrganizationPaymentSettingsRoutes(router);
registerOrganizationCalendarSettingsRoutes(router);
registerOrganizationRosterSettingsRoutes(router);
registerOrganizationSeatingRoutes(router);
registerOrganizationEventSeatingRoutes(router);
registerSingerSeatingRoutes(router);
registerOrganizationEventCatalogRoutes(router);
registerOrganizationDashboardRoutes(router);
registerOrganizationEventManagementRoutes(router);
registerOrganizationTokensRoutes(router);
registerOrganizationAuditionsRoutes(router);
registerOrganizationAuditionLifecycleRoutes(router);
registerOrganizationRsvpExportsRoutes(router);
registerOrganizationPollsRoutes(router);
registerOrganizationEventAttendanceRoutes(router);
registerOrganizationInvitationsRoutes(router);
registerOrganizationAccessRoutes(router);
registerOrganizationDomainsRoutes(router);
registerPlatformAdministrationRoutes(router);
registerPlatformEmailSuppressionRoutes(router);
registerPlatformEmailFeedbackRoutes(router);
registerPlatformOperationsRoutes(router);
registerSingerDashboardRoutes(router);
registerSetupRoutes(router);
registerOrganizationModulesRoutes(router);
registerSetupRecoveryRoutes(router);
registerPlatformMaintenanceRoutes(router);
registerPaymentsRoutes(router);
registerMemberEmailChangeRoutes(router);

router.notFound((context) => {
  const problem: ProblemDetails = {
    code: "not_found",
    message: "The requested API route was not found.",
    requestId: context.get("requestId"),
  };
  return context.json(problem, 404);
});
