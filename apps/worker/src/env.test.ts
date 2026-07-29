import { describe, expect, it } from "vitest";

import { validateStartupConfig, type Env } from "./env";

describe("validateStartupConfig", () => {
  const validEnv: Partial<Env> = {
    APP_ENV: "production",
    BETTER_AUTH_SECRET: "12345678901234567890123456789012", // 32 chars
    BUILD_VERSION: "1.0.0",
    EXTERNAL_EFFECTS_MODE: "disabled",
    JOBS_DLQ_NAME: "dlq",
    PLATFORM_EMAIL_FROM: "test@example.com",
    PLATFORM_EMAIL_MODE: "disabled",
    PRODUCT_BASE_DOMAIN: "example.com",
    SIGNED_LINK_SECRET: "12345678901234567890123456789012", // 32 chars
  };

  it("validates a correct environment", () => {
    const config = validateStartupConfig(validEnv as Env);
    expect(config).toEqual({
      APP_ENV: "production",
      BUILD_VERSION: "1.0.0",
      EXTERNAL_EFFECTS_MODE: "disabled",
      JOBS_DLQ_NAME: "dlq",
      PLATFORM_EMAIL_FROM: "test@example.com",
      PLATFORM_EMAIL_MODE: "disabled",
      PRODUCT_BASE_DOMAIN: "example.com",
    });
  });

  it("throws when BETTER_AUTH_SECRET is too short", () => {
    expect(() => validateStartupConfig({ ...validEnv, BETTER_AUTH_SECRET: "short" } as Env)).toThrowError(
      /Too small/,
    );
  });

  it("throws when BETTER_AUTH_SECRET is missing", () => {
    expect(() =>
      validateStartupConfig({ ...validEnv, BETTER_AUTH_SECRET: undefined } as unknown as Env),
    ).toThrowError(/expected string, received undefined/);
  });

  it("throws when SIGNED_LINK_SECRET is too short", () => {
    expect(() => validateStartupConfig({ ...validEnv, SIGNED_LINK_SECRET: "short" } as Env)).toThrowError(
      /Too small/,
    );
  });

  it("throws when APP_ENV is invalid", () => {
    expect(() => validateStartupConfig({ ...validEnv, APP_ENV: "invalid" } as Env)).toThrowError(
      /Invalid option/,
    );
  });

  it("throws when BUILD_VERSION is empty", () => {
    expect(() => validateStartupConfig({ ...validEnv, BUILD_VERSION: "" } as Env)).toThrowError(/Too small/);
  });

  it("throws when EXTERNAL_EFFECTS_MODE is invalid", () => {
    expect(() =>
      validateStartupConfig({ ...validEnv, EXTERNAL_EFFECTS_MODE: "invalid" } as Env),
    ).toThrowError(/Invalid option/);
  });

  it("throws when JOBS_DLQ_NAME is empty", () => {
    expect(() => validateStartupConfig({ ...validEnv, JOBS_DLQ_NAME: "" } as Env)).toThrowError(/Too small/);
  });

  it("throws when PLATFORM_EMAIL_FROM is invalid email", () => {
    expect(() =>
      validateStartupConfig({ ...validEnv, PLATFORM_EMAIL_FROM: "not-an-email" } as Env),
    ).toThrowError(/Invalid email/);
  });

  it("throws when PLATFORM_EMAIL_MODE is invalid", () => {
    expect(() => validateStartupConfig({ ...validEnv, PLATFORM_EMAIL_MODE: "invalid" } as Env)).toThrowError(
      /Invalid option/,
    );
  });

  it("throws when PRODUCT_BASE_DOMAIN is empty", () => {
    expect(() => validateStartupConfig({ ...validEnv, PRODUCT_BASE_DOMAIN: "" } as Env)).toThrowError(
      /Too small/,
    );
  });
});
