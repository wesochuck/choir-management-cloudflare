import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PlayerArtwork,
  PlayerHeader,
  PlayerPartSelector,
  PlayerProgress,
  PlayerRehearsalOptions,
  PlayerSecondaryControls,
  PlayerSetList,
  PlayerTrackMetadata,
  PlayerTransport,
  type PlayerDetails,
  type PlayerPlaylistItem,
} from "./player";
import { PublicPlayerView } from "./PublicPlayerView";
import { formatVoicePartName, sortVoiceParts } from "./playerVoiceParts";

const firstItem: PlayerPlaylistItem = {
  arranger: "Arranger One",
  composer: "Mozart",
  durationSeconds: 240,
  isFeaturedNumber: true,
  pieceId: "p-1",
  title: "Alleluia",
  trackFileIds: {
    alto: "file-alto",
    soprano: "file-soprano",
    soprano1: "file-soprano1",
    soprano2: "file-soprano2",
    tenor: "file-tenor",
    tutti: "file-tutti",
  },
};

const secondItem: PlayerPlaylistItem = {
  composer: "Bach",
  durationSeconds: 180,
  pieceId: "p-2",
  title: "Jesu, Joy",
  trackFileIds: {
    tutti: "file-bach-tutti",
  },
};

const mockItems: PlayerPlaylistItem[] = [firstItem, secondItem];

const mockDetails: PlayerDetails = {
  eventArtworkFileId: "artwork-uuid-123",
  eventId: "event-uuid-123",
  eventStartsAt: "2026-10-15T19:00:00.000Z",
  eventTitle: "Autumn Choral Festival",
  items: mockItems,
  performerLabel: "Chamber Singer",
  profileName: "Alice",
};

describe("PublicPlayerView Components", () => {
  describe("PlayerHeader", () => {
    it("renders event title, formatted date, and singer welcome message", () => {
      const html = renderToString(<PlayerHeader details={mockDetails} />);
      expect(html).toContain("Autumn Choral Festival");
      expect(html).toContain("Welcome, ");
      expect(html).toContain("Alice");
    });

    it("omits greeting when profileName is not provided", () => {
      const noProfileDetails: PlayerDetails = {
        eventArtworkFileId: "artwork-uuid-123",
        eventId: "event-uuid-123",
        eventStartsAt: "2026-10-15T19:00:00.000Z",
        eventTitle: "Autumn Choral Festival",
        items: mockItems,
        performerLabel: "Chamber Singer",
      };
      const html = renderToString(<PlayerHeader details={noProfileDetails} />);
      expect(html).toContain("Autumn Choral Festival");
      expect(html).not.toContain("Welcome,");
    });
  });

  describe("PlayerArtwork", () => {
    it("renders artwork image when artworkUrl is provided", () => {
      const html = renderToString(
        <PlayerArtwork
          artworkUrl="/api/public/player/media/artwork-uuid-123?token=test"
          eventTitle="Autumn Choral Festival"
        />,
      );
      expect(html).toContain("<img");
      expect(html).toContain('src="/api/public/player/media/artwork-uuid-123?token=test"');
      expect(html).toContain('alt="Autumn Choral Festival artwork"');
    });

    it("renders placeholder with musical SVG when artworkUrl is null", () => {
      const html = renderToString(
        <PlayerArtwork artworkUrl={null} eventTitle="Autumn Choral Festival" />,
      );
      expect(html).not.toContain("<img");
      expect(html).toContain("public-player__artwork--placeholder");
      expect(html).toContain("<svg");
    });
  });

  describe("PlayerTrackMetadata", () => {
    it("renders song title, composer, arranger, and track badge", () => {
      const html = renderToString(
        <PlayerTrackMetadata
          activeTrackKey="soprano"
          currentTrack={{ fallback: false, fileId: "file-soprano", key: "soprano" }}
          item={firstItem}
        />,
      );
      expect(html).toContain("Alleluia");
      expect(html).toContain("Mozart");
      expect(html).toContain("arr. Arranger One");
      expect(html).toContain("SOPRANO");
    });

    it("renders visible Tutti fallback notification when specific part is unavailable", () => {
      const html = renderToString(
        <PlayerTrackMetadata
          activeTrackKey="soprano"
          currentTrack={{ fallback: true, fileId: "file-bach-tutti", key: "tutti" }}
          item={secondItem}
        />,
      );
      expect(html).toContain("Jesu, Joy");
      expect(html).toContain("Playing Tutti — ");
      expect(html).toContain("SOPRANO");
      expect(html).toContain("track unavailable");
      expect(html).toContain('role="status"');
    });
  });

  describe("PlayerPartSelector", () => {
    it("renders trigger button with Voice Part label and formatted active track", () => {
      const html = renderToString(
        <PlayerPartSelector
          activeTrackKey="tenor1"
          onSelectTrackKey={vi.fn()}
          trackKeys={["tutti", "alto", "soprano", "tenor1", "tenor2", "bass"]}
        />,
      );
      expect(html).toContain('aria-haspopup="dialog"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain("Voice Part");
      expect(html).toContain("Tenor 1");
    });

    it("renders bottom sheet dialog with radio options when open", () => {
      const html = renderToString(
        <PlayerPartSelector
          activeTrackKey="tenor1"
          defaultOpen={true}
          onSelectTrackKey={vi.fn()}
          trackKeys={["tutti", "alto", "soprano", "tenor1", "tenor2", "bass"]}
        />,
      );
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain("Choose Voice Part");
      expect(html).toContain('role="radiogroup"');
      expect(html).toContain('aria-checked="true"');
      expect(html).toContain("Soprano");
      expect(html).toContain("Alto");
      expect(html).toContain("Tenor 1");
      expect(html).toContain("Tenor 2");
      expect(html).toContain("Bass");
      expect(html).toContain("Choir Mix");
    });

    it("correctly formats voice part names with human-friendly labels", () => {
      expect(formatVoicePartName("tutti")).toBe("Choir Mix");
      expect(formatVoicePartName("tenor1")).toBe("Tenor 1");
      expect(formatVoicePartName("soprano2")).toBe("Soprano 2");
      expect(formatVoicePartName("bass")).toBe("Bass");
      expect(formatVoicePartName("alto")).toBe("Alto");
    });

    it("sorts voice parts in natural choral order with Choir Mix at the end", () => {
      const parts = ["tutti", "bass", "tenor1", "soprano", "alto", "tenor2"];
      const sorted = sortVoiceParts(parts);
      expect(sorted).toEqual(["soprano", "alto", "tenor1", "tenor2", "bass", "tutti"]);
    });
  });

  describe("PlayerProgress", () => {
    it("renders range input with full ARIA value accessibility attributes", () => {
      const html = renderToString(
        <PlayerProgress currentTime={90} duration={240} onSeek={vi.fn()} title="Alleluia" />,
      );
      expect(html).toContain('aria-label="Seek Alleluia"');
      expect(html).toContain('aria-valuemin="0"');
      expect(html).toContain('aria-valuemax="240"');
      expect(html).toContain('aria-valuenow="90"');
      expect(html).toContain('aria-valuetext="1:30 of 4:00"');
      expect(html).toContain("1:30");
      expect(html).toContain("4:00");
    });
  });

  describe("PlayerTransport", () => {
    it("renders previous, play/pause, next buttons with correct states", () => {
      const html = renderToString(
        <PlayerTransport
          currentIndex={0}
          loopMode="none"
          onNext={vi.fn()}
          onPrevious={vi.fn()}
          onTogglePlay={vi.fn()}
          playableCount={2}
          playing={false}
        />,
      );
      expect(html).toContain('aria-label="Previous track"');
      expect(html).toContain("disabled"); // First track, loopMode !== all
      expect(html).toContain('aria-label="Play"');
      expect(html).toContain('aria-label="Next track"');
    });

    it("enables previous button when on first track if loopMode is all", () => {
      const html = renderToString(
        <PlayerTransport
          currentIndex={0}
          loopMode="all"
          onNext={vi.fn()}
          onPrevious={vi.fn()}
          onTogglePlay={vi.fn()}
          playableCount={2}
          playing={true}
        />,
      );
      expect(html).not.toContain('disabled=""');
      expect(html).toContain('aria-label="Pause"');
    });
  });

  describe("PlayerSecondaryControls", () => {
    it("renders repeat toggle, set list drawer trigger, and settings trigger", () => {
      const html = renderToString(
        <PlayerSecondaryControls
          loopMode="all"
          onOpenQueue={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleLoop={vi.fn()}
          queueCount={2}
        />,
      );
      expect(html).toContain('aria-label="Repeat all"');
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain("Repeat all");
      expect(html).toContain('aria-label="Set list (2 tracks)"');
      expect(html).toContain("Set List (");
      expect(html).toContain("Settings");
    });
  });

  describe("PlayerSetList", () => {
    it("renders tracks with now-playing indicator and download buttons", () => {
      const html = renderToString(
        <PlayerSetList
          activeTrackKey="soprano"
          currentIndex={0}
          items={mockItems}
          onSelectItem={vi.fn()}
          playableItems={mockItems}
          token="test-token"
        />,
      );
      expect(html).toContain("Alleluia");
      expect(html).toContain("Now Playing");
      expect(html).toContain("Jesu, Joy");
      expect(html).toContain("Tutti fallback");
      expect(html).toContain('href="/api/public/player/media/file-soprano?token=test-token"');
    });
    it("renders items with null or missing fields cleanly", () => {
      const itemWithNulls: PlayerPlaylistItem = {
        arranger: null,
        composer: null,
        durationSeconds: null,
        isFeaturedNumber: null,
        notes: null,
        pieceId: null,
        title: "Simple Chant",
        trackFileIds: { tutti: "file-chant" },
      };
      const html = renderToString(
        <PlayerSetList
          activeTrackKey="tutti"
          currentIndex={0}
          items={[itemWithNulls]}
          onSelectItem={vi.fn()}
          playableItems={[itemWithNulls]}
          token="test-token"
        />,
      );
      expect(html).toContain("Simple Chant");
      expect(html).toContain("Now Playing");
    });
  });

  describe("PlayerRehearsalOptions", () => {
    it("renders start at, volume slider, gap dropdown, and download current track", () => {
      const html = renderToString(
        <PlayerRehearsalOptions
          countdown={null}
          currentTrackFileId="file-soprano"
          gapSeconds={5}
          onChangeGapSeconds={vi.fn()}
          onChangeStartAt={vi.fn()}
          onChangeVolume={vi.fn()}
          startAt={10}
          token="test-token"
          volume={85}
        />,
      );
      expect(html).toContain("Start track at");
      expect(html).toContain('value="10"');
      expect(html).toContain("Volume");
      expect(html).toContain("85");
      expect(html).toContain("Gap between tracks");
      expect(html).toContain("Download Current Track");
      expect(html).toContain('href="/api/public/player/media/file-soprano?token=test-token"');
    });

    it("hides volume slider when showVolume is false for mobile practice player", () => {
      const html = renderToString(
        <PlayerRehearsalOptions
          countdown={null}
          currentTrackFileId="file-soprano"
          gapSeconds={5}
          onChangeGapSeconds={vi.fn()}
          onChangeStartAt={vi.fn()}
          showVolume={false}
          startAt={10}
          token="test-token"
        />,
      );
      expect(html).toContain("Start track at");
      expect(html).not.toContain("Volume");
      expect(html).toContain("Gap between tracks");
      expect(html).toContain("Download Current Track");
    });
  });

  describe("PublicPlayerView", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("renders required link notice when no token query parameter is present", () => {
      const html = renderToString(<PublicPlayerView />);
      expect(html).toContain("Player Link Required");
      expect(html).toContain("Please use the practice-player link from your Organization.");
    });

    it("does not clear query parameters or call replaceState on mount", () => {
      const replaceStateSpy = vi.fn();
      vi.stubGlobal("window", {
        history: { replaceState: replaceStateSpy },
        location: { search: "?token=sample-token-123" },
      });

      const html = renderToString(<PublicPlayerView />);
      expect(html).toContain("Loading practice player…");
      expect(replaceStateSpy).not.toHaveBeenCalled();
    });
  });
});
