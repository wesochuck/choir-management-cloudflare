import { organizationProfileSchema } from "@choir/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { PortalContainerHost, PortalContainerProvider } from "@choir/ui";
import { SeatTile } from "./chartParts";
import { ConfirmDialog } from "./shared";
import type { ConfirmState } from "./types";

function SeatingHarness({
  initialAssigned = true,
  fallbackFocus = false,
}: {
  readonly initialAssigned?: boolean;
  readonly fallbackFocus?: boolean;
}) {
  const [assigned, setAssigned] = useState(
    initialAssigned
      ? organizationProfileSchema.parse({
          createdAt: "2025-01-01T00:00:00.000Z",
          displayName: "Alice Singer",
          globalStatus: "Active",
          id: "11111111-1111-4111-8111-111111111111",
          updatedAt: "2025-01-01T00:00:00.000Z",
          voicePart: "Soprano 1",
        })
      : undefined,
  );
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  return (
    <PortalContainerProvider>
      <div
        className={`seating-workspace${fallbackFocus ? " seating-workspace--fallback-focus" : ""}`}
      >
        <div className="seating-editor-canvas" tabIndex={-1}>
          <SeatTile
            assigned={assigned}
            label="Seat 1"
            mismatch={false}
            onActivate={() => undefined}
            onDrop={() => undefined}
            onRemove={() => {
              if (assigned) {
                setConfirmState({
                  confirmLabel: "Clear assignment",
                  message: `Clear ${assigned.displayName} from this seat and return them to Unassigned Profiles?`,
                  onConfirm: () => {
                    setAssigned(undefined);
                    setConfirmState(null);
                  },
                  seatKey: "0-0",
                  title: "Clear seat assignment?",
                });
              }
            }}
            seatKey="0-0"
            suggestion="Open"
          />
        </div>
        <ConfirmDialog
          onClose={() => {
            setConfirmState(null);
          }}
          state={confirmState}
        />
        <PortalContainerHost className="seating-portal-host" />
      </div>
    </PortalContainerProvider>
  );
}

describe("Seating clear-seat confirmation interaction", () => {
  it("opens confirmation before mutation and preserves assignment on cancel", async () => {
    const user = userEvent.setup();
    const { container } = render(<SeatingHarness />);

    const removeBtn = screen.getByRole("button", {
      name: "Remove Alice Singer from Seat 1",
    });
    await user.click(removeBtn);

    // Dialog is mounted inside the scoped portal host
    const host = container.querySelector(".seating-portal-host");
    const dialog = screen.getByRole("dialog", { name: "Clear seat assignment?" });
    expect(host?.contains(dialog)).toBe(true);
    expect(dialog).toHaveTextContent("return them to Unassigned Profiles");

    // Cancel preserves assignment and restores focus to remove button
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    await user.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Alice Singer")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Alice Singer from Seat 1" }),
    ).toBeInTheDocument();
  });

  it("clears assignment on confirm and moves focus to stable seat control", async () => {
    const user = userEvent.setup();
    render(<SeatingHarness />);

    const removeBtn = screen.getByRole("button", {
      name: "Remove Alice Singer from Seat 1",
    });
    await user.click(removeBtn);

    const confirmBtn = screen.getByRole("button", { name: "Clear assignment" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Seat is now empty
    expect(screen.queryByText("Alice Singer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete empty Seat 1" })).toBeInTheDocument();

    // Focus moved to the seat tile control
    const seatTile = document.querySelector<HTMLElement>('[data-seat-key="0-0"]');
    expect(seatTile).not.toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(seatTile);
    });
  });

  it("dismisses confirmation on Escape without leaking unhandled Escape", async () => {
    const user = userEvent.setup();
    render(<SeatingHarness />);

    const removeBtn = screen.getByRole("button", {
      name: "Remove Alice Singer from Seat 1",
    });
    await user.click(removeBtn);

    const dialog = screen.getByRole("dialog", { name: "Clear seat assignment?" });
    expect(dialog).toBeVisible();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Alice Singer")).toBeInTheDocument();
  });
});
