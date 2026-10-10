import type { NonprofitComplianceTask } from "@choir/contracts";
import type { Env } from "../../env";

export async function complianceResponseWithNames(
  env: Pick<Env, "CONTROL_DB">,
  organizationId: string,
  settings: { readonly enabled: boolean; readonly tasks: readonly NonprofitComplianceTask[] },
) {
  const userIds = [
    ...new Set(
      settings.tasks.flatMap((task) =>
        task.lastCompletedByUserId ? [task.lastCompletedByUserId] : [],
      ),
    ),
  ];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const result = await env.CONTROL_DB.prepare(
      `SELECT u.id, u.name FROM user u
       WHERE u.id IN (${userIds.map(() => "?").join(",")})
         AND EXISTS (SELECT 1 FROM member m WHERE m.userId = u.id AND m.organizationId = ?)`,
    )
      .bind(...userIds, organizationId)
      .all<{ readonly id: string; readonly name: string | null }>();
    for (const row of result.results) {
      const name = row.name?.trim();
      if (name) names.set(row.id, name);
    }
  }

  const membershipIds = [
    ...new Set(
      settings.tasks.flatMap((task) =>
        task.responsibleMembershipId ? [task.responsibleMembershipId] : [],
      ),
    ),
  ];
  const eligibleAssignees = new Map<
    string,
    { readonly email: string; readonly name: string; readonly userId: string }
  >();
  if (membershipIds.length > 0) {
    const result = await env.CONTROL_DB.prepare(
      `SELECT m.id AS membershipId, m.userId AS userId, u.name AS name, u.email AS email
       FROM member m
       JOIN user u ON u.id = m.userId
       WHERE m.organizationId = ?
         AND m.role IN ('owner', 'admin')
         AND m.id IN (${membershipIds.map(() => "?").join(",")})`,
    )
      .bind(organizationId, ...membershipIds)
      .all<{
        readonly email: string;
        readonly membershipId: string;
        readonly name: string | null;
        readonly userId: string;
      }>();
    for (const row of result.results) {
      const name = row.name?.trim();
      const email = row.email.trim();
      if (name && email) {
        eligibleAssignees.set(row.membershipId, { email, name, userId: row.userId });
      }
    }
  }

  return {
    ...settings,
    tasks: settings.tasks.map((task) => {
      const lastCompletedByName = task.lastCompletedByUserId
        ? (names.get(task.lastCompletedByUserId) ?? null)
        : null;
      if (!task.responsibleMembershipId) {
        return {
          ...task,
          lastCompletedByName,
          responsibleEmail: null,
          responsibleName: null,
          responsibleNeedsReassignment: false,
        };
      }
      const eligible = eligibleAssignees.get(task.responsibleMembershipId);
      if (eligible) {
        return {
          ...task,
          lastCompletedByName,
          responsibleEmail: eligible.email,
          responsibleName: eligible.name,
          responsibleNeedsReassignment: false,
          responsibleUserId: eligible.userId,
        };
      }
      return {
        ...task,
        lastCompletedByName,
        responsibleEmail: null,
        responsibleName: null,
        responsibleNeedsReassignment: true,
      };
    }),
  };
}
