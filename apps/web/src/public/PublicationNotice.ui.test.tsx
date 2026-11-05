import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { DonationPublication, DonationPublicationContext } from "@choir/contracts";
import { PublicationNotice } from "./PublicationNotice";
// A fixed historical clock exercises the transition and Organization-local DST boundary.
const publication: DonationPublication = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Holiday",
  recognitionDate: "2024-03-10",
  artworkDate: "2024-03-08",
  timezone: "America/New_York",
  revision: 1,
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("publication notices", () => {
  it("explains different category deadlines and does not introduce a donation-blocking action", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-09T12:00:00Z"));
    render(<PublicationNotice publication={publication} artwork />);
    expect(
      screen.getByText(
        /complete your donation by 2024-03-10 at 11:59 p\.m\. \(Eastern Daylight Time\)/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /You can still submit artwork, but inclusion in Holiday is no longer guaranteed/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("displays Eastern Standard Time for deadlines in standard time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    render(
      <PublicationNotice
        publication={{
          ...publication,
          recognitionDate: "2024-01-15",
          artworkDate: "2024-01-20",
        }}
        artwork
      />,
    );
    expect(
      screen.getByText(
        /complete your donation by 2024-01-15 at 11:59 p\.m\. \(Eastern Standard Time\)/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Submit program-ad artwork by 2024-01-20 at 11:59 p\.m\. \(Eastern Standard Time\)/,
      ),
    ).toBeInTheDocument();
  });
  it("does not expose the donor name for anonymous gifts", () => {
    render(<PublicationNotice publication={publication} anonymous />);
    expect(screen.getByText("Your name will remain private.")).toBeInTheDocument();
    expect(screen.queryByText(/For name recognition/)).not.toBeInTheDocument();
  });
  it("retains on-time receipt treatment after deadlines move earlier", () => {
    const context: DonationPublicationContext = {
      publication,
      paidAt: "2024-03-08T12:00:00Z",
      recognitionStatus: "on_time",
      artworkStatus: "on_time",
    };
    render(<PublicationNotice context={context} artwork />);
    expect(screen.getByText(/gift met the name-recognition cutoff/)).toBeInTheDocument();
    expect(screen.getByText(/artwork was received by the deadline/)).toBeInTheDocument();
  });
  it("omits unset dates and handles absent historical context", () => {
    const { rerender, container } = render(
      <PublicationNotice
        publication={{ ...publication, recognitionDate: null, artworkDate: null }}
        artwork
      />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<PublicationNotice context={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
