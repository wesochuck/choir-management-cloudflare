import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  OrganizationProfile,
  ProfileReconciliationCandidate,
  ProfileReconciliationPreviewResponse,
  ProfileReconciliationResponse,
} from "@choir/contracts";
import { organizationProfileSchema } from "@choir/contracts";
import { ResolveDuplicateDialog } from "./ResolveDuplicateDialog";

vi.mock("../api/profiles", () => ({
  executeProfileReconciliation: vi.fn(),
  getProfileReconciliationCandidates: vi.fn(),
  previewProfileReconciliation: vi.fn(),
}));

import {
  executeProfileReconciliation,
  getProfileReconciliationCandidates,
  previewProfileReconciliation,
} from "../api/profiles";

const mockGetCandidates = vi.mocked(getProfileReconciliationCandidates);
const mockPreview = vi.mocked(previewProfileReconciliation);
const mockExecute = vi.mocked(executeProfileReconciliation);

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "mem-test-1";

const MOCK_PROFILES: OrganizationProfile[] = [
  organizationProfileSchema.parse({
    createdAt: new Date().toISOString(),
    displayName: "Jane Smith",
    doNotEmail: false,
    globalStatus: "Active",
    hidden: false,
    id: TARGET_ID,
    isSectionLeader: false,
    notes: "Historical notes",
    phone: "555-0100",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveVolunteerEmails: false,
    receiveWeeklyReminders: false,
    showInDirectory: true,
    statusIsManual: false,
    updatedAt: new Date().toISOString(),
    voicePart: "Alto 1",
  }),
  organizationProfileSchema.parse({
    createdAt: new Date().toISOString(),
    displayName: "Jane Smith",
    doNotEmail: false,
    globalStatus: "Active",
    hidden: false,
    id: SOURCE_ID,
    isSectionLeader: false,
    notes: "Signup notes",
    phone: "555-0199",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveVolunteerEmails: false,
    receiveWeeklyReminders: false,
    showInDirectory: true,
    statusIsManual: false,
    updatedAt: new Date().toISOString(),
    voicePart: "Alto 1",
  }),
];

const MOCK_CANDIDATE: ProfileReconciliationCandidate = {
  displayName: "Jane Smith",
  globalStatus: "Active",
  id: TARGET_ID,
  matchReasons: ["Exact name match", "Matching voice part"],
  phone: "555-0100",
  voicePart: "Alto 1",
};

const MOCK_PREVIEW_READY: ProfileReconciliationPreviewResponse = {
  canReconcile: true,
  conflictInventory: {
    blockers: [],
    contactConflicts: [],
    deliveryConflicts: [],
    duesConflicts: [],
    eventRosterConflicts: [],
    noteConflict: {
      sourceNotes: "Signup notes",
      targetNotes: "Historical notes",
    },
    pollConflicts: [],
    transferCounts: {
      duesMoved: 1,
      eventRostersCombined: 1,
      eventRostersMoved: 2,
      historyRowsRetained: 3,
      pollResponsesMoved: 1,
      seatingAssignmentsUpdated: 1,
      suppressionsMoved: 0,
    },
    warnings: [
      "Target phone '555-0100' will be kept unless overwritten with '555-0199'.",
      "Both profiles contain notes; choose whether to keep target, overwrite, or append.",
    ],
  },
  memberEmail: "jane@example.test",
  membershipId: MEMBERSHIP_ID,
  memberName: "Jane Smith",
  memberRole: "member",
  previewRevision: "rev-abc123-2026-10-09",
  requestId: "req-1",
  sourceProfile: {
    createdAt: new Date().toISOString(),
    displayName: "Jane Smith",
    doNotEmail: false,
    globalStatus: "Active",
    hidden: false,
    id: SOURCE_ID,
    isSectionLeader: false,
    lastBounceAt: null,
    membershipEmail: "jane@example.test",
    notes: "Signup notes",
    phone: "555-0199",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveVolunteerEmails: false,
    receiveWeeklyReminders: false,
    showInDirectory: true,
    statusIsManual: false,
    updatedAt: new Date().toISOString(),
    voicePart: "Alto 1",
  },
  status: "needs_conflict_resolution",
  targetProfile: {
    createdAt: new Date().toISOString(),
    displayName: "Jane Smith",
    doNotEmail: false,
    globalStatus: "Active",
    hidden: false,
    id: TARGET_ID,
    isSectionLeader: false,
    lastBounceAt: null,
    membershipEmail: null,
    notes: "Historical notes",
    phone: "555-0100",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveVolunteerEmails: false,
    receiveWeeklyReminders: false,
    showInDirectory: true,
    statusIsManual: false,
    updatedAt: new Date().toISOString(),
    voicePart: "Alto 1",
  },
};

const MOCK_EXECUTE_RESPONSE: ProfileReconciliationResponse = {
  canonicalProfileId: TARGET_ID,
  id: "rec-1",
  membershipId: MEMBERSHIP_ID,
  message: "Profiles successfully consolidated.",
  occurredAt: new Date().toISOString(),
  requestId: "req-1",
  sourceProfileId: SOURCE_ID,
  status: "completed",
  targetProfileId: TARGET_ID,
};

describe("ResolveDuplicateDialog UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCandidates.mockResolvedValue({
      candidates: [MOCK_CANDIDATE],
      requestId: "req-1",
    });
    mockPreview.mockResolvedValue(MOCK_PREVIEW_READY);
    mockExecute.mockResolvedValue(MOCK_EXECUTE_RESPONSE);
  });

  it("renders candidates without auto-selecting, allows explicit selection, and submits merge", async () => {
    const user = userEvent.setup();
    const handleReconciled = vi.fn();
    const handleClose = vi.fn();

    render(
      <ResolveDuplicateDialog
        allProfiles={MOCK_PROFILES}
        membershipEmail="jane@example.test"
        membershipId={MEMBERSHIP_ID}
        membershipName="Jane Smith"
        onClose={handleClose}
        onReconciled={handleReconciled}
        open={true}
        sourceProfileId={SOURCE_ID}
      />,
    );

    // Initial heading
    expect(screen.getByRole("heading", { name: "Resolve Duplicate Profile" })).toBeInTheDocument();

    // Suggested match candidate button is rendered but NOT auto-selected
    const candidateBtn = await screen.findByRole("button", { name: /Jane Smith \(Alto 1\)/ });
    expect(candidateBtn).toBeInTheDocument();
    expect(screen.queryByText("Source Profile")).not.toBeInTheDocument();

    // Explicitly click candidate button
    await user.click(candidateBtn);

    // Preview side-by-side cards appear
    await waitFor(() => {
      expect(screen.getByText("Source Profile")).toBeInTheDocument();
      expect(screen.getByText("Target Profile")).toBeInTheDocument();
      expect(screen.getByText("Will be retired")).toBeInTheDocument();
      expect(screen.getByText("Preserved canonical")).toBeInTheDocument();
      expect(screen.getByText("Records to be Consolidated")).toBeInTheDocument();
    });

    // Confirm button is initially disabled without affirmation checkbox
    const confirmButton = screen.getByRole("button", { name: "Confirm & Merge Profiles" });
    expect(confirmButton).toBeDisabled();

    // Check affirmation checkbox
    const affirmationCheckbox = screen.getByLabelText(
      /I confirm that both profiles represent the same individual/i,
    );
    await user.click(affirmationCheckbox);
    expect(confirmButton).toBeEnabled();

    // Submit merge
    await user.click(confirmButton);

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          confirmedSamePerson: true,
          expectedSourceProfileId: SOURCE_ID,
          membershipId: MEMBERSHIP_ID,
          previewRevision: "rev-abc123-2026-10-09",
          targetProfileId: TARGET_ID,
        }),
      );
      expect(handleReconciled).toHaveBeenCalledWith(TARGET_ID);
      expect(screen.getByText("Profiles successfully consolidated.")).toBeInTheDocument();
    });
  });

  it("disables merge button and displays blockers when preview has blockers", async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue({
      ...MOCK_PREVIEW_READY,
      canReconcile: false,
      conflictInventory: {
        ...MOCK_PREVIEW_READY.conflictInventory,
        blockers: ["Event evt-1: Conflicting event records: RSVP (Yes vs No)"],
      },
      status: "blocked",
    });

    render(
      <ResolveDuplicateDialog
        allProfiles={MOCK_PROFILES}
        membershipEmail="jane@example.test"
        membershipId={MEMBERSHIP_ID}
        membershipName="Jane Smith"
        onClose={vi.fn()}
        open={true}
        sourceProfileId={SOURCE_ID}
      />,
    );

    const candidateBtn = await screen.findByRole("button", { name: /Jane Smith \(Alto 1\)/ });
    await user.click(candidateBtn);

    await waitFor(() => {
      expect(screen.getByText(/Reconciliation is blocked:/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Conflicting event records: RSVP \(Yes vs No\)/i),
      ).toBeInTheDocument();
    });

    // Confirm & Merge button should not be rendered when reconciliation is blocked
    expect(
      screen.queryByRole("button", { name: "Confirm & Merge Profiles" }),
    ).not.toBeInTheDocument();
  });

  it("renders distinct informational view without merge controls when preview is already_consolidated", async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue({
      ...MOCK_PREVIEW_READY,
      canReconcile: false,
      status: "already_consolidated",
    });

    render(
      <ResolveDuplicateDialog
        allProfiles={MOCK_PROFILES}
        membershipEmail="jane@example.test"
        membershipId={MEMBERSHIP_ID}
        membershipName="Jane Smith"
        onClose={vi.fn()}
        open={true}
        sourceProfileId={SOURCE_ID}
      />,
    );

    const candidateBtn = await screen.findByRole("button", { name: /Jane Smith \(Alto 1\)/ });
    await user.click(candidateBtn);

    await waitFor(() => {
      expect(screen.getByText("These profiles are already consolidated.")).toBeInTheDocument();
    });

    // Affirmation checkbox and merge button should not appear
    expect(
      screen.queryByLabelText(/I confirm that both profiles represent the same individual/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm & Merge Profiles" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThanOrEqual(2);
  });

  it("renders verified membership role and structured delivery conflicts", async () => {
    const user = userEvent.setup();
    mockPreview.mockResolvedValue({
      ...MOCK_PREVIEW_READY,
      canReconcile: false,
      conflictInventory: {
        ...MOCK_PREVIEW_READY.conflictInventory,
        blockers: [
          "Delivery msg-1 (email): Both profiles have delivery records for the same message and channel.",
        ],
        deliveryConflicts: [
          {
            channel: "email",
            messageId: "msg-1",
            reason: "Both profiles have delivery records for the same message and channel.",
          },
        ],
      },
      status: "blocked",
    });

    render(
      <ResolveDuplicateDialog
        allProfiles={MOCK_PROFILES}
        membershipEmail="jane@example.test"
        membershipId={MEMBERSHIP_ID}
        membershipName="Jane Smith"
        onClose={vi.fn()}
        open={true}
        sourceProfileId={SOURCE_ID}
      />,
    );

    const candidateBtn = await screen.findByRole("button", { name: /Jane Smith \(Alto 1\)/ });
    await user.click(candidateBtn);

    await waitFor(() => {
      expect(screen.getByText("Verified Membership")).toBeInTheDocument();
      expect(screen.getByText("member")).toBeInTheDocument();
      expect(screen.getByText("Message Delivery Conflicts")).toBeInTheDocument();
      expect(screen.getAllByText(/msg-1/).length).toBeGreaterThan(0);
    });
  });

  it("surfaces pending_repair status notice when reconciliation requires background repair", async () => {
    const user = userEvent.setup();
    const handleReconciled = vi.fn();

    mockExecute.mockResolvedValue({
      ...MOCK_EXECUTE_RESPONSE,
      message: "Membership relinked; profile consolidation pending background finalization.",
      status: "pending_repair",
    });

    render(
      <ResolveDuplicateDialog
        allProfiles={MOCK_PROFILES}
        membershipEmail="jane@example.test"
        membershipId={MEMBERSHIP_ID}
        membershipName="Jane Smith"
        onClose={vi.fn()}
        onReconciled={handleReconciled}
        open={true}
        sourceProfileId={SOURCE_ID}
      />,
    );

    const candidateBtn = await screen.findByRole("button", { name: /Jane Smith \(Alto 1\)/ });
    await user.click(candidateBtn);

    const affirmationCheckbox = await screen.findByLabelText(
      /I confirm that both profiles represent the same individual/i,
    );
    await user.click(affirmationCheckbox);

    const confirmButton = screen.getByRole("button", { name: "Confirm & Merge Profiles" });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(
        screen.getByText("Reconciliation Partially Applied (Pending Background Repair)"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Membership relinked; profile consolidation pending background finalization.",
        ),
      ).toBeInTheDocument();
      expect(handleReconciled).toHaveBeenCalledWith(TARGET_ID);
    });
  });
});
