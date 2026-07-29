import { describe, expect, it } from "vitest";

import { publishedMediaKey, publishedProjectionKey } from "./publishOrganization";

describe("published keys", () => {
  describe("publishedProjectionKey", () => {
    it("should generate the correct projection key with string interpolation", () => {
      const key = publishedProjectionKey("my-org", 123);
      expect(key).toBe("organizations/my-org/published/v123/index.json");
    });
  });

  describe("publishedMediaKey", () => {
    it("should generate the correct media key with string interpolation", () => {
      const key = publishedMediaKey("my-org", 123, "my-file-id");
      expect(key).toBe("organizations/my-org/published/v123/media/my-file-id");
    });
  });
});
