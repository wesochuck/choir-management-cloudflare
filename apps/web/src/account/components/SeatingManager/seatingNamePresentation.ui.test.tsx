import { organizationProfileSchema, type OrganizationSeatingChartRequest } from "@choir/contracts";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { SeatTile } from "./chartParts";
import { useSeatingNamePresentation } from "./hooks/useSeatingNamePresentation";

const sampleProfile = organizationProfileSchema.parse({
  createdAt: "2025-01-01T00:00:00.000Z",
  displayName: "Ashley Cooper",
  globalStatus: "Active",
  id: "11111111-1111-4111-8111-111111111111",
  updatedAt: "2025-01-01T00:00:00.000Z",
  voicePart: "Soprano 1",
});

function createDomRect(width: number, height = 50): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
}

function MeasurementHarness({
  chart,
  seatWidth,
}: {
  readonly chart: OrganizationSeatingChartRequest;
  readonly seatWidth: number;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  useSeatingNamePresentation(canvasRef, chart);

  return (
    <div className="seating-editor-canvas" ref={canvasRef}>
      <div className="seating-row seating-row--canvas">
        <div
          className="seating-seat seating-seat--canvas seating-seat--assigned"
          ref={(node) => {
            if (node) {
              node.getBoundingClientRect = () => createDomRect(seatWidth);
            }
          }}
        >
          <span className="seating-seat__name-full">{sampleProfile.displayName}</span>
          <span aria-hidden="true" className="seating-seat__name-initials">
            AC
          </span>
        </div>
      </div>
    </div>
  );
}

describe("Seating name presentation consistency", () => {
  it("renders data-name-presentation on SeatTile and preserves accessible full name label", () => {
    const { rerender } = render(
      <SeatTile
        assigned={sampleProfile}
        label="Seat 1"
        mismatch={false}
        onActivate={() => undefined}
        onDrop={() => undefined}
        onRemove={() => undefined}
        presentation="initials"
        seatKey="0-0"
        suggestion={undefined}
      />,
    );

    const seat = screen.getByRole("button", {
      name: "Seat 1, assigned to Ashley Cooper",
    });
    expect(seat).toHaveAttribute("data-name-presentation", "initials");

    rerender(
      <SeatTile
        assigned={sampleProfile}
        label="Seat 1"
        mismatch={false}
        onActivate={() => undefined}
        onDrop={() => undefined}
        onRemove={() => undefined}
        presentation="full"
        seatKey="0-0"
        suggestion={undefined}
      />,
    );
    expect(seat).toHaveAttribute("data-name-presentation", "full");
  });

  it("dynamically resolves initials when seat width is narrow (<= 5.25rem)", () => {
    const dummyChart: OrganizationSeatingChartRequest = {
      assignments: { "0-0": sampleProfile.id },
      formationId: "columns-standard",
      name: "Test Chart",
      rowCounts: [1],
      sectionSuggestions: {},
      sortOrder: 0,
      venueId: null,
    };

    // 50px <= 84px (5.25 * 16px) -> "initials"
    const { container } = render(<MeasurementHarness chart={dummyChart} seatWidth={50} />);

    const row = container.querySelector(".seating-row--canvas");
    const seat = container.querySelector(".seating-seat--canvas");
    expect(row).toHaveAttribute("data-name-presentation", "initials");
    expect(seat).toHaveAttribute("data-name-presentation", "initials");
  });

  it("dynamically resolves full name when seat width is wide (> 5.25rem)", () => {
    const dummyChart: OrganizationSeatingChartRequest = {
      assignments: { "0-0": sampleProfile.id },
      formationId: "columns-standard",
      name: "Test Chart",
      rowCounts: [1],
      sectionSuggestions: {},
      sortOrder: 0,
      venueId: null,
    };

    // 120px > 84px (5.25 * 16px) -> "full"
    const { container } = render(<MeasurementHarness chart={dummyChart} seatWidth={120} />);

    const row = container.querySelector(".seating-row--canvas");
    const seat = container.querySelector(".seating-seat--canvas");
    expect(row).toHaveAttribute("data-name-presentation", "full");
    expect(seat).toHaveAttribute("data-name-presentation", "full");
  });

  it("freezes measurement during beforeprint and restores on afterprint", () => {
    const dummyChart: OrganizationSeatingChartRequest = {
      assignments: { "0-0": sampleProfile.id },
      formationId: "columns-standard",
      name: "Test Chart",
      rowCounts: [1],
      sectionSuggestions: {},
      sortOrder: 0,
      venueId: null,
    };

    const { container } = render(<MeasurementHarness chart={dummyChart} seatWidth={50} />);

    const row = container.querySelector(".seating-row--canvas");
    expect(row).toHaveAttribute("data-name-presentation", "initials");

    // Trigger beforeprint
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });

    // Change seat width mock to wide
    const seat = container.querySelector<HTMLElement>(".seating-seat--canvas");
    if (seat) {
      seat.getBoundingClientRect = () => createDomRect(150);
    }

    // Trigger ResizeObserver / measure while printing is true - should remain initials
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(row).toHaveAttribute("data-name-presentation", "initials");

    // Trigger afterprint - should now remeasure and update to full
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(row).toHaveAttribute("data-name-presentation", "full");
  });
});
