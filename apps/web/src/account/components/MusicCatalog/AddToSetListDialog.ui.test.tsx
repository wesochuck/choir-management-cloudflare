import type {
  OrganizationEvent,
  OrganizationMusicPiece,
  OrganizationVenue,
} from "@choir/contracts";
import { organizationEventSchema } from "@choir/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddToSetListDialog } from "./AddToSetListDialog";

const selectedPiece: OrganizationMusicPiece = {
  arranger: "",
  catalogId: "CAT-1",
  composer: "Composer",
  copies: 1,
  createdAt: "2025-01-01T00:00:00.000Z",
  durationSeconds: 120,
  genres: [],
  id: "11111111-1111-4111-8111-111111111111",
  lastPerformedAt: null,
  notes: "",
  parentId: null,
  performanceCount: 0,
  purchaseDate: null,
  sectionBuckets: [],
  title: "Selected song",
  trackFileIds: {},
  updatedAt: "2025-01-01T00:00:00.000Z",
};

function performance(
  id: string,
  startsAt: string,
  type: "Performance" | "Rehearsal" = "Performance",
) {
  return organizationEventSchema.parse({
    createdAt: "2025-01-01T00:00:00.000Z",
    id,
    startsAt,
    title: id,
    type,
    updatedAt: "2025-01-01T00:00:00.000Z",
  });
}

const venues: readonly OrganizationVenue[] = [];

function renderDialog({
  events,
  open,
}: {
  readonly events: readonly OrganizationEvent[];
  readonly open: boolean;
}) {
  return (
    <AddToSetListDialog
      busy={false}
      error={null}
      events={events}
      key={open ? "open" : "closed"}
      onApply={vi.fn()}
      onClose={vi.fn()}
      open={open}
      selectedPieces={[selectedPiece]}
      timezone="America/New_York"
      venues={venues}
    />
  );
}

describe("AddToSetListDialog default Performance selection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to the closest eligible Performance and preserves a manual choice on rerender", () => {
    vi.useFakeTimers({ now: new Date("2025-01-15T17:00:00.000Z") });
    const farFuture = performance(
      "11111111-1111-4111-8111-111111111111",
      "2025-03-01T18:00:00.000Z",
    );
    const today = performance("22222222-2222-4222-8222-222222222222", "2025-01-15T12:00:00.000Z");
    const tomorrow = performance(
      "33333333-3333-4333-8333-333333333333",
      "2025-01-16T18:00:00.000Z",
    );
    const rehearsal = performance(
      "44444444-4444-4444-8444-444444444444",
      "2025-01-15T11:00:00.000Z",
      "Rehearsal",
    );
    const events = [farFuture, rehearsal, tomorrow, today];
    const { rerender } = render(renderDialog({ events, open: true }));
    const select = screen.getByRole("combobox", { name: "Concert / Performance" });

    expect(select).toHaveValue(today.id);

    fireEvent.change(select, { target: { value: farFuture.id } });
    rerender(renderDialog({ events: [today, tomorrow, farFuture, rehearsal], open: true }));
    expect(screen.getByRole("combobox", { name: "Concert / Performance" })).toHaveValue(
      farFuture.id,
    );
    expect(Array.from(select.querySelectorAll("option"), (option) => option.value)).toEqual(
      expect.arrayContaining([farFuture.id, tomorrow.id, today.id]),
    );
  });

  it("recomputes the fallback for each fresh opening and keeps create-new mode when none exist", () => {
    vi.useFakeTimers({ now: new Date("2025-01-15T17:00:00.000Z") });
    const today = performance("55555555-5555-4555-8555-555555555555", "2025-01-15T18:00:00.000Z");
    const later = performance("66666666-6666-4666-8666-666666666666", "2025-01-20T18:00:00.000Z");
    const { rerender } = render(renderDialog({ events: [later, today], open: true }));
    expect(screen.getByRole("combobox", { name: "Concert / Performance" })).toHaveValue(today.id);

    rerender(renderDialog({ events: [later, today], open: false }));
    vi.setSystemTime(new Date("2025-01-21T17:00:00.000Z"));
    rerender(renderDialog({ events: [later, today], open: true }));
    expect(screen.getByRole("combobox", { name: "Concert / Performance" })).toHaveValue(later.id);

    rerender(renderDialog({ events: [], open: false }));
    rerender(renderDialog({ events: [], open: true }));
    expect(screen.getByLabelText("Create new concert")).toBeChecked();
    expect(screen.getByLabelText("Concert / Performance title")).toBeInTheDocument();
  });
});
