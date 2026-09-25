import { authClient } from "./authClient";

export { authClient };

export interface PasskeyItem {
  readonly aaguid?: string | null | undefined;
  readonly backedUp?: boolean | undefined;
  readonly createdAt: Date | number | string;
  readonly deviceType?: string | undefined;
  readonly id: string;
  readonly name?: string | null | undefined;
}

export interface SignInWithPasskeyResult {
  readonly canceled?: boolean;
  readonly error?: string;
  readonly success: boolean;
}

export interface AddPasskeyResult {
  readonly canceled?: boolean;
  readonly error?: string;
  readonly passkey?: PasskeyItem;
  readonly success: boolean;
}

function parsePasskeyCreatedAt(createdAt: unknown): Date | number | string {
  if (createdAt instanceof Date || typeof createdAt === "number" || typeof createdAt === "string") {
    return createdAt;
  }
  return Date.now();
}

function toPasskeyItem(pk: unknown): PasskeyItem | null {
  if (typeof pk !== "object" || pk === null || !("id" in pk) || typeof pk.id !== "string") {
    return null;
  }
  const id = pk.id;
  const createdAt = "createdAt" in pk ? parsePasskeyCreatedAt(pk.createdAt) : Date.now();
  const name = "name" in pk && typeof pk.name === "string" ? pk.name : null;
  const deviceType =
    "deviceType" in pk && typeof pk.deviceType === "string" ? pk.deviceType : undefined;
  const backedUp = "backedUp" in pk && typeof pk.backedUp === "boolean" ? pk.backedUp : undefined;
  const aaguid = "aaguid" in pk && typeof pk.aaguid === "string" ? pk.aaguid : undefined;
  return { aaguid, backedUp, createdAt, deviceType, id, name };
}

function isPasskeyCancelError(code: string, message: string): boolean {
  const lower = message.toLowerCase();
  return (
    code === "AUTH_CANCELLED" ||
    code === "REGISTRATION_CANCELLED" ||
    code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" ||
    lower.includes("cancel") ||
    lower.includes("abort")
  );
}

export async function isPasskeySupported(): Promise<boolean> {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ===
      "function" &&
    (await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(
      () => false,
    ))
  );
}

export async function isConditionalMediationSupported(): Promise<boolean> {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof window.PublicKeyCredential.isConditionalMediationAvailable === "function" &&
    (await window.PublicKeyCredential.isConditionalMediationAvailable().catch(() => false))
  );
}

export async function signInWithPasskey(options?: {
  autoFill?: boolean;
}): Promise<SignInWithPasskeyResult> {
  try {
    const opts = options?.autoFill !== undefined ? { autoFill: options.autoFill } : undefined;
    const res = await authClient.signIn.passkey(opts);
    if (res.error) {
      const code = "code" in res.error && typeof res.error.code === "string" ? res.error.code : "";
      const message =
        "message" in res.error && typeof res.error.message === "string" ? res.error.message : "";
      return {
        canceled: isPasskeyCancelError(code, message),
        error: message.length > 0 ? message : "Passkey sign-in failed.",
        success: false,
      };
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Passkey sign-in failed.";
    return { canceled: isPasskeyCancelError("", message), error: message, success: false };
  }
}

export async function addPasskey(name?: string): Promise<AddPasskeyResult> {
  try {
    const trimmed = name?.trim();
    const opts = trimmed ? { name: trimmed } : undefined;
    const res = await authClient.passkey.addPasskey(opts);
    if (res.error) {
      const code = "code" in res.error && typeof res.error.code === "string" ? res.error.code : "";
      const message =
        "message" in res.error && typeof res.error.message === "string" ? res.error.message : "";
      return {
        canceled: isPasskeyCancelError(code, message),
        error: message.length > 0 ? message : "Adding passkey failed.",
        success: false,
      };
    }
    const passkey = toPasskeyItem(res.data);
    return passkey
      ? { passkey, success: true }
      : { error: "Invalid passkey data.", success: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Adding passkey failed.";
    return { canceled: isPasskeyCancelError("", message), error: message, success: false };
  }
}

export async function listPasskeys(): Promise<PasskeyItem[]> {
  const res = await authClient.passkey.listUserPasskeys();
  if (res.error) {
    const message =
      "message" in res.error && typeof res.error.message === "string"
        ? res.error.message
        : "Failed to list passkeys.";
    throw new Error(message);
  }
  const items = Array.isArray(res.data) ? res.data : [];
  return items.map(toPasskeyItem).filter((p): p is PasskeyItem => p !== null);
}

export async function renamePasskey(id: string, name: string): Promise<void> {
  const res = await authClient.passkey.updatePasskey({ id, name });
  if (res.error) {
    const message =
      "message" in res.error && typeof res.error.message === "string"
        ? res.error.message
        : "Failed to rename passkey.";
    throw new Error(message);
  }
}

export async function deletePasskey(id: string): Promise<void> {
  const res = await authClient.passkey.deletePasskey({ id });
  if (res.error) {
    const message =
      "message" in res.error && typeof res.error.message === "string"
        ? res.error.message
        : "Failed to delete passkey.";
    throw new Error(message);
  }
}
