import { archiveEvent, cancelEvent } from "./calendarManagementStore/eventLifecycle";
import { identityMatches } from "./calendarManagementStore/shared";
import { updateTimezone, writeEvent, writeVenue } from "./calendarManagementStore/mutations";
import { updateAttendance } from "./calendarManagementStore/attendance";
import { updateRosterConfiguration } from "./calendarManagementStore/roster";
import { updateProfileFolderNumber } from "./calendarManagementStore/folders";
import {
  managementRequestSchema,
  type ManagementRequest,
} from "./calendarManagementStore/contracts";
import { updateEventRsvp } from "./calendarManagementStore/rsvp";

export {
  readOrganizationCalendarSettingsFromStore,
  readOrganizationDashboardSummaryFromStore,
  listOrganizationEventsFromStore,
  listOrganizationVenuesFromStore,
  readEventRsvpExportFromStore,
  readProfileEventRsvpFromStore,
  readRosterConfigurationFromStore,
} from "./calendarManagementStore/queries";

export { listProfileFolderNumbersFromStore } from "./calendarManagementStore/folders";
export {
  listEventAttendanceFromStore,
  listEventRsvpHistoryFromStore,
} from "./calendarManagementStore/attendance";
export {
  listMemberEventsFromStore,
  listProfilePerformanceHistoryFromStore,
} from "./calendarManagementStore/memberEvents";

function dispatchCalendarMutation(
  storage: DurableObjectStorage,
  operation: ManagementRequest,
  occurredAt: string,
): Response {
  switch (operation.action) {
    case "bulk_attendance":
      return updateAttendance(storage, operation, occurredAt);
    case "update_profile_folder_number":
      return updateProfileFolderNumber(storage, operation, occurredAt);
    case "update_roster_configuration":
      return updateRosterConfiguration(storage, operation, occurredAt);
    case "update_timezone":
      return updateTimezone(storage, operation, occurredAt);
    case "create_venue":
    case "update_venue":
    case "delete_venue":
      return writeVenue(storage, operation, occurredAt);
    case "create_event":
    case "update_event":
      return writeEvent(storage, operation, occurredAt);
    case "archive_event":
      return archiveEvent(storage, operation, occurredAt);
    case "cancel_event":
      return cancelEvent(storage, operation, occurredAt);
    case "set_rsvp":
      return updateEventRsvp(storage, operation, occurredAt);
  }
}

export async function manageOrganizationCalendarInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = managementRequestSchema.safeParse(await request.json());
  if (!parsed.success)
    return Response.json({ code: "invalid_calendar_operation" }, { status: 400 });
  if (!identityMatches(storage, parsed.data.organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  return dispatchCalendarMutation(storage, parsed.data, occurredAt);
}
