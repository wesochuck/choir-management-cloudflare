import {
  memberDashboardActiveSeasonSchema,
  memberDashboardBulletinSchema,
  memberDashboardPollSchema,
  memberDashboardResponseSchema,
  organizationPollSummarySchema,
  organizationResourceSchema,
  organizationCalendarSettingsResponseSchema,
  singerEventSchema,
  type MemberDashboardResponse,
  type memberDashboardWidgetStateSchema,
} from "@choir/contracts";
import { z } from "zod";

import type { Env } from "../env";
import {
  readOrganizationCalendarSettings,
  readOrganizationRosterConfiguration,
  listMemberSchedule,
} from "../calendar/organizationCalendar";
import { getModuleState, getSetupStatus } from "./organizationSetup";
import { generatePollTokens } from "./organizationPollLinks";
import { invokeOrganizationRpc, organizationStoreStub } from "./rpc/client";

const store = (env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) =>
  organizationStoreStub(env, organizationId);

async function readStore(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  path: string,
  parameters: Readonly<Record<string, string>> = {},
): Promise<unknown> {
  const url = new URL(`https://organization.internal${path}`);
  url.searchParams.set("organizationId", organizationId);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  const response = await invokeOrganizationRpc(store(env, organizationId), url);
  if (!response.ok) throw new Error(`Organization dashboard read failed: ${path}`);
  return response.json();
}

const profileResponseSchema = z.object({
  displayName: z.string().min(1).max(200),
  id: z.uuid(),
  voicePart: z.string().max(100),
});

const resourceResponseSchema = z.object({
  resources: z.array(organizationResourceSchema).max(500),
});

const bulletinResponseSchema = z.object({
  bulletins: z.array(memberDashboardBulletinSchema).max(5),
});

const pollSummaryResponseSchema = z.array(organizationPollSummarySchema);

const activeSeasonResponseSchema = z.object({
  activeSeason: memberDashboardActiveSeasonSchema.nullable(),
});

const readProfile = async (
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  profileId: string,
): Promise<MemberDashboardResponse["profile"]> =>
  profileResponseSchema.parse(
    await readStore(env, organizationId, "/internal/profiles/member", { profileId }),
  );

async function readMemberDashboardCore(env: Env, organizationId: string, profileId: string | null) {
  const [setup, calendarSettings, rosterConfiguration, modules] = await Promise.all([
    getSetupStatus(env, organizationId),
    readOrganizationCalendarSettings(env, organizationId),
    readOrganizationRosterConfiguration(env, organizationId),
    getModuleState(env, organizationId),
  ]);
  const moduleEnabled = (id: string): boolean =>
    modules.find((module) => module.id === id)?.enabled ?? false;
  const eventsEnabled = moduleEnabled("events");
  const [profile, events] = profileId
    ? await Promise.all([
        readProfile(env, organizationId, profileId),
        eventsEnabled ? listMemberSchedule(env, organizationId, profileId) : Promise.resolve([]),
      ])
    : [null, [] as const];
  return {
    calendarSettings,
    communicationsEnabled: moduleEnabled("communications"),
    duesEnabled: moduleEnabled("dues"),
    events,
    eventsEnabled,
    modules,
    peopleEnabled: moduleEnabled("people") || moduleEnabled("roster"),
    pollsEnabled: moduleEnabled("polls"),
    profile,
    programsEnabled: moduleEnabled("programs"),
    resourcesEnabled: moduleEnabled("resources"),
    rosterConfiguration,
    setup,
  };
}

async function readMemberDashboardOptionalWidgets(
  env: Env,
  organizationId: string,
  profileId: string | null,
  options: {
    readonly communicationsEnabled: boolean;
    readonly duesEnabled: boolean;
    readonly pollsEnabled: boolean;
    readonly resourcesEnabled: boolean;
  },
) {
  const resourcesPromise = options.resourcesEnabled
    ? readStore(env, organizationId, "/internal/resources").then((value) =>
        resourceResponseSchema.parse(value).resources.slice(0, 5),
      )
    : Promise.resolve([] as const);
  const bulletinsPromise =
    options.communicationsEnabled && profileId
      ? readStore(env, organizationId, "/internal/communications/member-bulletins", {
          profileId,
        }).then((value) => bulletinResponseSchema.parse(value).bulletins)
      : Promise.resolve([] as const);
  const pollsPromise =
    options.pollsEnabled && profileId
      ? readStore(env, organizationId, "/internal/polls").then((value) =>
          pollSummaryResponseSchema
            .parse(value)
            .filter(
              (poll) =>
                poll.archivedAt === "" &&
                (poll.expiresAt === "" ||
                  (Number.isFinite(Date.parse(poll.expiresAt)) &&
                    Date.parse(poll.expiresAt) > Date.now())),
            )
            .sort((left, right) => {
              if (left.expiresAt === "") return 1;
              if (right.expiresAt === "") return -1;
              return (
                left.expiresAt.localeCompare(right.expiresAt) || left.id.localeCompare(right.id)
              );
            }),
        )
      : Promise.resolve([] as const);
  const activeSeasonPromise =
    options.duesEnabled && profileId
      ? readStore(env, organizationId, "/internal/seasons/member-active", { profileId }).then(
          (value) => activeSeasonResponseSchema.parse(value).activeSeason,
        )
      : Promise.resolve(null);
  return Promise.allSettled([
    resourcesPromise,
    bulletinsPromise,
    pollsPromise,
    activeSeasonPromise,
  ]);
}

function widgetState(
  enabled: boolean,
  requiresProfile: boolean,
  profileId: string | null,
  result: PromiseSettledResult<unknown>,
): z.infer<typeof memberDashboardWidgetStateSchema> {
  if (!enabled || (requiresProfile && profileId === null)) return "disabled";
  return result.status === "fulfilled" ? "ready" : "unavailable";
}

async function resolveMemberDashboardPolls(
  env: Env,
  organizationId: string,
  profileId: string | null,
  programsEnabled: boolean,
  result: PromiseSettledResult<readonly z.infer<typeof organizationPollSummarySchema>[]>,
): Promise<{
  readonly polls: MemberDashboardResponse["polls"];
  readonly pollsState: z.infer<typeof memberDashboardWidgetStateSchema>;
}> {
  if (!programsEnabled || profileId === null) return { polls: [], pollsState: "disabled" };
  if (result.status !== "fulfilled") return { polls: [], pollsState: "unavailable" };
  try {
    const polls = await Promise.all(
      result.value.map(async (poll) => {
        const tokens = await generatePollTokens(env, organizationId, poll.id, [profileId]);
        return memberDashboardPollSchema.parse({
          expiresAt: poll.expiresAt,
          id: poll.id,
          linkToken: tokens.tokens[profileId],
          title: poll.title,
        });
      }),
    );
    return { polls, pollsState: "ready" };
  } catch {
    return { polls: [], pollsState: "unavailable" };
  }
}

export async function readOrganizationMemberDashboard(
  env: Env,
  organizationId: string,
  profileId: string | null,
): Promise<Omit<MemberDashboardResponse, "requestId">> {
  const core = await readMemberDashboardCore(env, organizationId, profileId);
  const [resourcesResult, bulletinsResult, pollsResult, activeSeasonResult] =
    await readMemberDashboardOptionalWidgets(env, organizationId, profileId, {
      communicationsEnabled: core.communicationsEnabled,
      duesEnabled: core.duesEnabled,
      pollsEnabled: core.pollsEnabled,
      resourcesEnabled: core.resourcesEnabled,
    });
  const polls = await resolveMemberDashboardPolls(
    env,
    organizationId,
    profileId,
    core.pollsEnabled,
    pollsResult,
  );

  const pollTokenMap = new Map(polls.polls.map((poll) => [poll.id, poll.linkToken]));
  const rawBulletins = bulletinsResult.status === "fulfilled" ? bulletinsResult.value : [];
  const bulletins = rawBulletins.map((bulletin) => {
    const contentMarkdown = bulletin.contentMarkdown.replace(
      /\{\{POLL_LINK:([0-9a-f-]{36})\}\}/gi,
      (_, pollId: string) => {
        const token = pollTokenMap.get(pollId);
        return token
          ? `[Respond to poll](/poll?token=${encodeURIComponent(token)})`
          : "[Respond to poll](/dashboard)";
      },
    );
    return { ...bulletin, contentMarkdown };
  });

  return memberDashboardResponseSchema.omit({ requestId: true }).parse({
    activeSeason: activeSeasonResult.status === "fulfilled" ? activeSeasonResult.value : null,
    activeSeasonState: widgetState(core.duesEnabled, true, profileId, activeSeasonResult),
    bulletins,
    bulletinsState: widgetState(core.communicationsEnabled, true, profileId, bulletinsResult),
    events: core.events.map((event) => singerEventSchema.parse(event)),
    modules: core.modules,
    organizationName: core.setup.organizationName,
    performerLabel: core.rosterConfiguration.performerLabel,
    polls: polls.polls,
    pollsState: polls.pollsState,
    profile: core.profile,
    profileLinkRequired: profileId === null,
    resources: resourcesResult.status === "fulfilled" ? resourcesResult.value : [],
    resourcesState: widgetState(core.resourcesEnabled, false, profileId, resourcesResult),
    timezone: organizationCalendarSettingsResponseSchema
      .omit({ requestId: true })
      .parse(core.calendarSettings).timezone,
  });
}
