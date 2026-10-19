import { organizationEventSchema, type OrganizationEvent } from "@choir/contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalContainerHost, PortalContainerProvider } from "@choir/ui";
import { PrintPreviewDialog } from "./PrintPreviewDialog";

describe("PrintPreviewDialog copy feedback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const event: OrganizationEvent = organizationEventSchema.parse({
    createdAt: "2026-08-01T12:00:00.000Z",
    id: "5f7d9d3e-0b5a-4a8e-9d0e-1a2b3c4d5e6f",
    location: "Community Hall",
    setList: [],
    startsAt: "2026-12-05T19:30:00.000Z",
    title: "Winter Concert",
    type: "Performance",
    updatedAt: "2026-08-01T12:00:00.000Z",
  });

  it("shows copy confirmation and status message when Copy Plain Text is clicked", async () => {
    const copyListText = vi.fn().mockResolvedValue(true);
    render(
      <PortalContainerProvider>
        <PrintPreviewDialog
          copyListText={copyListText}
          event={event}
          items={[]}
          music={[]}
          onClose={vi.fn()}
          open={true}
        />
        <PortalContainerHost />
      </PortalContainerProvider>,
    );

    const copyButton = screen.getByRole("button", { name: "Copy Plain Text" });
    expect(copyButton).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(copyButton);
      await Promise.resolve();
    });

    expect(copyListText).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "✓ Copied!" })).toBeInTheDocument();
    expect(
      screen.getByText("Set list plain text copied to clipboard.", { selector: ".sr-only" }),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole("button", { name: "Copy Plain Text" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not show copied confirmation if copyListText returns false", async () => {
    const copyListText = vi.fn().mockResolvedValue(false);
    render(
      <PortalContainerProvider>
        <PrintPreviewDialog
          copyListText={copyListText}
          event={event}
          items={[]}
          music={[]}
          onClose={vi.fn()}
          open={true}
        />
        <PortalContainerHost />
      </PortalContainerProvider>,
    );

    const copyButton = screen.getByRole("button", { name: "Copy Plain Text" });
    await act(async () => {
      fireEvent.click(copyButton);
      await Promise.resolve();
    });

    expect(copyListText).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Copy Plain Text" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
