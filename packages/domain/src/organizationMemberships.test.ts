import { describe, expect, it } from "vitest";
import { allowedRoleOptionsForActor, evaluateMemberRoleChange } from "./organizationMemberships";

describe("evaluateMemberRoleChange", () => {
  describe("Actor: Member", () => {
    it("rejects any role change attempt by a member", () => {
      const decision = evaluateMemberRoleChange({
        actorRole: "member",
        currentTargetRole: "member",
        isSelf: false,
        newTargetRole: "administrator",
      });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("forbidden");
        expect(decision.reason).toBe("member_not_permitted");
      }
    });
  });

  describe("Actor: Administrator", () => {
    it("allows promoting member to administrator", () => {
      const decision = evaluateMemberRoleChange({
        actorRole: "administrator",
        currentTargetRole: "member",
        isSelf: false,
        newTargetRole: "administrator",
      });
      expect(decision.allowed).toBe(true);
    });

    it("allows demoting administrator to member", () => {
      const decision = evaluateMemberRoleChange({
        actorRole: "administrator",
        currentTargetRole: "administrator",
        isSelf: false,
        newTargetRole: "member",
      });
      expect(decision.allowed).toBe(true);
    });

    it("rejects modifying self", () => {
      const decision = evaluateMemberRoleChange({
        actorRole: "administrator",
        currentTargetRole: "administrator",
        isSelf: true,
        newTargetRole: "member",
      });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("forbidden");
        expect(decision.reason).toBe("admin_cannot_change_self");
      }
    });

    it("rejects modifying an owner", () => {
      const decision = evaluateMemberRoleChange({
        actorRole: "administrator",
        currentTargetRole: "owner",
        isSelf: false,
        newTargetRole: "administrator",
      });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("forbidden");
        expect(decision.reason).toBe("admin_cannot_modify_owner");
      }
    });

    it("rejects granting owner access", () => {
      const decision = evaluateMemberRoleChange({
        actorRole: "administrator",
        currentTargetRole: "member",
        isSelf: false,
        newTargetRole: "owner",
      });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("forbidden");
        expect(decision.reason).toBe("admin_cannot_grant_owner");
      }
    });
  });

  describe("Actor: Owner", () => {
    it("allows promoting member to administrator", () => {
      const decision = evaluateMemberRoleChange({
        actorRole: "owner",
        currentTargetRole: "member",
        isSelf: false,
        newTargetRole: "administrator",
      });
      expect(decision.allowed).toBe(true);
    });

    it("allows promoting administrator to owner", () => {
      const decision = evaluateMemberRoleChange({
        actorRole: "owner",
        currentTargetRole: "administrator",
        isSelf: false,
        newTargetRole: "owner",
      });
      expect(decision.allowed).toBe(true);
    });

    it("allows demoting owner when another owner exists", () => {
      const decision = evaluateMemberRoleChange({
        actorRole: "owner",
        currentTargetRole: "owner",
        isSelf: false,
        newTargetRole: "administrator",
        totalOwnersCount: 2,
      });
      expect(decision.allowed).toBe(true);
    });

    it("allows self-demoting owner when another owner exists", () => {
      const decision = evaluateMemberRoleChange({
        actorRole: "owner",
        currentTargetRole: "owner",
        isSelf: true,
        newTargetRole: "administrator",
        totalOwnersCount: 2,
      });
      expect(decision.allowed).toBe(true);
    });

    it("rejects demoting the last owner", () => {
      const decision = evaluateMemberRoleChange({
        actorRole: "owner",
        currentTargetRole: "owner",
        isSelf: true,
        newTargetRole: "administrator",
        totalOwnersCount: 1,
      });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("conflict");
        expect(decision.reason).toBe("last_owner");
      }
    });
  });
});

describe("allowedRoleOptionsForActor", () => {
  it("returns empty for members", () => {
    expect(allowedRoleOptionsForActor("member", "member", false)).toEqual([]);
  });

  it("returns member and administrator for admin on non-owner", () => {
    expect(allowedRoleOptionsForActor("administrator", "member", false)).toEqual([
      "member",
      "administrator",
    ]);
  });

  it("returns empty for admin on owner or self", () => {
    expect(allowedRoleOptionsForActor("administrator", "owner", false)).toEqual([]);
    expect(allowedRoleOptionsForActor("administrator", "administrator", true)).toEqual([]);
  });

  it("returns all three roles for owner", () => {
    expect(allowedRoleOptionsForActor("owner", "member", false)).toEqual([
      "member",
      "administrator",
      "owner",
    ]);
    expect(allowedRoleOptionsForActor("owner", "owner", true)).toEqual([
      "member",
      "administrator",
      "owner",
    ]);
  });
});
