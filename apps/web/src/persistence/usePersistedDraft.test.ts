import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDom } from "./testDom";
import type { PersistedDraftOptions } from "./types";
import { usePersistedDraft } from "./usePersistedDraft";

setupTestDom();

// Simple renderHook implementation for React 19 without external dependencies
function renderHook<TProps, TResult>(
  hook: (props: TProps) => TResult,
  { initialProps }: { readonly initialProps: TProps },
) {
  let currentResult: TResult | null = null;
  const result = {
    get current(): TResult {
      if (currentResult === null) {
        throw new Error("Hook result is not yet available");
      }
      return currentResult;
    },
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let currentProps = initialProps;

  function TestComponent({ props }: { readonly props: TProps }) {
    currentResult = hook(props);
    return null;
  }

  act(() => {
    root.render(createElement(TestComponent, { props: currentProps }));
  });

  return {
    rerender: (nextProps: TProps) => {
      currentProps = nextProps;
      act(() => {
        root.render(createElement(TestComponent, { props: currentProps }));
      });
    },
    result,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("usePersistedDraft", () => {
  interface SampleEntity {
    readonly description: string;
    readonly id: string;
    readonly name: string;
  }

  const initialSample: SampleEntity = {
    description: "Initial description",
    id: "entity-1",
    name: "Original Name",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with persisted baseline and clean state", () => {
    const saveFn = vi.fn().mockResolvedValue(initialSample);
    const { result } = renderHook(
      (props: PersistedDraftOptions<SampleEntity>) => usePersistedDraft(props),
      {
        initialProps: {
          autoRegister: false,
          initialValue: initialSample,
          resourceKey: "sample-entity",
          save: saveFn,
        },
      },
    );

    expect(result.current.persisted).toEqual(initialSample);
    expect(result.current.draft).toEqual(initialSample);
    expect(result.current.dirty).toBe(false);
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("becomes dirty when fields are modified, and becomes clean when reverted", () => {
    const saveFn = vi.fn().mockResolvedValue(initialSample);
    const { result } = renderHook(
      (props: PersistedDraftOptions<SampleEntity>) => usePersistedDraft(props),
      {
        initialProps: {
          autoRegister: false,
          initialValue: initialSample,
          resourceKey: "sample-entity",
          save: saveFn,
        },
      },
    );

    act(() => {
      result.current.updateField("name", "Modified Name");
    });

    expect(result.current.draft?.name).toBe("Modified Name");
    expect(result.current.dirty).toBe(true);

    // Revert back to original value
    act(() => {
      result.current.updateField("name", "Original Name");
    });

    expect(result.current.draft?.name).toBe("Original Name");
    expect(result.current.dirty).toBe(false);
  });

  it("updates persisted baseline and cleans dirty state on successful save", async () => {
    const savedEntity: SampleEntity = {
      description: "Updated description",
      id: "entity-1",
      name: "Saved Name",
    };
    const saveFn = vi.fn().mockResolvedValue(savedEntity);
    const onSaveSuccess = vi.fn();

    const { result } = renderHook(
      (props: PersistedDraftOptions<SampleEntity>) => usePersistedDraft(props),
      {
        initialProps: {
          autoRegister: false,
          initialValue: initialSample,
          onSaveSuccess,
          resourceKey: "sample-entity",
          save: saveFn,
        },
      },
    );

    act(() => {
      result.current.setDraft({
        ...initialSample,
        description: "Updated description",
        name: "Saved Name",
      });
    });

    expect(result.current.dirty).toBe(true);

    let success = false;
    await act(async () => {
      success = await result.current.save();
    });

    expect(success).toBe(true);
    expect(saveFn).toHaveBeenCalledWith({
      description: "Updated description",
      id: "entity-1",
      name: "Saved Name",
    });
    expect(onSaveSuccess).toHaveBeenCalledWith(savedEntity);
    expect(result.current.persisted).toEqual(savedEntity);
    expect(result.current.draft).toEqual(savedEntity);
    expect(result.current.dirty).toBe(false);
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps draft intact and sets error on save failure", async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error("Network connection lost"));
    const onSaveError = vi.fn();

    const { result } = renderHook(
      (props: PersistedDraftOptions<SampleEntity>) => usePersistedDraft(props),
      {
        initialProps: {
          autoRegister: false,
          initialValue: initialSample,
          onSaveError,
          resourceKey: "sample-entity",
          save: saveFn,
        },
      },
    );

    act(() => {
      result.current.updateField("name", "Failed Name");
    });

    let success = true;
    await act(async () => {
      success = await result.current.save();
    });

    expect(success).toBe(false);
    expect(onSaveError).toHaveBeenCalled();
    expect(result.current.persisted).toEqual(initialSample);
    expect(result.current.draft?.name).toBe("Failed Name");
    expect(result.current.dirty).toBe(true);
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBe("Network connection lost");
  });

  it("preserves newer in-flight edits when an earlier save completes (snapshot isolation)", async () => {
    let resolveSave!: (value: SampleEntity) => void;
    const savePromiseInternal = new Promise<SampleEntity>((resolve) => {
      resolveSave = resolve;
    });
    const saveFn = vi.fn().mockImplementation(() => savePromiseInternal);

    const { result } = renderHook(
      (props: PersistedDraftOptions<SampleEntity>) => usePersistedDraft(props),
      {
        initialProps: {
          autoRegister: false,
          initialValue: initialSample,
          resourceKey: "sample-entity",
          save: saveFn,
        },
      },
    );

    // Edit 1 -> Revision 1 ("Revision B")
    act(() => {
      result.current.updateField("name", "Revision B");
    });

    // Start Save of Revision B (in flight)
    let savePromise!: Promise<boolean>;
    act(() => {
      savePromise = result.current.save();
    });

    // While save is in flight, user makes Edit 2 -> Revision 2 ("Revision C")
    act(() => {
      result.current.updateField("name", "Revision C");
    });

    expect(result.current.draft?.name).toBe("Revision C");

    // Earlier Save of Revision B now succeeds
    let success = false;
    await act(async () => {
      resolveSave({
        ...initialSample,
        name: "Revision B",
      });
      success = await savePromise;
    });

    expect(success).toBe(true);

    // Persisted baseline is updated to B
    expect(result.current.persisted?.name).toBe("Revision B");
    // But current draft remains C (NOT overwritten with server response B)
    expect(result.current.draft?.name).toBe("Revision C");
    // dirty remains true because Revision C !== Persisted B
    expect(result.current.dirty).toBe(true);
  });

  it("discards uncommitted edits and resets draft to persisted baseline", () => {
    const saveFn = vi.fn().mockResolvedValue(initialSample);
    const { result } = renderHook(
      (props: PersistedDraftOptions<SampleEntity>) => usePersistedDraft(props),
      {
        initialProps: {
          autoRegister: false,
          initialValue: initialSample,
          resourceKey: "sample-entity",
          save: saveFn,
        },
      },
    );

    act(() => {
      result.current.updateField("name", "Discardable Name");
    });

    expect(result.current.dirty).toBe(true);

    act(() => {
      result.current.discard();
    });

    expect(result.current.draft).toEqual(initialSample);
    expect(result.current.dirty).toBe(false);
  });

  it("supports custom normalization function", () => {
    const saveFn = vi.fn().mockResolvedValue(initialSample);
    const { result } = renderHook(
      (props: PersistedDraftOptions<SampleEntity>) => usePersistedDraft(props),
      {
        initialProps: {
          autoRegister: false,
          initialValue: initialSample,
          normalize: (item) => ({
            ...item,
            name: item.name.trim(),
          }),
          resourceKey: "sample-entity",
          save: saveFn,
        },
      },
    );

    // Typing whitespace around the same name should not mark dirty under trim normalization
    act(() => {
      result.current.updateField("name", "  Original Name  ");
    });

    expect(result.current.dirty).toBe(false);

    // Typing an actually different name should mark dirty
    act(() => {
      result.current.updateField("name", "  Different Name  ");
    });

    expect(result.current.dirty).toBe(true);
  });

  it("synchronizes with background query refetches when clean, but protects dirty drafts", () => {
    const saveFn = vi.fn().mockResolvedValue(initialSample);
    const { rerender, result } = renderHook(
      (props: PersistedDraftOptions<SampleEntity>) => usePersistedDraft(props),
      {
        initialProps: {
          autoRegister: false,
          initialValue: initialSample,
          resourceKey: "sample-entity",
          save: saveFn,
        },
      },
    );

    const refreshedServerValue: SampleEntity = {
      description: "Refreshed description from server",
      id: "entity-1",
      name: "Refreshed Name",
    };

    // When clean, refetch updates draft and baseline
    rerender({
      autoRegister: false,
      initialValue: refreshedServerValue,
      resourceKey: "sample-entity",
      save: saveFn,
    });

    expect(result.current.persisted).toEqual(refreshedServerValue);
    expect(result.current.draft).toEqual(refreshedServerValue);
    expect(result.current.dirty).toBe(false);

    // User edits draft
    act(() => {
      result.current.updateField("name", "User In-Progress Edit");
    });
    expect(result.current.dirty).toBe(true);

    // Another background query arrives with different data
    const secondServerValue: SampleEntity = {
      description: "Third description",
      id: "entity-1",
      name: "Third Name",
    };

    rerender({
      autoRegister: false,
      initialValue: secondServerValue,
      resourceKey: "sample-entity",
      save: saveFn,
    });

    // Draft is NOT overwritten by background query because it is dirty!
    expect(result.current.draft?.name).toBe("User In-Progress Edit");
    expect(result.current.dirty).toBe(true);
  });
});
