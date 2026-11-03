import { organizationEventSchema, organizationMusicPieceResponseSchema } from "@choir/contracts";
import { readEmailOneTimeCode, seedAuthUser, signInWithOtp } from "@choir/testkit";
import { reset, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  api,
  createVenue,
  database,
  requestFrom,
  setupMusicTestEnvironment,
  signIn,
  stores,
  write,
} from "./helpers/musicTestHarness";

beforeEach(async () => {
  await setupMusicTestEnvironment();
});

afterEach(async () => {
  await reset();
});

describe("Organization music digital scores", () => {
  it("supports digital score upload, supplementary editions, movement fallback, and score bundle", async () => {
    const cookie = await signIn();

    // 1. Create parent piece and movement
    const parentPiece = organizationMusicPieceResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/music", cookie, {
          title: "Requiem",
        })
      ).json(),
    );

    const movementPiece = organizationMusicPieceResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/music", cookie, {
          parentId: parentPiece.id,
          title: "Pie Jesu",
        })
      ).json(),
    );

    // 2. Upload a PDF score file
    const pdfBytes = new TextEncoder().encode("%PDF-1.4 mock score content");
    const scoreFileId = "55555555-5555-4555-8555-555555555555";
    const uploadRes = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/files/${scoreFileId}`, cookie, {
        body: pdfBytes,
        headers: {
          "content-length": String(pdfBytes.byteLength),
          "content-type": "application/pdf",
          "x-file-name": encodeURIComponent("Requiem - Choral Score.pdf"),
        },
        method: "PUT",
      }),
    );
    expect(uploadRes.status).toBe(201);

    // 3. Attach primary score to parent piece
    const updatedParent = organizationMusicPieceResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/music/${parentPiece.id}`,
          cookie,
          { ...requestFrom(parentPiece), scoreFileIds: { primary: scoreFileId } },
          "PUT",
        )
      ).json(),
    );
    expect(updatedParent.scoreFileIds).toEqual({ primary: scoreFileId });

    const venueId = await createVenue(cookie);
    // 4. Create an event with approved set list containing movement
    const eventRes = await write("alpha.localhost", "/api/organization/events", cookie, {
      rsvpDeadlineDate: "2030-01-01",
      setList: [
        {
          composer: "Faure",
          pieceId: movementPiece.id,
          title: "Pie Jesu",
        },
      ],
      setListApproved: true,
      startsAt: "2026-11-01T19:00:00.000Z",
      title: "Fall Concert",
      type: "Performance",
      venueId,
    });
    const event = organizationEventSchema.parse(await eventRes.json());

    // 5. Test score access on movement (should fall back to parent piece's primary score)
    const scoreRes = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/pieces/${movementPiece.id}/score`, cookie),
    );
    expect(scoreRes.status).toBe(200);
    expect(scoreRes.headers.get("content-type")).toBe("application/pdf");
    expect(scoreRes.headers.get("content-disposition")).toContain("inline");

    // 6. Test score bundle download for the event
    const bundleRes = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${event.id}/scores/bundle`, cookie),
    );
    expect(bundleRes.status).toBe(200);
    expect(bundleRes.headers.get("content-type")).toBe("application/zip");
    expect(bundleRes.headers.get("content-disposition")).toContain("-scores.zip");

    // 7. Verify audit event for piece update
    const auditActions = await runInDurableObject<OrganizationStore, readonly string[]>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly action: string }>(
            "SELECT action FROM audit_events WHERE target_id = ? ORDER BY occurred_at",
            parentPiece.id,
          )
          .toArray()
          .map(({ action }) => action),
    );
    expect(auditActions).toContain("music.piece.updated");
  });

  it("denies members scores from unapproved set lists", async () => {
    const adminCookie = await signIn();
    await seedAuthUser(database, "member-user", "member@example.test", "Member User");
    await database
      .prepare(
        "INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)",
      )
      .bind("member-organization-alpha", "organization-alpha", "member-user", "member", Date.now())
      .run();
    const memberCookie = await signInWithOtp(
      exports.default,
      "alpha.localhost",
      "member@example.test",
      (email) => readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
    );

    const piece = organizationMusicPieceResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/music", adminCookie, {
          title: "Unapproved Anthem",
        })
      ).json(),
    );
    const pdfBytes = new TextEncoder().encode("%PDF-1.4 unapproved score");
    const scoreFileId = "66666666-6666-4666-8666-666666666666";
    await exports.default.fetch(
      api("alpha.localhost", `/api/organization/files/${scoreFileId}`, adminCookie, {
        body: pdfBytes,
        headers: {
          "content-length": String(pdfBytes.byteLength),
          "content-type": "application/pdf",
          "x-file-name": encodeURIComponent("Unapproved - Choral Score.pdf"),
        },
        method: "PUT",
      }),
    );
    await write(
      "alpha.localhost",
      `/api/organization/music/${piece.id}`,
      adminCookie,
      {
        ...requestFrom(piece),
        scoreFileIds: { primary: scoreFileId },
      },
      "PUT",
    );

    const venueId = await createVenue(adminCookie);
    const draftEvent = await write("alpha.localhost", "/api/organization/events", adminCookie, {
      rsvpDeadlineDate: "2030-01-01",
      setList: [{ composer: "Anon", pieceId: piece.id, title: "Unapproved Anthem" }],
      setListApproved: false,
      startsAt: "2026-12-01T19:00:00.000Z",
      title: "Draft Concert",
      type: "Performance",
      venueId,
    });
    const event = organizationEventSchema.parse(await draftEvent.json());

    const scoreRes = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/pieces/${piece.id}/score`, memberCookie),
    );
    expect(scoreRes.status).toBe(403);

    const bundleRes = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${event.id}/scores/bundle`, memberCookie),
    );
    expect(bundleRes.status).toBe(403);
  });

  it("rejects unauthenticated score access and cross-organization piece lookups", async () => {
    const adminCookie = await signIn();
    const bravoPiece = organizationMusicPieceResponseSchema.parse(
      await (
        await write("bravo.localhost", "/api/organization/music", adminCookie, {
          title: "Bravo Secret",
        })
      ).json(),
    );

    const anonymousRes = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/pieces/${bravoPiece.id}/score`),
    );
    expect(anonymousRes.status).toBe(401);

    const crossOrgRes = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/pieces/${bravoPiece.id}/score`, adminCookie),
    );
    expect(crossOrgRes.status).toBe(404);
  });

  it("rejects non-PDF and oversized score file assignments server-side", async () => {
    const adminCookie = await signIn();
    const piece = organizationMusicPieceResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/music", adminCookie, {
          title: "Validated Piece",
        })
      ).json(),
    );

    const textBytes = new TextEncoder().encode("not a pdf at all");
    const textFileId = "77777777-7777-4777-8777-777777777777";
    await exports.default.fetch(
      api("alpha.localhost", `/api/organization/files/${textFileId}`, adminCookie, {
        body: textBytes,
        headers: {
          "content-length": String(textBytes.byteLength),
          "content-type": "text/plain",
          "x-file-name": encodeURIComponent("notes.txt"),
        },
        method: "PUT",
      }),
    );
    const textAttach = await write(
      "alpha.localhost",
      `/api/organization/music/${piece.id}`,
      adminCookie,
      { ...requestFrom(piece), scoreFileIds: { primary: textFileId } },
      "PUT",
    );
    expect(textAttach.status).toBe(409);
    expect(await textAttach.json()).toMatchObject({ code: "music_score_file_invalid" });

    const pdfBytes = new TextEncoder().encode("%PDF-1.4 small but inflated score");
    const pdfFileId = "88888888-8888-4888-8888-888888888888";
    await exports.default.fetch(
      api("alpha.localhost", `/api/organization/files/${pdfFileId}`, adminCookie, {
        body: pdfBytes,
        headers: {
          "content-length": String(pdfBytes.byteLength),
          "content-type": "application/pdf",
          "x-file-name": encodeURIComponent("Big - Choral Score.pdf"),
        },
        method: "PUT",
      }),
    );
    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE private_files SET size_bytes = ? WHERE id = ?",
          21 * 1024 * 1024,
          pdfFileId,
        );
        return null;
      },
    );
    const oversizedAttach = await write(
      "alpha.localhost",
      `/api/organization/music/${piece.id}`,
      adminCookie,
      { ...requestFrom(piece), scoreFileIds: { primary: pdfFileId } },
      "PUT",
    );
    expect(oversizedAttach.status).toBe(409);
    expect(await oversizedAttach.json()).toMatchObject({ code: "music_score_file_invalid" });
  });

  it("rejects score bundles whose declared size exceeds the download cap", async () => {
    const adminCookie = await signIn();
    const pdfBytes = new TextEncoder().encode("%PDF-1.4 heavy score");
    const pieceIds: string[] = [];
    const scoreFileIds = [
      "99999999-9999-4999-8999-999999999999",
      "99999999-9999-4999-8999-999999999998",
      "99999999-9999-4999-8999-999999999997",
    ];
    for (const [index, fileId] of scoreFileIds.entries()) {
      const piece = organizationMusicPieceResponseSchema.parse(
        await (
          await write("alpha.localhost", "/api/organization/music", adminCookie, {
            title: `Heavy Piece ${String(index)}`,
          })
        ).json(),
      );
      pieceIds.push(piece.id);
      await exports.default.fetch(
        api("alpha.localhost", `/api/organization/files/${fileId}`, adminCookie, {
          body: pdfBytes,
          headers: {
            "content-length": String(pdfBytes.byteLength),
            "content-type": "application/pdf",
            "x-file-name": encodeURIComponent(`Heavy ${String(index)} - Choral Score.pdf`),
          },
          method: "PUT",
        }),
      );
      const attached = await write(
        "alpha.localhost",
        `/api/organization/music/${piece.id}`,
        adminCookie,
        { ...requestFrom(piece), scoreFileIds: { primary: fileId } },
        "PUT",
      );
      expect(attached.status).toBe(200);
    }

    const venueId = await createVenue(adminCookie);
    const draftEvent = await write("alpha.localhost", "/api/organization/events", adminCookie, {
      rsvpDeadlineDate: "2030-01-01",
      setList: pieceIds.map((pieceId, index) => ({
        composer: "Anon",
        pieceId,
        title: `Heavy Piece ${String(index)}`,
      })),
      setListApproved: true,
      startsAt: "2026-12-01T19:00:00.000Z",
      title: "Heavy Concert",
      type: "Performance",
      venueId,
    });
    const event = organizationEventSchema.parse(await draftEvent.json());

    await runInDurableObject<OrganizationStore, null>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE private_files SET size_bytes = ? WHERE id IN (?, ?, ?)",
          20 * 1024 * 1024,
          scoreFileIds[0],
          scoreFileIds[1],
          scoreFileIds[2],
        );
        return null;
      },
    );

    const bundleRes = await exports.default.fetch(
      api("alpha.localhost", `/api/singer/events/${event.id}/scores/bundle`, adminCookie),
    );
    expect(bundleRes.status).toBe(413);
    expect(await bundleRes.json()).toMatchObject({ code: "score_bundle_too_large" });
  });
});
