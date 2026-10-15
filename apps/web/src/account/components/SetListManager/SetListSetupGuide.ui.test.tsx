import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SetListSetupGuide } from "./SetListSetupGuide";

describe("SetListSetupGuide", () => {
  it("renders guide title, description, and link to Performance events", () => {
    render(<SetListSetupGuide selectedEventId="11111111-1111-4111-8111-111111111111" />);

    expect(
      screen.getByRole("heading", { name: "Need a set list for a new performance?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Set lists belong to active Performance events/)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Manage Performances →" });
    expect(link).toHaveAttribute(
      "href",
      "/admin/events?type=Performance&returnTo=%2Fadmin%2Fsetlists%3FeventId%3D11111111-1111-4111-8111-111111111111",
    );
  });

  it("links to base setlists route when no event is selected", () => {
    render(<SetListSetupGuide />);

    const link = screen.getByRole("link", { name: "Manage Performances →" });
    expect(link).toHaveAttribute(
      "href",
      "/admin/events?type=Performance&returnTo=%2Fadmin%2Fsetlists",
    );
  });

  it("flushes save before navigating when dirty", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const navigate = vi.fn();

    render(<SetListSetupGuide dirty navigate={navigate} onSave={onSave} />);

    const link = screen.getByRole("link", { name: "Manage Performances →" });
    fireEvent.click(link);

    expect(onSave).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledWith(
      "/admin/events?type=Performance&returnTo=%2Fadmin%2Fsetlists",
    );
  });

  it("blocks navigation when save fails", async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    const navigate = vi.fn();

    render(<SetListSetupGuide dirty navigate={navigate} onSave={onSave} />);

    const link = screen.getByRole("link", { name: "Manage Performances →" });
    fireEvent.click(link);

    expect(onSave).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
  });
});
