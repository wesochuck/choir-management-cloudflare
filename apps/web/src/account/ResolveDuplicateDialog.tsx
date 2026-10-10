import type {
  OrganizationProfile,
  ProfileReconciliationCandidate,
  ProfileReconciliationConflictInventory,
  ProfileReconciliationCounts,
  ProfileReconciliationFieldChoices,
  ProfileReconciliationPreviewResponse,
  ProfileReconciliationProfileSummary,
  ProfileReconciliationResponse,
} from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { useEffect, useState } from "react";

import { AuthApiError } from "../api/client";
import {
  executeProfileReconciliation,
  getProfileReconciliationCandidates,
  previewProfileReconciliation,
} from "../api/profiles";

export interface ResolveDuplicateDialogProps {
  readonly allProfiles: readonly OrganizationProfile[];
  readonly linkedProfileIds?: ReadonlySet<string> | undefined;
  readonly membershipEmail: string;
  readonly membershipId: string;
  readonly membershipName: string;
  readonly onClose: () => void;
  readonly onReconciled?: ((canonicalProfileId: string) => void) | undefined;
  readonly open: boolean;
  readonly sourceProfileId: string;
}

function ConflictNotices({
  conflictInventory,
}: {
  readonly conflictInventory: ProfileReconciliationConflictInventory;
}) {
  return (
    <>
      {conflictInventory.blockers.length > 0 ? (
        <div className="notice notice--error" role="alert">
          <p className="font-semibold">Reconciliation is blocked:</p>
          <ul className="list-disc pl-5 mt-1 space-y-1">
            {conflictInventory.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflictInventory.eventRosterConflicts.length > 0 ? (
        <div className="surface-card p-3 rounded border text-xs" role="region">
          <h4 className="font-bold mb-1">Event Attendance Conflicts</h4>
          <ul className="space-y-1">
            {conflictInventory.eventRosterConflicts.map((c) => (
              <li key={c.eventId} className="text-secondary">
                <span className="font-medium text-foreground">{c.eventTitle ?? c.eventId}:</span>{" "}
                Source ({c.sourceRsvp}/{c.sourceAttendance}) vs Target ({c.targetRsvp}/
                {c.targetAttendance}) — {c.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflictInventory.duesConflicts.length > 0 ? (
        <div className="surface-card p-3 rounded border text-xs" role="region">
          <h4 className="font-bold mb-1">Dues Payment Conflicts</h4>
          <ul className="space-y-1">
            {conflictInventory.duesConflicts.map((d) => (
              <li key={d.seasonId} className="text-secondary">
                <span className="font-medium text-foreground">Season {d.seasonId}:</span> Source
                status: {d.sourceStatus}, Target status: {d.targetStatus ?? "None"} ({d.reason})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflictInventory.pollConflicts.length > 0 ? (
        <div className="surface-card p-3 rounded border text-xs" role="region">
          <h4 className="font-bold mb-1">Poll Response Conflicts</h4>
          <ul className="space-y-1">
            {conflictInventory.pollConflicts.map((p) => (
              <li key={p.pollId} className="text-secondary">
                <span className="font-medium text-foreground">{p.pollTitle ?? p.pollId}:</span>{" "}
                {p.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflictInventory.contactConflicts.length > 0 ? (
        <div className="surface-card p-3 rounded border text-xs" role="region">
          <h4 className="font-bold mb-1">Contact Conflicts</h4>
          <ul className="space-y-1">
            {conflictInventory.contactConflicts.map((c) => (
              <li key={c.contactId} className="text-secondary">
                <span className="font-medium text-foreground">Contact {c.contactId}:</span>{" "}
                {c.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflictInventory.deliveryConflicts.length > 0 ? (
        <div className="surface-card p-3 rounded border text-xs" role="region">
          <h4 className="font-bold mb-1">Message Delivery Conflicts</h4>
          <ul className="space-y-1">
            {conflictInventory.deliveryConflicts.map((d) => (
              <li key={`${d.messageId}-${d.channel}`} className="text-secondary">
                <span className="font-medium text-foreground">
                  {d.messageId} ({d.channel}):
                </span>{" "}
                {d.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflictInventory.noteConflict ? (
        <div className="surface-card p-3 rounded border text-xs" role="region">
          <h4 className="font-bold mb-1">Notes Differ</h4>
          <p className="text-secondary">
            Both profiles contain different notes. Choose whether to keep target, overwrite, or
            append via Field Resolution Options below.
          </p>
        </div>
      ) : null}

      {conflictInventory.warnings.length > 0 ? (
        <div className="notice notice--warning" role="region">
          <p className="font-semibold">Important Considerations:</p>
          <ul className="list-disc pl-5 mt-1 space-y-1">
            {conflictInventory.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function TransferSummaryCard({ counts }: { readonly counts: ProfileReconciliationCounts }) {
  return (
    <div className="surface-card p-3 rounded border text-xs">
      <h4 className="font-bold mb-2">Records to be Consolidated</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <span className="text-secondary block">Event Rosters:</span>
          <span className="font-medium">
            {counts.eventRostersMoved} moved, {counts.eventRostersCombined} merged
          </span>
        </div>
        <div>
          <span className="text-secondary block">Dues Records:</span>
          <span className="font-medium">{counts.duesMoved}</span>
        </div>
        <div>
          <span className="text-secondary block">Poll Votes:</span>
          <span className="font-medium">{counts.pollResponsesMoved}</span>
        </div>
        <div>
          <span className="text-secondary block">Seating Seats:</span>
          <span className="font-medium">{counts.seatingAssignmentsUpdated}</span>
        </div>
        <div>
          <span className="text-secondary block">Suppressions:</span>
          <span className="font-medium">{counts.suppressionsMoved}</span>
        </div>
        <div>
          <span className="text-secondary block">History Log:</span>
          <span className="font-medium">{counts.historyRowsRetained} retained</span>
        </div>
      </div>
    </div>
  );
}

function ProfileCard({
  badge,
  badgeType,
  profile,
  title,
}: {
  readonly badge: string;
  readonly badgeType: "success" | "warning";
  readonly profile: ProfileReconciliationProfileSummary;
  readonly title: string;
}) {
  return (
    <div
      className={`surface-card p-3 rounded border ${
        badgeType === "success" ? "border-success" : "border-warning"
      }`}
    >
      <div className="flex justify-between items-start mb-2">
        <span className="font-bold text-sm">{title}</span>
        <span className={`badge badge--${badgeType} text-xs`}>{badge}</span>
      </div>
      <dl className="text-xs space-y-1">
        <div>
          <dt className="text-secondary inline">ID: </dt>
          <dd className="font-mono text-xs inline">{profile.id}</dd>
        </div>
        <div>
          <dt className="text-secondary inline">Name: </dt>
          <dd className="font-medium inline">{profile.displayName}</dd>
        </div>
        <div>
          <dt className="text-secondary inline">Part: </dt>
          <dd className="inline">
            {profile.voicePart || "None"} {profile.isSectionLeader ? "(Section Leader)" : ""}
          </dd>
        </div>
        <div>
          <dt className="text-secondary inline">Status: </dt>
          <dd className="inline">
            {profile.globalStatus}
            {profile.statusIsManual ? " (Manual override)" : " (Automatic)"}
          </dd>
        </div>
        <div>
          <dt className="text-secondary inline">Phone: </dt>
          <dd className="inline">{profile.phone || "None"}</dd>
        </div>
        <div>
          <dt className="text-secondary inline">Email Preference: </dt>
          <dd className="inline">{profile.doNotEmail ? "Do Not Email" : "Normal"}</dd>
        </div>
        <div>
          <dt className="text-secondary inline">Directory: </dt>
          <dd className="inline">{profile.showInDirectory ? "Visible" : "Hidden"}</dd>
        </div>
        {profile.createdAt ? (
          <div>
            <dt className="text-secondary inline">Created: </dt>
            <dd className="inline">{profile.createdAt}</dd>
          </div>
        ) : null}
        {profile.updatedAt ? (
          <div>
            <dt className="text-secondary inline">Updated: </dt>
            <dd className="inline">{profile.updatedAt}</dd>
          </div>
        ) : null}
        {profile.providerEmailSuppressed ? (
          <div>
            <dt className="text-secondary inline">Email Suppression: </dt>
            <dd className="inline text-danger font-semibold">Suppressed by Provider</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-secondary inline">Notes: </dt>
          <dd className="inline">{profile.notes || "None"}</dd>
        </div>
      </dl>
    </div>
  );
}

function FieldChoicesSection({
  fieldChoices,
  onNotesChoice,
  onPhoneChoice,
  preview,
}: {
  readonly fieldChoices: ProfileReconciliationFieldChoices;
  readonly onNotesChoice: (val: "keep_target" | "append_source" | "overwrite_with_source") => void;
  readonly onPhoneChoice: (val: "keep_target" | "overwrite_with_source") => void;
  readonly preview: ProfileReconciliationPreviewResponse;
}) {
  const hasPhoneChoice = Boolean(preview.sourceProfile.phone);
  const hasNotesChoice = Boolean(preview.sourceProfile.notes);

  if (!hasPhoneChoice && !hasNotesChoice) return null;

  return (
    <div className="surface-card p-3 rounded border space-y-3">
      <h3 className="font-bold text-sm">Field Resolution Options</h3>
      {hasPhoneChoice ? (
        <div>
          <label className="text-xs font-semibold block" htmlFor="phone-choice">
            Phone Number Choice:
          </label>
          <select
            className="select select--small w-full mt-1"
            id="phone-choice"
            onChange={(e) => {
              const val = e.target.value;
              if (val === "keep_target" || val === "overwrite_with_source") {
                onPhoneChoice(val);
              }
            }}
            value={fieldChoices.phone}
          >
            <option value="keep_target">
              Keep target ({preview.targetProfile.phone || "None"})
            </option>
            <option value="overwrite_with_source">
              Use source phone ({preview.sourceProfile.phone})
            </option>
          </select>
        </div>
      ) : null}

      {hasNotesChoice ? (
        <div>
          <label className="text-xs font-semibold block" htmlFor="notes-choice">
            Notes Choice:
          </label>
          <select
            className="select select--small w-full mt-1"
            id="notes-choice"
            onChange={(e) => {
              const val = e.target.value;
              if (
                val === "keep_target" ||
                val === "append_source" ||
                val === "overwrite_with_source"
              ) {
                onNotesChoice(val);
              }
            }}
            value={fieldChoices.notes}
          >
            <option value="keep_target">Keep target notes</option>
            <option value="append_source">Append source notes to target notes</option>
            <option value="overwrite_with_source">Overwrite with source notes</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}

function ExecutionNotice({ result }: { readonly result: ProfileReconciliationResponse }) {
  if (result.status === "pending_repair") {
    return (
      <div className="notice notice--warning" role="alert">
        <p className="font-semibold">
          Reconciliation Partially Applied (Pending Background Repair)
        </p>
        <p className="text-sm mt-1">{result.message}</p>
        <p className="text-sm mt-2 text-secondary">
          The membership has been relinked to the canonical profile, but some operational records
          could not be transferred immediately. A background repair process will finish
          consolidating the remaining records.
        </p>
        <div className="mt-4 flex justify-end">
          <DialogClose asChild>
            <button className="button button--secondary button--control-height" type="button">
              Close
            </button>
          </DialogClose>
        </div>
      </div>
    );
  }

  return (
    <div className="notice notice--success" role="status">
      <p>{result.message}</p>
      <div className="mt-4 flex justify-end">
        <DialogClose asChild>
          <button className="button button--primary button--control-height" type="button">
            Done
          </button>
        </DialogClose>
      </div>
    </div>
  );
}

function CandidateSelector({
  candidates,
  eligibleProfiles,
  loadingCandidates,
  onSelectTarget,
  selectedTargetId,
}: {
  readonly candidates: readonly ProfileReconciliationCandidate[];
  readonly eligibleProfiles: readonly OrganizationProfile[];
  readonly loadingCandidates: boolean;
  readonly onSelectTarget: (id: string) => void;
  readonly selectedTargetId: string;
}) {
  return (
    <div className="surface-card p-4 rounded border">
      <label className="form-label font-bold" htmlFor="target-profile-select">
        Target Canonical Profile to Keep:
      </label>
      <p className="text-sm text-secondary mb-2">
        Select the existing unlinked Profile whose ID, historical attendance, and records should be
        preserved.
      </p>

      {loadingCandidates ? (
        <p className="text-sm italic">Scanning for potential duplicates…</p>
      ) : candidates.length > 0 ? (
        <div className="mb-3">
          <span className="text-xs font-semibold text-secondary">Suggested Matches:</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {candidates.map((cand) => (
              <button
                className={`button button--small ${
                  selectedTargetId === cand.id ? "button--primary" : "button--secondary"
                }`}
                key={cand.id}
                onClick={() => {
                  onSelectTarget(cand.id);
                }}
                type="button"
              >
                {cand.displayName} ({cand.voicePart || "No Part"})
                <span className="ml-1 opacity-75">· {cand.matchReasons.join(", ")}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <select
        className="select w-full"
        id="target-profile-select"
        onChange={(e) => {
          onSelectTarget(e.target.value);
        }}
        value={selectedTargetId}
      >
        <option value="">-- Choose target profile --</option>
        {eligibleProfiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName} {p.voicePart ? `(${p.voicePart})` : ""} · {p.globalStatus}
          </option>
        ))}
      </select>
    </div>
  );
}

function MembershipSummaryCard({
  preview,
}: {
  readonly preview: ProfileReconciliationPreviewResponse;
}) {
  return (
    <div className="surface-card p-3 rounded border text-xs" role="region">
      <h4 className="font-bold mb-1">Verified Membership</h4>
      <dl className="space-y-1">
        <div>
          <dt className="text-secondary inline">Name: </dt>
          <dd className="font-medium inline">{preview.memberName}</dd>
        </div>
        <div>
          <dt className="text-secondary inline">Email: </dt>
          <dd className="inline">{preview.memberEmail}</dd>
        </div>
        <div>
          <dt className="text-secondary inline">Role: </dt>
          <dd className="inline">{preview.memberRole}</dd>
        </div>
        <div>
          <dt className="text-secondary inline">Membership ID: </dt>
          <dd className="font-mono inline">{preview.membershipId}</dd>
        </div>
      </dl>
    </div>
  );
}

function PreviewSection({
  confirmedSamePerson,
  fieldChoices,
  onConfirmedSamePersonChange,
  onNotesChoice,
  onPhoneChoice,
  preview,
}: {
  readonly confirmedSamePerson: boolean;
  readonly fieldChoices: ProfileReconciliationFieldChoices;
  readonly onConfirmedSamePersonChange: (confirmed: boolean) => void;
  readonly onNotesChoice: (notes: ProfileReconciliationFieldChoices["notes"]) => void;
  readonly onPhoneChoice: (phone: ProfileReconciliationFieldChoices["phone"]) => void;
  readonly preview: ProfileReconciliationPreviewResponse;
}) {
  return (
    <>
      <MembershipSummaryCard preview={preview} />
      {preview.status === "already_consolidated" ? (
        <div className="notice notice--info" role="status">
          <p className="font-semibold">These profiles are already consolidated.</p>
          <p className="text-sm mt-1">
            The source profile is already linked to or consolidated with this canonical profile. No
            further merge actions are needed.
          </p>
        </div>
      ) : null}

      <ConflictNotices conflictInventory={preview.conflictInventory} />

      {preview.conflictInventory.transferCounts ? (
        <TransferSummaryCard counts={preview.conflictInventory.transferCounts} />
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ProfileCard
          badge="Will be retired"
          badgeType="warning"
          profile={preview.sourceProfile}
          title="Source Profile"
        />
        <ProfileCard
          badge="Preserved canonical"
          badgeType="success"
          profile={preview.targetProfile}
          title="Target Profile"
        />
      </div>

      <FieldChoicesSection
        fieldChoices={fieldChoices}
        onNotesChoice={onNotesChoice}
        onPhoneChoice={onPhoneChoice}
        preview={preview}
      />

      {preview.canReconcile && preview.status !== "already_consolidated" ? (
        <div className="pt-2">
          <label className="flex items-center gap-2 cursor-pointer font-medium text-sm">
            <input
              checked={confirmedSamePerson}
              onChange={(e) => {
                onConfirmedSamePersonChange(e.target.checked);
              }}
              type="checkbox"
            />
            <span>I confirm that both profiles represent the same individual.</span>
          </label>
        </div>
      ) : null}
    </>
  );
}

function ResolveDuplicateContent({
  allProfiles,
  linkedProfileIds,
  membershipId,
  onReconciled,
  sourceProfileId,
}: {
  readonly allProfiles: readonly OrganizationProfile[];
  readonly linkedProfileIds?: ReadonlySet<string> | undefined;
  readonly membershipId: string;
  readonly onReconciled?: ((canonicalProfileId: string) => void) | undefined;
  readonly sourceProfileId: string;
}) {
  const [candidates, setCandidates] = useState<readonly ProfileReconciliationCandidate[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<ProfileReconciliationPreviewResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<ProfileReconciliationResponse | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [confirmedSamePerson, setConfirmedSamePerson] = useState(false);
  const [idempotencyKey] = useState(
    () => `rec-${membershipId}-${crypto.randomUUID().slice(0, 16)}`,
  );

  const [fieldChoices, setFieldChoices] = useState<ProfileReconciliationFieldChoices>({
    notes: "keep_target",
    phone: "keep_target",
  });

  useEffect(() => {
    let active = true;
    void getProfileReconciliationCandidates(membershipId)
      .then((res) => {
        if (!active) return;
        setCandidates(res.candidates);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setErrorMessage(
          err instanceof AuthApiError ? err.message : "Failed to load candidate duplicates.",
        );
      })
      .finally(() => {
        if (active) setLoadingCandidates(false);
      });

    return () => {
      active = false;
    };
  }, [membershipId]);

  useEffect(() => {
    if (!selectedTargetId) return;

    let active = true;

    void previewProfileReconciliation({
      membershipId,
      targetProfileId: selectedTargetId,
    })
      .then((res) => {
        if (!active) return;
        setPreview(res);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPreview(null);
        setErrorMessage(
          err instanceof AuthApiError ? err.message : "Could not preview profile reconciliation.",
        );
      })
      .finally(() => {
        if (active) setLoadingPreview(false);
      });

    return () => {
      active = false;
    };
  }, [selectedTargetId, membershipId]);

  function handleSelectTarget(targetId: string) {
    setSelectedTargetId(targetId);
    setLoadingPreview(Boolean(targetId));
    setErrorMessage(null);
    setPreview(null);
    setConfirmedSamePerson(false);
    setFieldChoices({ notes: "keep_target", phone: "keep_target" });
  }

  async function handleConfirmMerge() {
    if (!preview || !confirmedSamePerson) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await executeProfileReconciliation({
        confirmedSamePerson: true,
        expectedSourceProfileId: sourceProfileId,
        fieldChoices,
        idempotencyKey,
        membershipId,
        previewRevision: preview.previewRevision,
        targetProfileId: selectedTargetId,
      });

      setExecutionResult(result);
      if (onReconciled) {
        onReconciled(result.canonicalProfileId);
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof AuthApiError
          ? err.message
          : "An unexpected error occurred while merging profiles.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const eligibleProfiles = allProfiles.filter(
    (p) => p.id !== sourceProfileId && !p.hidden && !linkedProfileIds?.has(p.id),
  );

  return (
    <div className="space-y-4" style={{ maxWidth: "700px" }}>
      {errorMessage ? (
        <div className="notice notice--error" role="alert">
          <p>{errorMessage}</p>
        </div>
      ) : null}

      {executionResult ? (
        <ExecutionNotice result={executionResult} />
      ) : (
        <>
          <CandidateSelector
            candidates={candidates}
            eligibleProfiles={eligibleProfiles}
            loadingCandidates={loadingCandidates}
            onSelectTarget={handleSelectTarget}
            selectedTargetId={selectedTargetId}
          />

          {loadingPreview ? (
            <p className="text-center italic py-4">Checking records and generating preview…</p>
          ) : preview ? (
            <PreviewSection
              confirmedSamePerson={confirmedSamePerson}
              fieldChoices={fieldChoices}
              onConfirmedSamePersonChange={setConfirmedSamePerson}
              onNotesChoice={(notes) => {
                setFieldChoices((prev) => ({ ...prev, notes }));
              }}
              onPhoneChoice={(phone) => {
                setFieldChoices((prev) => ({ ...prev, phone }));
              }}
              preview={preview}
            />
          ) : null}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <DialogClose asChild>
              <button
                className="button button--secondary button--control-height"
                disabled={submitting}
                type="button"
              >
                {preview?.status === "already_consolidated" ? "Close" : "Cancel"}
              </button>
            </DialogClose>
            {preview?.canReconcile && preview.status !== "already_consolidated" ? (
              <button
                className="button button--primary button--control-height"
                disabled={!confirmedSamePerson || submitting}
                onClick={() => {
                  void handleConfirmMerge();
                }}
                type="button"
              >
                {submitting ? "Merging…" : "Confirm & Merge Profiles"}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export function ResolveDuplicateDialog({
  allProfiles,
  linkedProfileIds,
  membershipEmail,
  membershipId,
  membershipName,
  onClose,
  onReconciled,
  open,
  sourceProfileId,
}: ResolveDuplicateDialogProps) {
  return (
    <Dialog
      description={`Consolidate ${membershipName}${membershipEmail ? ` (${membershipEmail})` : ""}'s signup duplicate with an existing historical profile.`}
      onClose={onClose}
      open={open}
      title="Resolve Duplicate Profile"
    >
      {open ? (
        <ResolveDuplicateContent
          allProfiles={allProfiles}
          linkedProfileIds={linkedProfileIds}
          membershipId={membershipId}
          onReconciled={onReconciled}
          sourceProfileId={sourceProfileId}
        />
      ) : null}
    </Dialog>
  );
}
