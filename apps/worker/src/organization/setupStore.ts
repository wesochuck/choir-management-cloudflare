import { MODULE_DEFINITIONS, resolveModuleEnabled } from "@choir/domain";
import { z } from "zod";

interface SetupStateRow {
  readonly [column: string]: SqlStorageValue;
  readonly completedSteps: string;
  readonly currentStep: string | null;
  readonly launched: number;
  readonly moduleConfig: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly themeConfig: string;
}

interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly lifecycleState: string;
}

const saveProgressOperationSchema = z.object({
  action: z.literal("save_progress"),
  organizationId: z.string().min(1).max(128),
  step: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
});

const completeSetupOperationSchema = z.object({
  action: z.literal("complete_setup"),
  organizationId: z.string().min(1).max(128),
});

const updateModuleOperationSchema = z.object({
  action: z.literal("update_module"),
  moduleId: z.string().min(1),
  enabled: z.boolean(),
  organizationId: z.string().min(1).max(128),
});

const claimSetupOperationSchema = z.object({
  action: z.literal("claim_setup"),
  organizationId: z.string().min(1).max(128),
});

const manageOperationSchema = z.discriminatedUnion("action", [
  saveProgressOperationSchema,
  completeSetupOperationSchema,
  updateModuleOperationSchema,
  claimSetupOperationSchema,
]);

function identity(storage: DurableObjectStorage): IdentityRow | undefined {
  return storage.sql
    .exec<IdentityRow>(
      `SELECT organization_id AS organizationId, name AS organizationName,
        lifecycle_state AS lifecycleState
       FROM organization_metadata LIMIT 1`,
    )
    .toArray()
    .at(0);
}

function parseCompletedSteps(raw: string): string[] {
  const value: unknown = JSON.parse(raw);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function parseModuleConfig(raw: string): Record<string, boolean> {
  const value: unknown = JSON.parse(raw);
  const result: Record<string, boolean> = {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "boolean") {
        result[k] = v;
      }
    }
  }
  return result;
}

function parseThemeConfig(raw: string): Record<string, string> {
  const value: unknown = JSON.parse(raw);
  const result: Record<string, string> = {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string") {
        result[k] = v;
      }
    }
  }
  return result;
}

export function getSetupStateFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  const org = identity(storage);
  if (org?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const row = storage.sql
    .exec<SetupStateRow>(
      `SELECT organization_id AS organizationId, organization_name AS organizationName,
        completed_steps AS completedSteps, current_step AS currentStep,
        launched, module_config AS moduleConfig, theme_config AS themeConfig
       FROM setup_state LIMIT 1`,
    )
    .toArray()
    .at(0);
  if (!row) {
    return Response.json({
      organizationId,
      organizationName: org.organizationName,
      completedSteps: [],
      currentStep: null,
      allModulesConfigured: false,
      launched: false,
    });
  }
  const organizationName = row.organizationName.trim() || org.organizationName;
  const completedSteps = parseCompletedSteps(row.completedSteps);
  const moduleConfig = parseModuleConfig(row.moduleConfig);
  const allModulesConfigured = Object.keys(moduleConfig).length > 0;
  return Response.json({
    organizationId: row.organizationId,
    organizationName,
    completedSteps,
    currentStep: row.currentStep,
    allModulesConfigured,
    launched: row.launched === 1,
  });
}

function applyModuleData(
  config: Record<string, boolean>,
  data: Record<string, unknown>,
): Record<string, boolean> {
  const result = { ...config };
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

function applyThemeData(
  config: Record<string, string>,
  data: Record<string, unknown>,
): Record<string, string> {
  const result = { ...config };
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

function saveProgressUpdate(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveProgressOperationSchema>,
  existing: SetupStateRow,
  now: string,
): void {
  const completedSteps = parseCompletedSteps(existing.completedSteps);
  if (!completedSteps.includes(operation.step)) {
    completedSteps.push(operation.step);
  }
  const currentModuleConfig = parseModuleConfig(existing.moduleConfig);
  const currentThemeConfig = parseThemeConfig(existing.themeConfig);
  const nextModuleConfig =
    operation.step === "modules" && operation.data
      ? applyModuleData(currentModuleConfig, operation.data)
      : currentModuleConfig;
  const nextThemeConfig =
    operation.step === "theme" && operation.data
      ? applyThemeData(currentThemeConfig, operation.data)
      : currentThemeConfig;
  storage.sql.exec(
    `UPDATE setup_state
     SET completed_steps = ?, current_step = ?, module_config = ?,
         theme_config = ?, organization_name = ?, updated_at = ?
     WHERE organization_id = ?`,
    JSON.stringify(completedSteps),
    operation.step,
    JSON.stringify(nextModuleConfig),
    JSON.stringify(nextThemeConfig),
    operation.data?.name ?? "",
    now,
    operation.organizationId,
  );
}

function saveProgressInsert(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveProgressOperationSchema>,
  now: string,
): void {
  const completedSteps = [operation.step];
  const nextModuleConfig =
    operation.step === "modules" && operation.data ? applyModuleData({}, operation.data) : {};
  const nextThemeConfig =
    operation.step === "theme" && operation.data ? applyThemeData({}, operation.data) : {};
  storage.sql.exec(
    `INSERT INTO setup_state
      (organization_id, organization_name, completed_steps, current_step,
       launched, module_config, theme_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    operation.organizationId,
    operation.data?.name ?? "",
    JSON.stringify(completedSteps),
    operation.step,
    JSON.stringify(nextModuleConfig),
    JSON.stringify(nextThemeConfig),
    now,
    now,
  );
}

function saveProgress(
  storage: DurableObjectStorage,
  operation: z.infer<typeof saveProgressOperationSchema>,
): Response {
  const org = identity(storage);
  if (org?.organizationId !== operation.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const now = new Date().toISOString();
  const existing = storage.sql
    .exec<SetupStateRow>(
      `SELECT completed_steps AS completedSteps, current_step AS currentStep,
        launched, module_config AS moduleConfig, theme_config AS themeConfig
       FROM setup_state LIMIT 1`,
    )
    .toArray()
    .at(0);

  if (existing) {
    saveProgressUpdate(storage, operation, existing, now);
  } else {
    saveProgressInsert(storage, operation, now);
  }
  return Response.json({ saved: true });
}

function completeSetup(
  storage: DurableObjectStorage,
  operation: z.infer<typeof completeSetupOperationSchema>,
): Response {
  const org = identity(storage);
  if (org?.organizationId !== operation.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE setup_state
       SET launched = 1, current_step = NULL, updated_at = ?
       WHERE organization_id = ?`,
      now,
      operation.organizationId,
    );
    storage.sql.exec(
      `UPDATE organization_metadata
       SET lifecycle_state = 'active', updated_at = ?
       WHERE organization_id = ?`,
      now,
      operation.organizationId,
    );
    storage.sql.exec(
      `INSERT OR REPLACE INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'system', 'setup', 'organization.setup_completed',
        'organization', ?, '', ?, ?)`,
      `setup-completed:${operation.organizationId}`,
      operation.organizationId,
      `{}`,
      now,
    );
  });
  return Response.json({ completed: true });
}

function updateModule(
  storage: DurableObjectStorage,
  operation: z.infer<typeof updateModuleOperationSchema>,
): Response {
  const org = identity(storage);
  if (org?.organizationId !== operation.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const existing = storage.sql
    .exec<{ readonly moduleConfig: string }>(
      "SELECT module_config AS moduleConfig FROM setup_state LIMIT 1",
    )
    .toArray()
    .at(0);
  const moduleConfig: Record<string, boolean> = existing
    ? parseModuleConfig(existing.moduleConfig)
    : {};
  moduleConfig[operation.moduleId] = operation.enabled;
  const now = new Date().toISOString();
  if (existing) {
    storage.sql.exec(
      "UPDATE setup_state SET module_config = ?, updated_at = ? WHERE organization_id = ?",
      JSON.stringify(moduleConfig),
      now,
      operation.organizationId,
    );
  } else {
    storage.sql.exec(
      `INSERT INTO setup_state
        (organization_id, organization_name, completed_steps, current_step,
         launched, module_config, theme_config, created_at, updated_at)
       VALUES (?, '', '[]', NULL, 0, ?, '{}', ?, ?)`,
      operation.organizationId,
      JSON.stringify(moduleConfig),
      now,
      now,
    );
  }
  return Response.json({ moduleId: operation.moduleId, enabled: operation.enabled });
}

function claimSetup(
  storage: DurableObjectStorage,
  operation: z.infer<typeof claimSetupOperationSchema>,
): Response {
  const org = identity(storage);
  if (org?.organizationId !== operation.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  if (org.lifecycleState !== "provisioning") {
    return Response.json({ code: "organization_not_in_provisioning" }, { status: 409 });
  }
  const now = new Date().toISOString();
  storage.sql.exec(
    `UPDATE organization_metadata
     SET lifecycle_state = 'active', updated_at = ?
     WHERE organization_id = ? AND lifecycle_state = 'provisioning'`,
    now,
    operation.organizationId,
  );
  return Response.json({ claimed: true, organizationId: operation.organizationId });
}

export async function manageSetupInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const operation = manageOperationSchema.safeParse(await request.json().catch(() => null));
  if (!operation.success) {
    return Response.json({ code: "invalid_setup_operation" }, { status: 400 });
  }
  switch (operation.data.action) {
    case "save_progress":
      return saveProgress(storage, operation.data);
    case "complete_setup":
      return completeSetup(storage, operation.data);
    case "update_module":
      return updateModule(storage, operation.data);
    case "claim_setup":
      return claimSetup(storage, operation.data);
  }
}

export function getModuleStateFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  const org = identity(storage);
  if (org?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const row = storage.sql
    .exec<{ readonly moduleConfig: string }>(
      "SELECT module_config AS moduleConfig FROM setup_state LIMIT 1",
    )
    .toArray()
    .at(0);
  const config: Record<string, boolean> = row ? parseModuleConfig(row.moduleConfig) : {};
  const modules = MODULE_DEFINITIONS.map((def) => ({
    category: def.category,
    description: def.description,
    enabled: resolveModuleEnabled(def.id, config),
    id: def.id,
    label: def.label,
  }));
  return Response.json({ modules });
}
