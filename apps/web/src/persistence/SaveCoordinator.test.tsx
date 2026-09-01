import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDom } from "./testDom";
import {
  SaveCoordinatorProvider,
  useSaveCoordinator,
  useSaveRegistration,
} from "./SaveCoordinator";
import type { SaveRegistration } from "./types";

setupTestDom();

describe("SaveCoordinator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks dirtyCount and isDirty status across registrations", async () => {
    let coordinatorRef!: ReturnType<typeof useSaveCoordinator>;

    function Observer() {
      coordinatorRef = useSaveCoordinator();
      return null;
    }

    function RegisterChild({ reg }: { readonly reg: SaveRegistration }) {
      useSaveRegistration(reg);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const save1 = vi.fn().mockResolvedValue(true);
    const discard1 = vi.fn();
    const reg1: SaveRegistration = {
      busy: false,
      dirty: true,
      discard: discard1,
      id: "reg-1",
      resourceKey: "res-1",
      save: save1,
    };

    act(() => {
      root.render(
        <SaveCoordinatorProvider>
          <Observer />
          <RegisterChild reg={reg1} />
        </SaveCoordinatorProvider>,
      );
    });

    expect(coordinatorRef.isDirty).toBe(true);
    expect(coordinatorRef.dirtyCount).toBe(1);

    // saveAll executes registered save
    let result!: { errors: readonly string[]; success: boolean };
    await act(async () => {
      result = await coordinatorRef.saveAll();
    });

    expect(result.success).toBe(true);
    expect(save1).toHaveBeenCalled();

    // discardAll executes registered discard
    act(() => {
      coordinatorRef.discardAll();
    });
    expect(discard1).toHaveBeenCalled();

    // Unmount
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("executes multi-resource saveAll with Promise.allSettled and surfaces errors", async () => {
    let coordinatorRef!: ReturnType<typeof useSaveCoordinator>;

    function Observer() {
      coordinatorRef = useSaveCoordinator();
      return null;
    }

    function MultiChild({
      reg1,
      reg2,
    }: {
      readonly reg1: SaveRegistration;
      readonly reg2: SaveRegistration;
    }) {
      useSaveRegistration(reg1);
      useSaveRegistration(reg2);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const saveSuccess = vi.fn().mockResolvedValue(true);
    const saveFail = vi.fn().mockResolvedValue(false);

    const regSuccess: SaveRegistration = {
      busy: false,
      dirty: true,
      discard: vi.fn(),
      id: "reg-success",
      resourceKey: "res-success",
      save: saveSuccess,
    };
    const regFail: SaveRegistration = {
      busy: false,
      dirty: true,
      discard: vi.fn(),
      id: "reg-fail",
      resourceKey: "res-fail",
      save: saveFail,
    };

    act(() => {
      root.render(
        <SaveCoordinatorProvider>
          <Observer />
          <MultiChild reg1={regSuccess} reg2={regFail} />
        </SaveCoordinatorProvider>,
      );
    });

    expect(coordinatorRef.dirtyCount).toBe(2);

    let result!: { errors: readonly string[]; success: boolean };
    await act(async () => {
      result = await coordinatorRef.saveAll();
    });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(saveSuccess).toHaveBeenCalled();
    expect(saveFail).toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("logs duplicate registration detection on colliding resourceKey", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    function DoubleChild() {
      useSaveRegistration({
        busy: false,
        dirty: true,
        discard: vi.fn(),
        id: "child-a",
        resourceKey: "colliding-key",
        save: () => Promise.resolve(true),
      });
      useSaveRegistration({
        busy: false,
        dirty: true,
        discard: vi.fn(),
        id: "child-b",
        resourceKey: "colliding-key",
        save: () => Promise.resolve(true),
      });
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <SaveCoordinatorProvider>
          <DoubleChild />
        </SaveCoordinatorProvider>,
      );
    });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Duplicate draft registration detected"),
    );

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
