import type { OrganizationResource } from "@choir/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { OrganizationResources } from "./OrganizationResources";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    createOrganizationResource: vi.fn(),
    deleteOrganizationResource: vi.fn(),
    deletePrivateOrganizationFile: vi.fn(),
    listOrganizationResources: vi.fn(),
    reorderOrganizationResources: vi.fn(),
    updateOrganizationResource: vi.fn(),
    uploadPrivateOrganizationFile: vi.fn(),
  };
});

const sampleResources: readonly OrganizationResource[] = [
  {
    createdAt: "2026-07-20T20:00:00.000Z",
    fileId: null,
    id: "11111111-1111-4111-8111-111111111111",
    sortOrder: 0,
    title: "Member Handbook",
    updatedAt: "2026-07-20T20:00:00.000Z",
    url: "https://example.test/handbook",
  },
  {
    createdAt: "2026-07-20T20:01:00.000Z",
    fileId: null,
    id: "22222222-2222-4222-8222-222222222222",
    sortOrder: 1,
    title: "Rehearsal Schedule",
    updatedAt: "2026-07-20T20:01:00.000Z",
    url: "https://example.test/rehearsals",
  },
];

describe("OrganizationResources UI component", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows loading indicator initially and avoids premature empty state", async () => {
    let resolveList: ((resources: readonly OrganizationResource[]) => void) | undefined;
    const listPromise = new Promise<readonly OrganizationResource[]>((resolve) => {
      resolveList = resolve;
    });
    vi.mocked(api.listOrganizationResources).mockReturnValue(listPromise);

    render(<OrganizationResources enabled manager={false} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading resources…");
    expect(screen.queryByText("No resources have been shared yet.")).not.toBeInTheDocument();

    resolveList?.(sampleResources);

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("Member Handbook").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rehearsal Schedule").length).toBeGreaterThan(0);
    expect(screen.queryByText("No resources have been shared yet.")).not.toBeInTheDocument();
  });

  it("shows empty state when fetch completes with zero resources", async () => {
    vi.mocked(api.listOrganizationResources).mockResolvedValue([]);

    render(<OrganizationResources enabled manager={false} />);

    await waitFor(() => {
      expect(screen.getByText("No resources have been shared yet.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows error alert and avoids misleading empty state when initial fetch fails", async () => {
    vi.mocked(api.listOrganizationResources).mockRejectedValue(new Error("Network failed"));

    render(<OrganizationResources enabled manager={false} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Organization resources could not be updated.",
      );
    });
    expect(screen.queryByText("No resources have been shared yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("authoritatively refetches resources after manager adds a new resource", async () => {
    const user = userEvent.setup();
    const newResource: OrganizationResource = {
      createdAt: "2026-07-20T20:02:00.000Z",
      fileId: null,
      id: "33333333-3333-4333-8333-333333333333",
      sortOrder: 2,
      title: "Audio Guide",
      updatedAt: "2026-07-20T20:02:00.000Z",
      url: "https://example.test/audio",
    };

    vi.mocked(api.listOrganizationResources)
      .mockResolvedValueOnce(sampleResources)
      .mockResolvedValueOnce([...sampleResources, newResource]);
    vi.mocked(api.createOrganizationResource).mockResolvedValue(newResource);

    render(<OrganizationResources enabled manager />);

    await waitFor(() => {
      expect(screen.getAllByText("Member Handbook").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole("button", { name: "Add resource" }));
    await user.type(screen.getByLabelText("Title"), "Audio Guide");
    await user.type(screen.getByLabelText("HTTPS link"), "https://example.test/audio");
    await user.click(screen.getByRole("button", { name: "Add resource" }));

    await waitFor(() => {
      expect(screen.getAllByText("Audio Guide").length).toBeGreaterThan(0);
    });

    // Authoritative refetch should have been invoked twice (initial mount + after create)
    expect(api.listOrganizationResources).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("Resource added.");
  });

  it("authoritatively refetches resources after manager deletes a resource", async () => {
    const user = userEvent.setup();
    const secondResource = sampleResources[1];
    if (!secondResource) {
      throw new Error("Expected second sample resource");
    }

    vi.mocked(api.listOrganizationResources)
      .mockResolvedValueOnce(sampleResources)
      .mockResolvedValueOnce([secondResource]);
    vi.mocked(api.deleteOrganizationResource).mockResolvedValue(undefined);

    render(<OrganizationResources enabled manager />);

    await waitFor(() => {
      expect(screen.getAllByText("Member Handbook").length).toBeGreaterThan(0);
    });

    // Click delete button for the first resource
    const deleteButtons = screen.getAllByRole("button", { name: /Delete/i });
    const firstDeleteButton = deleteButtons[0];
    if (!firstDeleteButton) {
      throw new Error("Expected delete button");
    }
    await user.click(firstDeleteButton);

    // Confirmation dialog should appear
    const confirmButton = await screen.findByRole("button", { name: "Delete resource" });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(api.deleteOrganizationResource).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
      );
    });

    // Authoritative refetch called twice (mount + after delete)
    expect(api.listOrganizationResources).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.queryByText("Member Handbook")).not.toBeInTheDocument();
      expect(screen.getAllByText("Rehearsal Schedule").length).toBeGreaterThan(0);
    });
  });

  it("does not render manager actions when manager is false", async () => {
    vi.mocked(api.listOrganizationResources).mockResolvedValue(sampleResources);

    render(<OrganizationResources enabled manager={false} />);

    await waitFor(() => {
      expect(screen.getAllByText("Member Handbook").length).toBeGreaterThan(0);
    });

    expect(screen.queryByRole("button", { name: "Add resource" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/i })).not.toBeInTheDocument();
  });
});
