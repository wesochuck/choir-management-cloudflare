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
  return {
    ...settings,
    tasks: settings.tasks.map((task) => ({
      ...task,
      lastCompletedByName: task.lastCompletedByUserId
        ? (names.get(task.lastCompletedByUserId) ?? null)
        : null,
    })),
  };
}
