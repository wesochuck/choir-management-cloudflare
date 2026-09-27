import { describe, expect, it } from "vitest";
import { parseCommunicationSearch } from "./utils";

describe("parseCommunicationSearch", () => {
  it("defaults to all status, all origins, and messages list for empty search", () => {
    const res = parseCommunicationSearch("");
    expect(res).toEqual({
      draftId: null,
      messageMode: "list",
      originFilter: "all",
      section: "messages",
      statusFilter: "all",
    });
  });

  it("handles legacy tab=drafts", () => {
    const res = parseCommunicationSearch("?tab=drafts");
    expect(res.statusFilter).toBe("draft");
    expect(res.originFilter).toBe("all");
    expect(res.section).toBe("messages");
    expect(res.messageMode).toBe("list");
  });

  it("handles legacy tab=upcoming", () => {
    const res = parseCommunicationSearch("?tab=upcoming");
    expect(res.statusFilter).toBe("scheduled");
    expect(res.originFilter).toBe("all");
    expect(res.section).toBe("messages");
  });

  it("handles legacy tab=history", () => {
    const res = parseCommunicationSearch("?tab=history");
    expect(res.statusFilter).toBe("all");
    expect(res.originFilter).toBe("all");
    expect(res.section).toBe("messages");
  });

  it("handles legacy tab=automated", () => {
    const res = parseCommunicationSearch("?tab=automated");
    expect(res.statusFilter).toBe("all");
    expect(res.originFilter).toBe("automated");
    expect(res.section).toBe("messages");
  });

  it("handles legacy filter=automated", () => {
    const res = parseCommunicationSearch("?filter=automated");
    expect(res.statusFilter).toBe("all");
    expect(res.originFilter).toBe("automated");
  });

  it("parses explicit status and type queries", () => {
    const res1 = parseCommunicationSearch("?status=sent&type=automated");
    expect(res1.statusFilter).toBe("sent");
    expect(res1.originFilter).toBe("automated");

    const res2 = parseCommunicationSearch("?status=failed&type=manual");
    expect(res2.statusFilter).toBe("failed");
    expect(res2.originFilter).toBe("manual");

    const res3 = parseCommunicationSearch("?status=queued&origin=automated");
    expect(res3.statusFilter).toBe("queued");
    expect(res3.originFilter).toBe("automated");
  });

  it("normalizes plural or alternate status names", () => {
    expect(parseCommunicationSearch("?status=drafts").statusFilter).toBe("draft");
    expect(parseCommunicationSearch("?status=upcoming").statusFilter).toBe("scheduled");
  });

  it("allows explicit status to override tab", () => {
    const res = parseCommunicationSearch("?tab=history&status=sent&type=manual");
    expect(res.statusFilter).toBe("sent");
    expect(res.originFilter).toBe("manual");
  });

  it("falls back safely on invalid status and origin values", () => {
    const res = parseCommunicationSearch("?status=unknown_val&type=bogus_val");
    expect(res.statusFilter).toBe("all");
    expect(res.originFilter).toBe("all");
  });

  it("handles draftId by switching to compose mode", () => {
    const res = parseCommunicationSearch("?draftId=draft-123");
    expect(res).toEqual({
      draftId: "draft-123",
      messageMode: "compose",
      originFilter: "all",
      section: "messages",
      statusFilter: "all",
    });
  });

  it("handles other navigation tabs", () => {
    expect(parseCommunicationSearch("?tab=compose").messageMode).toBe("compose");
    expect(parseCommunicationSearch("?tab=templates").section).toBe("templates");
    expect(parseCommunicationSearch("?tab=settings").section).toBe("settings");
  });
});
