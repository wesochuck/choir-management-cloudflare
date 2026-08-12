import { describe, expect, it } from "vitest";

import {
  photoQualificationPlan,
  summarizePhotoDownload,
} from "./qualify-staging-profile-photo.mjs";

describe("staging Profile-photo qualification helpers", () => {
  it("plans only bounded application-route operations", () => {
    expect(photoQualificationPlan("profile-id")).toEqual([
      "upload two generated PNG fixtures for Profile profile-id",
      "attach the first fixture and verify private download headers and checksum",
      "verify wrong-Organization file access returns 404",
      "replace with the second fixture and verify the first object is reclaimed",
      "remove the photo and verify the replacement object is reclaimed",
    ]);
  });

  it("requires private no-store headers and an exact fixture checksum", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const response = new Response(null, {
      headers: {
        "cache-control": "private, no-store",
        "content-type": "image/png",
      },
      status: 200,
    });
    const matching = summarizePhotoDownload(
      response,
      bytes,
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
    expect(matching.status).toBe(200);
    expect(matching.length).toBe(3);
    expect(matching.ok).toBe(true);
    expect(summarizePhotoDownload(response, bytes, "not-the-fixture-checksum").ok).toBe(false);
    expect(JSON.stringify(matching)).not.toContain("cookie");
  });
});
