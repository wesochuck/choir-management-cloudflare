import { describe, expect, it } from "vitest";

import { validateStartupConfig, type Env } from "./env";

describe("validateStartupConfig", () => {
  const validEnv = {
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const config = validateStartupConfig(validEnv as unknown as Env);
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
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      validateStartupConfig({ ...validEnv, BETTER_AUTH_SECRET: "short" } as unknown as Env),
    ).toThrow(/Too small/);
  });

  it("throws when BETTER_AUTH_SECRET is missing", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      validateStartupConfig({ ...validEnv, BETTER_AUTH_SECRET: undefined } as unknown as Env),
    ).toThrow(/expected string, received undefined/);
  });

  it("throws when SIGNED_LINK_SECRET is too short", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      validateStartupConfig({ ...validEnv, SIGNED_LINK_SECRET: "short" } as unknown as Env),
    ).toThrow(/Too small/);
  });

  it("throws when APP_ENV is invalid", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      validateStartupConfig({ ...validEnv, APP_ENV: "invalid" } as unknown as Env),
    ).toThrow(/Invalid option/);
  });

  it("throws when BUILD_VERSION is empty", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      validateStartupConfig({ ...validEnv, BUILD_VERSION: "" } as unknown as Env),
    ).toThrow(/Too small/);
  });

  it("throws when EXTERNAL_EFFECTS_MODE is invalid", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      validateStartupConfig({ ...validEnv, EXTERNAL_EFFECTS_MODE: "invalid" } as unknown as Env),
    ).toThrow(/Invalid option/);
  });

  it("throws when JOBS_DLQ_NAME is empty", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      validateStartupConfig({ ...validEnv, JOBS_DLQ_NAME: "" } as unknown as Env),
    ).toThrow(/Too small/);
  });

  it("throws when PLATFORM_EMAIL_FROM is invalid email", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      validateStartupConfig({ ...validEnv, PLATFORM_EMAIL_FROM: "not-an-email" } as unknown as Env),
    ).toThrow(/Invalid email/);
  });

  it("throws when PLATFORM_EMAIL_MODE is invalid", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      validateStartupConfig({ ...validEnv, PLATFORM_EMAIL_MODE: "invalid" } as unknown as Env),
    ).toThrow(/Invalid option/);
  });

  it("throws when PRODUCT_BASE_DOMAIN is empty", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      validateStartupConfig({ ...validEnv, PRODUCT_BASE_DOMAIN: "" } as unknown as Env),
    ).toThrow(/Too small/);
  });
});
