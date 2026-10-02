import {
  organizationEventSchema,
  organizationMusicPieceSchema,
  type OrganizationEvent,
  type OrganizationMusicPiece,
  type OrganizationProfile,
  type OrganizationVenue,
} from "@choir/contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as authApiModule from "../../../auth/api";
import * as api from "../../../auth/api";
import { SetListManager } from "./controller";

vi.mock("../../../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof authApiModule>();
  return {
    ...actual,
    getOrganizationCalendarSettings: vi.fn(),
    listOrganizationEvents: vi.fn(),
    listOrganizationMusic: vi.fn(),
    listOrganizationProfiles: vi.fn(),
    listOrganizationVenues: vi.fn(),
  };
});

function performance(
  id: string,
  title: string,
  startsAt: string,
  options: {
    readonly approved?: boolean;
    readonly transitionSeconds?: number;
    readonly setListTitle?: string;
  } = {},
): OrganizationEvent {
  return organizationEventSchema.parse({
    createdAt: "2025-01-01T00:00:00.000Z",
    id,
    setList: options.setListTitle ? [{ title: options.setListTitle, type: "song" }] : [],
    setListApproved: options.approved ?? false,
    setListDefaultTransitionSeconds: options.transitionSeconds ?? 0,
    startsAt,
    title,
    type: "Performance",
    updatedAt: "2025-01-01T00:00:00.000Z",
  });
}

const defaultEvent = performance(
  "11111111-1111-4111-8111-111111111111",
  "Today Performance",
  "2025-01-15T12:00:00.000Z",
  { approved: false, setListTitle: "Today song", transitionSeconds: 25 },
);
const pastEvent = performance(
  "22222222-2222-4222-8222-222222222222",
  "Past Performance",
  "2025-01-10T12:00:00.000Z",
  { approved: true, setListTitle: "Past song", transitionSeconds: 40 },
);
const futureEvent = performance(
  "33333333-3333-4333-8333-333333333333",
  "Future Performance",
  "2025-02-15T12:00:00.000Z",
  { setListTitle: "Future song", transitionSeconds: 50 },
);
const music: readonly OrganizationMusicPiece[] = [];
const profiles: readonly OrganizationProfile[] = [];
const venues: readonly OrganizationVenue[] = [];

async function flushResourceLoad(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SetListManager default Performance selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: new Date("2025-01-15T17:00:00.000Z") });
    vi.mocked(api.listOrganizationEvents).mockResolvedValue([futureEvent, pastEvent, defaultEvent]);
    vi.mocked(api.listOrganizationMusic).mockResolvedValue(music);
    vi.mocked(api.listOrganizationProfiles).mockResolvedValue(profiles);
    vi.mocked(api.listOrganizationVenues).mockResolvedValue(venues);
    vi.mocked(api.getOrganizationCalendarSettings).mockResolvedValue({
      timezone: "America/New_York",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  it("selects the closest eligible Performance and initializes its full draft", async () => {
    render(<SetListManager enabled />);
    await flushResourceLoad();

    expect(screen.getByRole("combobox", { name: "Select event" })).toHaveValue(defaultEvent.id);
    expect(screen.getByText("Today song")).toBeInTheDocument();
    expect(screen.getByLabelText("Between songs")).toHaveValue(25);
    expect(screen.getAllByRole("checkbox", { name: /approved/i })[0]).not.toBeChecked();
  });

  it("honors a valid deep link, rejects invalid IDs, and uses URL eventId when supplied", async () => {
    const linked = render(<SetListManager enabled initialEventId={pastEvent.id} />);
    await flushResourceLoad();
    expect(screen.getByRole("combobox", { name: "Select event" })).toHaveValue(pastEvent.id);
    expect(screen.getByText("Past song")).toBeInTheDocument();
    expect(screen.getByLabelText("Between songs")).toHaveValue(40);
    expect(screen.getAllByRole("checkbox", { name: /approved/i })[0]).toBeChecked();
    linked.unmount();

    const invalid = render(<SetListManager enabled initialEventId="invalid-event-id" />);
    await flushResourceLoad();
    expect(screen.getByRole("combobox", { name: "Select event" })).toHaveValue(defaultEvent.id);
    invalid.unmount();

    window.history.replaceState({}, "", `/admin/setlists?eventId=${futureEvent.id}`);
    render(<SetListManager enabled />);
    await flushResourceLoad();
    expect(screen.getByRole("combobox", { name: "Select event" })).toHaveValue(futureEvent.id);
    expect(screen.getByText("Future song")).toBeInTheDocument();
  });

  it("preserves manual selection and edits when resources reload", async () => {
    const { rerender } = render(<SetListManager enabled />);
    await flushResourceLoad();
    const eventSelect = screen.getByRole("combobox", { name: "Select event" });
    fireEvent.change(eventSelect, { target: { value: pastEvent.id } });
    const transitionInput = screen.getByLabelText("Between songs");
    fireEvent.change(transitionInput, { target: { value: "73" } });
    expect(screen.getByRole("combobox", { name: "Select event" })).toHaveValue(pastEvent.id);
    expect(screen.getByLabelText("Between songs")).toHaveValue(73);

    rerender(<SetListManager enabled={false} />);
    rerender(<SetListManager enabled />);
    await flushResourceLoad();

    expect(screen.getByRole("combobox", { name: "Select event" })).toHaveValue(pastEvent.id);
    expect(screen.getByLabelText("Between songs")).toHaveValue(73);
    expect(screen.getByText("Past song")).toBeInTheDocument();
    expect(api.listOrganizationEvents).toHaveBeenCalledTimes(2);
  });
});

it("preserves the focused keyboard handle when a movement leaves and rejoins a group", async () => {
  const parent = organizationMusicPieceSchema.parse({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Suite",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  });
  const children = ["First", "Second"].map((title, index) =>
    organizationMusicPieceSchema.parse({
      ...parent,
      id:
        index === 0
          ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
          : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      parentId: parent.id,
      title,
    }),
  );
  const items = children.map((piece, index) => ({
    id: `movement-${String(index)}`,
    pieceId: piece.id,
    title: piece.title,
    type: "song" as const,
  }));
  vi.mocked(api.listOrganizationEvents).mockResolvedValue([
    { ...defaultEvent, setList: [...items, { id: "other", title: "Other", type: "song" }] },
  ]);
  vi.mocked(api.listOrganizationMusic).mockResolvedValue([parent, ...children]);
  vi.mocked(api.listOrganizationProfiles).mockResolvedValue([]);
  vi.mocked(api.listOrganizationVenues).mockResolvedValue([]);
  vi.mocked(api.getOrganizationCalendarSettings).mockResolvedValue({ timezone: "UTC" });
  render(<SetListManager enabled initialEventId={defaultEvent.id} />);
  await flushResourceLoad();
  const handle = screen.getByRole("button", { name: "Reorder Second, position 2 of 3" });
  handle.focus();
  fireEvent.keyDown(handle, { key: " " });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  expect(handle).toHaveFocus();
  expect(handle).toHaveAccessibleName("Reordering Second, position 3 of 3");
  fireEvent.keyDown(handle, { key: "ArrowUp" });
  expect(handle).toHaveFocus();
  expect(handle).toHaveAccessibleName("Reordering Second, position 2 of 3");
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  fireEvent.keyDown(handle, { key: "Escape" });
  expect(handle).toHaveFocus();
  expect(handle).toHaveAccessibleName("Reorder Second, position 2 of 3");
});
