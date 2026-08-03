import { lazy } from "react";

export const AccountSecurity = lazy(() =>
  import("../../AccountSecurity").then(({ AccountSecurity: component }) => ({
    default: component,
  })),
);

export const AccountView = lazy(() =>
  import("../../AccountView").then(({ AccountView: component }) => ({ default: component })),
);

export const AttendanceManager = lazy(() =>
  import("../../AttendanceManager").then(({ AttendanceManager: component }) => ({
    default: component,
  })),
);

export const AuditionManager = lazy(() =>
  import("../AuditionManager/page").then(({ AuditionManager: component }) => ({
    default: component,
  })),
);

export const DashboardView = lazy(() =>
  import("../../DashboardView").then(({ DashboardView: component }) => ({ default: component })),
);

export const CommunicationCenter = lazy(() =>
  import("../CommunicationCenter/controller").then(({ CommunicationCenter: component }) => ({
    default: component,
  })),
);

export const DonationsManager = lazy(() =>
  import("../../DonationsManager").then(({ DonationsManager: component }) => ({
    default: component,
  })),
);

export const EventsPage = lazy(() =>
  import("../EventsPage/page").then(({ EventsPage: component }) => ({ default: component })),
);

export const LearningTrackPlayer = lazy(() =>
  import("../../LearningTrackPlayer").then(({ LearningTrackPlayer: component }) => ({
    default: component,
  })),
);

export const MemberProfileDirectory = lazy(() =>
  import("../../MemberProfileDirectory").then(({ MemberProfileDirectory: component }) => ({
    default: component,
  })),
);

export const MemberDuesPage = lazy(() =>
  import("../../MemberDuesPage").then(({ MemberDuesPage: component }) => ({ default: component })),
);

export const ModuleSettingsView = lazy(() =>
  import("../../ModuleSettingsView").then(({ ModuleSettingsView: component }) => ({
    default: component,
  })),
);

export const MusicCatalog = lazy(() =>
  import("../MusicCatalog/controller").then(({ MusicCatalog: component }) => ({
    default: component,
  })),
);

export const MusicLibrarySettings = lazy(() =>
  import("../../MusicLibrarySettingsPage").then(({ MusicLibrarySettingsPage: component }) => ({
    default: component,
  })),
);

export const MySchedule = lazy(() =>
  import("../../MySchedule").then(({ MySchedule: component }) => ({ default: component })),
);

export const OrganizationAccess = lazy(() =>
  import("../../OrganizationAccess").then(({ OrganizationAccess: component }) => ({
    default: component,
  })),
);

export const OrganizationResources = lazy(() =>
  import("../../OrganizationResources").then(({ OrganizationResources: component }) => ({
    default: component,
  })),
);

export const OrganizationSettingsPage = lazy(() =>
  import("../../OrganizationSettingsPage").then(({ OrganizationSettingsPage: component }) => ({
    default: component,
  })),
);

export const PlatformAccess = lazy(() =>
  import("../../PlatformAccess").then(({ PlatformAccess: component }) => ({ default: component })),
);

export const PlatformSetupMonitor = lazy(() =>
  import("../../PlatformSetupMonitor").then(({ PlatformSetupMonitor: component }) => ({
    default: component,
  })),
);

export const PollsPage = lazy(() =>
  import("../../PollsPage").then(({ PollsPage: component }) => ({ default: component })),
);

export const PublicWebsiteManager = lazy(() =>
  import("../../PublicWebsiteManager").then(({ PublicWebsiteManager: component }) => ({
    default: component,
  })),
);

export const ReportsView = lazy(() =>
  import("../../ReportsView").then(({ ReportsView: component }) => ({ default: component })),
);

export const RosterPage = lazy(() =>
  import("../RosterPage/controller").then(({ RosterPage: component }) => ({ default: component })),
);

export const RsvpManagerPage = lazy(() =>
  import("../../RsvpManagerPage").then(({ RsvpManagerPage: component }) => ({
    default: component,
  })),
);

export const SeasonsManager = lazy(() =>
  import("../../SeasonsManager").then(({ SeasonsManager: component }) => ({ default: component })),
);

export const SeatingFinder = lazy(() =>
  import("../../SeatingFinder").then(({ SeatingFinder: component }) => ({ default: component })),
);

export const SeatingManager = lazy(() =>
  import("../SeatingManager/controller").then(({ SeatingManager: component }) => ({
    default: component,
  })),
);

export const SetListManager = lazy(() =>
  import("../SetListManager/controller").then(({ SetListManager: component }) => ({
    default: component,
  })),
);

export const SetupChecklistView = lazy(() =>
  import("../../SetupChecklistView").then(({ SetupChecklistView: component }) => ({
    default: component,
  })),
);

export const TicketingManager = lazy(() =>
  import("../../TicketingManager").then(({ TicketingManager: component }) => ({
    default: component,
  })),
);

export const VenuesPage = lazy(() =>
  import("../../VenuesPage").then(({ VenuesPage: component }) => ({ default: component })),
);
