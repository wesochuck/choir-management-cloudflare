import { expect, test, type Page } from "@playwright/test";
import { buildSingerEvent, buildSingerLearningTrackPiece, fixtureIds } from "./fixtures/builders";
import { installOrganizationApi } from "./fixtures/apiMocks";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get() {
        return 180;
      },
    });
    HTMLMediaElement.prototype.play = function () {
      this.dispatchEvent(new Event("loadedmetadata"));
      this.dispatchEvent(new Event("canplay"));
      this.dispatchEvent(new Event("play"));
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dispatchEvent(new Event("pause"));
    };
  });

  await page.route("**/api/organization/files/**", async (route) => {
    await route.fulfill({
      body: Buffer.from("mock-audio"),
      contentType: "audio/mpeg",
      status: 200,
    });
  });
});

function getPlaylist(page: Page, isMobile: boolean) {
  return isMobile
    ? page.locator(".sheet .public-player__queue-list")
    : page.locator(".public-player__desktop-panel .public-player__queue-list");
}

async function openSetListIfMobile(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: /Set list \(/i }).click();
    await expect(page.getByRole("dialog", { name: "Set List" })).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: /Set list \(/i })).not.toBeVisible();
    await expect(page.locator(".public-player__desktop-panel")).toBeVisible();
  }
}

async function closeSetListIfMobile(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: "Close Set List" }).click();
    await expect(page.getByRole("dialog", { name: "Set List" })).not.toBeVisible();
  }
}

async function expectSpaceBelowFilters(page: Page) {
  const filters = page.locator(".practice-player__filters");
  const player = page.locator(".public-player__layout-grid");
  await expect(player).toBeVisible();
  await expect(async () => {
    const filtersBounds = await filters.boundingBox();
    const playerBounds = await player.boundingBox();
    expect(filtersBounds).not.toBeNull();
    expect(playerBounds).not.toBeNull();
    if (!filtersBounds || !playerBounds) return;
    expect(playerBounds.y - (filtersBounds.y + filtersBounds.height)).toBeGreaterThanOrEqual(16);
  }).toPass();
}

test("displays published set lists tab by default with approved performance program order and cues", async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name.includes("mobile");
  const pieceId1 = "11111111-2222-4333-8444-555555555551";
  const pieceId2 = "11111111-2222-4333-8444-555555555552";
  const unrecordedPieceId = "11111111-2222-4333-8444-555555555553";

  const eventId = "99999999-8888-4777-8666-555555555555";

  const api = await installOrganizationApi(page, {
    modules: ["practice_player"],
    role: "member",
    user: {
      email: "singer.tenor@example.test",
      name: "Tenor Singer",
      userId: fixtureIds.browserProfileId,
    },
  });

  api.memberProfile.update({
    displayName: "Tenor Singer",
    voicePart: "T2",
  });

  api.learningTracks.set([
    buildSingerLearningTrackPiece({
      composer: "American Folk",
      id: pieceId1,
      title: "O Shenandoah",
      trackFileIds: {
        all: "aaaaaaaa-0000-4000-8000-000000000001",
        tenor2: "aaaaaaaa-0000-4000-8000-000000000002",
      },
    }),
    buildSingerLearningTrackPiece({
      composer: "Traditional Spiritual",
      id: pieceId2,
      title: "Down by the Riverside",
      trackFileIds: {
        alto: "aaaaaaaa-0000-4000-8000-000000000003",
      },
    }),
    buildSingerLearningTrackPiece({
      composer: "Anonymous",
      id: unrecordedPieceId,
      title: "Unrecorded Folk Song",
      trackFileIds: {},
    }),
  ]);

  api.singerEvents.set([
    buildSingerEvent({
      id: eventId,
      practice: {
        sourceEventId: eventId,
        status: "available",
        trackCount: 2,
      },
      setList: [
        { pieceId: pieceId1, title: "O Shenandoah", type: "song" },
        { cueInstruction: "15 Minute Pause", title: "Intermission", type: "intermission" },
        { pieceId: pieceId2, title: "Down by the Riverside", type: "song" },
        { pieceId: pieceId1, title: "O Shenandoah (Encore)", type: "song" },
        { pieceId: unrecordedPieceId, title: "Unrecorded Folk Song", type: "song" },
      ],
      startsAt: "2027-05-15T19:30:00.000Z",
      title: "Spring Choral Gala",
      type: "Performance",
    }),
  ]);

  await page.goto("/practice");

  await expect(page.getByRole("tab", { name: "Published set lists" })).toHaveAttribute(
    "data-state",
    "active",
  );

  const picker = page.getByLabel("Choose a performance");
  await expect(picker).toBeVisible();
  await expect(picker).toHaveValue(eventId);

  await expect(page.getByText("3 playable of 4 music selections", { exact: false })).toBeVisible();
  await expectSpaceBelowFilters(page);

  await openSetListIfMobile(page, isMobile);
  const playlistItems = getPlaylist(page, isMobile).locator("> li");
  await expect(playlistItems).toHaveCount(5);

  await expect(playlistItems.nth(0)).toContainText("O Shenandoah");
  await expect(playlistItems.nth(1)).toContainText("Intermission");
  await expect(playlistItems.nth(1).locator(".public-player__item-track--cue")).toContainText(
    "Intermission",
  );

  await expect(playlistItems.nth(2)).toContainText("Down by the Riverside");
  await expect(playlistItems.nth(2)).toContainText(/alto fallback/i);

  await expect(playlistItems.nth(3)).toContainText("O Shenandoah (Encore)");

  await expect(playlistItems.nth(4)).toContainText("Unrecorded Folk Song");
  await expect(playlistItems.nth(4)).toContainText("Unavailable");

  await closeSetListIfMobile(page, isMobile);
  const playableCheckbox = page.getByRole("checkbox", { name: "Playable only" });
  await playableCheckbox.check();

  await openSetListIfMobile(page, isMobile);
  await expect(getPlaylist(page, isMobile).locator("> li")).toHaveCount(3);
  await expect(
    getPlaylist(page, isMobile).getByRole("button", { name: /Down by the Riverside/ }),
  ).toBeVisible();
  await expect(
    getPlaylist(page, isMobile).getByRole("button", { name: /Unrecorded Folk Song/ }),
  ).not.toBeVisible();
  await expect(getPlaylist(page, isMobile).getByText("Intermission")).not.toBeVisible();
});

test("cycles through repeat modes in published set list player", async ({ page }) => {
  const pieceId1 = "22222222-3333-4444-8555-666666666661";
  const eventId = "88888888-7777-4666-8555-444444444444";

  const api = await installOrganizationApi(page, {
    modules: ["practice_player"],
    role: "member",
  });

  api.learningTracks.set([
    buildSingerLearningTrackPiece({
      id: pieceId1,
      title: "Choral Anthem",
      trackFileIds: {
        all: "aaaaaaaa-0000-4000-8000-000000000004",
      },
    }),
  ]);

  api.singerEvents.set([
    buildSingerEvent({
      id: eventId,
      practice: {
        sourceEventId: eventId,
        status: "available",
        trackCount: 1,
      },
      setList: [{ pieceId: pieceId1, title: "Choral Anthem", type: "song" }],
      startsAt: "2027-06-20T20:00:00.000Z",
      title: "Summer Concert",
      type: "Performance",
    }),
  ]);

  await page.goto("/practice");

  const repeatButton = page.getByRole("button", { name: "No repeat" });
  await expect(repeatButton).toBeVisible();

  await repeatButton.click();
  await expect(page.getByRole("button", { name: "Repeat all" })).toBeVisible();

  await page.getByRole("button", { name: "Repeat all" }).click();
  await expect(page.getByRole("button", { name: "Repeat one" })).toBeVisible();

  await page.getByRole("button", { name: "Repeat one" }).click();
  await expect(page.getByRole("button", { name: "No repeat" })).toBeVisible();
});

test("supports deep linking to approved performance and handles stale links", async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name.includes("mobile");
  const pieceId1 = "33333333-4444-4555-8666-777777777771";
  const eventId = "77777777-6666-4555-8444-333333333333";

  const api = await installOrganizationApi(page, {
    modules: ["practice_player"],
    role: "member",
  });

  api.learningTracks.set([
    buildSingerLearningTrackPiece({
      id: pieceId1,
      title: "Gala Opener",
      trackFileIds: { all: "aaaaaaaa-0000-4000-8000-000000000005" },
    }),
  ]);

  api.singerEvents.set([
    buildSingerEvent({
      id: eventId,
      practice: {
        sourceEventId: eventId,
        status: "available",
        trackCount: 1,
      },
      setList: [{ pieceId: pieceId1, title: "Gala Opener", type: "song" }],
      startsAt: "2027-09-10T19:00:00.000Z",
      title: "Autumn Showcase",
      type: "Performance",
    }),
  ]);

  await page.goto(`/practice?eventId=${eventId}`);
  await expect(page.getByRole("tab", { name: "Published set lists" })).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(page.getByLabel("Choose a performance")).toHaveValue(eventId);
  await openSetListIfMobile(page, isMobile);
  await expect(
    getPlaylist(page, isMobile).getByRole("button", { name: /Gala Opener/ }),
  ).toBeVisible();

  await closeSetListIfMobile(page, isMobile);
  await page.goto("/practice?eventId=stale-event-id");
  await expect(page.getByText("The requested set list is no longer available.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "All tracks" })).toHaveAttribute(
    "data-state",
    "active",
  );
});

test("allows switching to all tracks tab with scoped search", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name.includes("mobile");
  const pieceId1 = "44444444-5555-4666-8777-888888888881";
  const pieceId2 = "44444444-5555-4666-8777-888888888882";
  const eventId = "66666666-5555-4444-8333-222222222222";

  const api = await installOrganizationApi(page, {
    modules: ["practice_player"],
    role: "member",
  });

  api.learningTracks.set([
    buildSingerLearningTrackPiece({
      composer: "Wolfgang Amadeus Mozart",
      id: pieceId1,
      title: "Ave Verum Corpus",
      trackFileIds: { all: "aaaaaaaa-0000-4000-8000-000000000006" },
    }),
    buildSingerLearningTrackPiece({
      composer: "Gabriel Fauré",
      id: pieceId2,
      title: "Cantique de Jean Racine",
      trackFileIds: { all: "aaaaaaaa-0000-4000-8000-000000000007" },
    }),
  ]);

  api.singerEvents.set([
    buildSingerEvent({
      id: eventId,
      practice: {
        sourceEventId: eventId,
        status: "available",
        trackCount: 1,
      },
      setList: [{ pieceId: pieceId1, title: "Ave Verum Corpus", type: "song" }],
      startsAt: "2027-11-20T19:00:00.000Z",
      title: "Classical Evening",
      type: "Performance",
    }),
  ]);

  await page.goto("/practice");

  await page.getByRole("tab", { name: "All tracks" }).click();
  await expect(page.getByRole("tab", { name: "All tracks" })).toHaveAttribute(
    "data-state",
    "active",
  );

  const searchInput = page.getByRole("searchbox", { name: "Search tracks" });
  await expectSpaceBelowFilters(page);
  await searchInput.fill("Fauré");

  await openSetListIfMobile(page, isMobile);
  await expect(
    getPlaylist(page, isMobile).getByRole("button", { name: /Cantique de Jean Racine/ }),
  ).toBeVisible();
  await expect(
    getPlaylist(page, isMobile).getByRole("button", { name: /Ave Verum Corpus/ }),
  ).not.toBeVisible();
});
