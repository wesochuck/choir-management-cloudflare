import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { CommunicationPagination } from "./CommunicationPagination";

describe("CommunicationPagination", () => {
  it("renders page number and triggers callbacks", async () => {
    const user = userEvent.setup();
    const onNextPage = vi.fn();
    const onPreviousPage = vi.fn();

    render(
      <CommunicationPagination
        hasNextPage={true}
        hasPreviousPage={true}
        onNextPage={onNextPage}
        onPreviousPage={onPreviousPage}
        pageNumber={2}
      />,
    );

    expect(screen.getByText("Page 2")).toBeInTheDocument();
    const prevButton = screen.getByRole("button", { name: "Previous page" });
    const nextButton = screen.getByRole("button", { name: "Next page" });

    expect(prevButton).toBeEnabled();
    expect(nextButton).toBeEnabled();

    await user.click(prevButton);
    expect(onPreviousPage).toHaveBeenCalledTimes(1);

    await user.click(nextButton);
    expect(onNextPage).toHaveBeenCalledTimes(1);
  });

  it("disables buttons when hasNextPage or hasPreviousPage is false or disabled prop is set", () => {
    const { rerender } = render(
      <CommunicationPagination
        hasNextPage={false}
        hasPreviousPage={false}
        onNextPage={vi.fn()}
        onPreviousPage={vi.fn()}
        pageNumber={1}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

    rerender(
      <CommunicationPagination
        disabled={true}
        hasNextPage={true}
        hasPreviousPage={true}
        onNextPage={vi.fn()}
        onPreviousPage={vi.fn()}
        pageNumber={2}
      />,
    );

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });
});
