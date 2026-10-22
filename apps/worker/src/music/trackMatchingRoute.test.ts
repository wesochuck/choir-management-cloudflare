import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { musicTrackImportMatchResponseSchema } from "@choir/contracts";
import type { WorkerHonoEnvironment } from "../routes/helpers";
import { registerRoutes } from "../routes/organizationMusicTrackImport";

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("../routes/helpers", () => ({ authorizeCalendarRoute: authorize }));
vi.mock("../organization/organizationMusic", () => ({
  attachOrganizationMusicTracks: vi.fn(),
  listOrganizationMusicPieces: vi
    .fn()
    .mockResolvedValue([
      { id: "11111111-1111-4111-8111-111111111111", title: "Shenandoah", trackFileIds: {} },
    ]),
  MusicRepositoryError: class extends Error {},
}));
vi.mock("../calendar/organizationCalendar", () => ({
  readOrganizationRosterConfiguration: vi
    .fn()
    .mockResolvedValue({ voiceParts: [{ label: "Low", fullName: "Low voices" }], sections: [] }),
}));
const body = {
  candidates: [{ pieceId: "11111111-1111-4111-8111-111111111111", title: "Shenandoah" }],
  groups: [{ groupId: "one", fileNames: ["Shenandoah.mp3"], inferredTitle: "Shenandoah" }],
  useAi: true,
};
const app = new Hono<WorkerHonoEnvironment>();
app.use("*", async (context, next) => {
  context.set("requestId", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  await next();
});
registerRoutes(app);
const run = vi.fn().mockResolvedValue({
  answers: {
    g0: { choice: "p0", confidence: 0.9, probabilities: { p0: 0.9, none: 0.1 }, type: "choice" },
  },
});
const bindings = { AI: { run }, APP_ENV: "staging", EXTERNAL_EFFECTS_MODE: "sandbox" };
const send = (data: unknown = body, testBindings: object = bindings) =>
  app.request(
    "/api/organization/music/track-import/match",
    { body: JSON.stringify(data), headers: { "content-type": "application/json" }, method: "POST" },
    testBindings,
  );

beforeEach(() => {
  run.mockClear();
  authorize.mockResolvedValue({
    ok: true,
    organizationId: "organization-alpha",
    userId: "manager",
  });
});

describe("track matching route", () => {
  it("only invokes Clef after manager authorization and explicit opt-in", async () => {
    const response = await send();
    expect(response.status).toBe(200);
    const result = musicTrackImportMatchResponseSchema.parse(await response.json());
    expect(result.model).toBe("@cf/cloudflare/clef-flash");
    expect(result.suggestions[0]?.suggestedPieceId).toBe(body.candidates[0]?.pieceId);
    expect(authorize).toHaveBeenCalledWith(expect.anything(), true);
    expect(run).toHaveBeenCalledWith(
      "@cf/cloudflare/clef-flash",
      expect.objectContaining({ model: "clef-flash" }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        tags: ["music-track-import", expect.stringMatching(/^org:[0-9a-f]{40}$/)],
      }),
    );
    const fallback = await send({ ...body, useAi: undefined });
    expect(musicTrackImportMatchResponseSchema.parse(await fallback.json()).model).toBe(
      "heuristic-v1",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404])("blocks unauthorized requests (%s) before inference", async (status) => {
    authorize.mockResolvedValue({ ok: false, status, code: "forbidden", message: "Access denied" });
    expect((await send()).status).toBe(status);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects invalid input before inference", async () => {
    expect((await send({ ...body, useAi: "yes" })).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    { ...bindings, APP_ENV: "local" },
    { ...bindings, EXTERNAL_EFFECTS_MODE: "fake" },
    { ...bindings, EXTERNAL_EFFECTS_MODE: "disabled" },
    { ...bindings, AI: undefined },
  ])("keeps unconfigured and fake environments offline", async (testBindings) => {
    expect((await send(body, testBindings)).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns safe, actionable provider errors", async () => {
    run.mockRejectedValueOnce(new Error("secret provider payload"));
    const response = await send();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret provider payload");
  });
});

it("rejects a foreign catalog candidate before inference", async () => {
  const response = await send({
    ...body,
    candidates: [{ pieceId: "22222222-2222-4222-8222-222222222222", title: "Foreign" }],
  });
  expect(response.status).toBe(400);
  expect(run).not.toHaveBeenCalled();
});

it("uses authoritative catalog and configured roster labels", async () => {
  const response = await send({
    ...body,
    configuredPartKeys: ["invented"],
    candidates: [{ ...body.candidates[0], title: "Untrusted replacement" }],
  });
  expect(response.status).toBe(200);
  const sent = JSON.stringify(run.mock.calls[0]);
  expect(sent).toContain("Shenandoah");
  expect(sent).not.toContain("Untrusted replacement");
  expect(sent).not.toContain("invented");
});
