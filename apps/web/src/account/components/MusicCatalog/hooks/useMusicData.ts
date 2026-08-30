import type {
  OrganizationEvent,
  OrganizationMusicPiece,
  OrganizationRosterConfiguration,
  OrganizationVenue,
} from "@choir/contracts";
import { useEffect, useState } from "react";
import {
  getOrganizationCalendarSettings,
  getOrganizationMusicLibrarySettings,
  getOrganizationRosterConfiguration,
  listOrganizationEvents,
  listOrganizationMusic,
  listOrganizationVenues,
} from "../../../../auth/api";

export function useMusicData({
  enabled,
  setError,
}: {
  readonly enabled: boolean;
  readonly setError: (value: string | null) => void;
}) {
  const [pieces, setPieces] = useState<readonly OrganizationMusicPiece[]>([]);
  const [roster, setRoster] = useState<OrganizationRosterConfiguration | null>(null);
  const [events, setEvents] = useState<readonly OrganizationEvent[]>([]);
  const [venues, setVenues] = useState<readonly OrganizationVenue[]>([]);
  const [timezone, setTimezone] = useState("UTC");
  const [publisherSearchTemplate, setPublisherSearchTemplate] = useState("");
  const [defaultPageSize, setDefaultPageSize] = useState(100);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationMusic(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
      listOrganizationEvents(controller.signal),
      listOrganizationVenues(controller.signal),
      getOrganizationCalendarSettings(controller.signal),
      getOrganizationMusicLibrarySettings(controller.signal),
    ])
      .then(([catalog, configuration, nextEvents, nextVenues, calendarSettings, musicSettings]) => {
        setPieces(catalog);
        setRoster(configuration);
        setEvents(nextEvents);
        setVenues(nextVenues);
        setTimezone(calendarSettings.timezone);
        setPublisherSearchTemplate(musicSettings.publisherSearchTemplate);
        setDefaultPageSize(musicSettings.defaultPageSize);
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError("The music catalog could not be loaded.");
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled, setError]);

  return {
    defaultPageSize,
    events,
    pieces,
    publisherSearchTemplate,
    roster,
    setEvents,
    setPieces,
    timezone,
    venues,
  };
}
