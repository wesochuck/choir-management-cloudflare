import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TICKETING_NOTICE_SUCCESS_TIMEOUT_MS, useTicketingNotice } from "./ticketingNotice";

describe("useTicketingNotice", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("automatically clears success notices after five seconds", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTicketingNotice());

    act(() => {
      result.current.showNotice("Discount code saved.", "success", "discounts");
    });
    expect(result.current.notice).toMatchObject({
      kind: "success",
      message: "Discount code saved.",
      scope: "discounts",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICKETING_NOTICE_SUCCESS_TIMEOUT_MS - 1);
    });
    expect(result.current.notice).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.notice).toBeNull();
  });

  it("clears a scoped notice when leaving its tab and does not restore it on return", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTicketingNotice());

    act(() => {
      result.current.showNotice("Discount code saved.", "success", "discounts");
    });
    act(() => {
      result.current.clearScopedNoticeWhenLeavingTab("bundles");
    });
    expect(result.current.notice).toBeNull();

    act(() => {
      result.current.clearScopedNoticeWhenLeavingTab("discounts");
    });
    expect(result.current.notice).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let an earlier success timer clear a newer success notice", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTicketingNotice());

    act(() => {
      result.current.showNotice("First change saved.", "success");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICKETING_NOTICE_SUCCESS_TIMEOUT_MS - 1_000);
    });
    act(() => {
      result.current.showNotice("Second change saved.", "success");
    });

    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.notice?.message).toBe("Second change saved.");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICKETING_NOTICE_SUCCESS_TIMEOUT_MS - 1_000);
    });
    expect(result.current.notice).toBeNull();
  });

  it("keeps errors and action-required notices until another action replaces them", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTicketingNotice());

    act(() => {
      result.current.showNotice("The discount could not be saved.", "error");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICKETING_NOTICE_SUCCESS_TIMEOUT_MS * 2);
    });
    act(() => {
      result.current.clearSuccessNotice();
    });
    expect(result.current.notice).toMatchObject({
      kind: "error",
      message: "The discount could not be saved.",
    });
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      result.current.showNotice("Edit or deactivate this bundle instead.", "info");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TICKETING_NOTICE_SUCCESS_TIMEOUT_MS * 2);
    });
    expect(result.current.notice).toMatchObject({
      kind: "info",
      message: "Edit or deactivate this bundle instead.",
    });
  });

  it("cancels an active success timer on unmount", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useTicketingNotice());

    act(() => {
      result.current.showNotice("Ticket bundle saved.", "success");
    });
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
