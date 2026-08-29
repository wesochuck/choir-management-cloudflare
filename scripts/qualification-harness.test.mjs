import { describe, expect, it } from "vitest";

import { getStagingConfig } from "./qualification-harness.mjs";

describe("staging qualification harness", () => {
  it("provides default configuration without crashing", () => {
    const config = getStagingConfig();
    expect(config.productUrl).toBeDefined();
    expect(config.email).toBeDefined();
  });
});
