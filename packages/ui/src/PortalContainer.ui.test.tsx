import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";

import { PortalContainerHost, PortalContainerProvider } from "./PortalContainer";
import { usePortalContainer } from "./usePortalContainer";

function ConsumerProbe() {
  const { container, isScoped } = usePortalContainer();
  return (
    <div data-testid="probe">
      <span data-testid="is-scoped">{isScoped ? "yes" : "no"}</span>
      <span data-testid="has-container">{container ? "yes" : "no"}</span>
      <span data-testid="container-id">{container?.id ?? "none"}</span>
    </div>
  );
}

describe("PortalContainer", () => {
  it("defaults to unscoped with null container when used outside provider", () => {
    render(<ConsumerProbe />);
    expect(screen.getByTestId("is-scoped")).toHaveTextContent("no");
    expect(screen.getByTestId("has-container")).toHaveTextContent("no");
    expect(screen.getByTestId("container-id")).toHaveTextContent("none");
  });

  it("registers PortalContainerHost with PortalContainerProvider", () => {
    render(
      <PortalContainerProvider>
        <ConsumerProbe />
        <PortalContainerHost className="my-host" id="registered-host" />
      </PortalContainerProvider>,
    );

    expect(screen.getByTestId("is-scoped")).toHaveTextContent("yes");
    expect(screen.getByTestId("has-container")).toHaveTextContent("yes");
    expect(screen.getByTestId("container-id")).toHaveTextContent("registered-host");
  });

  it("handles explicit container passed via prop", () => {
    const customDiv = document.createElement("div");
    customDiv.id = "custom-external";
    document.body.appendChild(customDiv);

    try {
      render(
        <PortalContainerProvider container={customDiv}>
          <ConsumerProbe />
        </PortalContainerProvider>,
      );

      expect(screen.getByTestId("is-scoped")).toHaveTextContent("yes");
      expect(screen.getByTestId("has-container")).toHaveTextContent("yes");
      expect(screen.getByTestId("container-id")).toHaveTextContent("custom-external");
    } finally {
      customDiv.remove();
    }
  });

  it("cleans up container when host unmounts", () => {
    const { rerender } = render(
      <PortalContainerProvider>
        <ConsumerProbe />
        <PortalContainerHost id="transient-host" />
      </PortalContainerProvider>,
    );

    expect(screen.getByTestId("has-container")).toHaveTextContent("yes");
    expect(screen.getByTestId("container-id")).toHaveTextContent("transient-host");

    // Remove host
    rerender(
      <PortalContainerProvider>
        <ConsumerProbe />
      </PortalContainerProvider>,
    );

    expect(screen.getByTestId("is-scoped")).toHaveTextContent("yes");
    expect(screen.getByTestId("has-container")).toHaveTextContent("no");
    expect(screen.getByTestId("container-id")).toHaveTextContent("none");
  });
});
