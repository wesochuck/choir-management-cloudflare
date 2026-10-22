import type { OrganizationProfile, OrganizationProfileDeleteRequest } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import { useState } from "react";

export function DeleteProfileDialog({
  candidate,
  onCancel,
  onConfirm,
}: {
  readonly candidate: OrganizationProfile | null;
  readonly onCancel: () => void;
  readonly onConfirm: (contacts: OrganizationProfileDeleteRequest["contacts"]) => void;
}) {
  // Unmount the choice when closed so every deletion starts with Keep Contacts.
  return candidate ? (
    <DeleteProfileChoice candidate={candidate} onCancel={onCancel} onConfirm={onConfirm} />
  ) : null;
}

function DeleteProfileChoice({
  candidate,
  onCancel,
  onConfirm,
}: {
  readonly candidate: OrganizationProfile;
  readonly onCancel: () => void;
  readonly onConfirm: (contacts: OrganizationProfileDeleteRequest["contacts"]) => void;
}) {
  const [contacts, setContacts] = useState<OrganizationProfileDeleteRequest["contacts"]>("keep");
  return (
    <Dialog
      description={`Are you sure you want to permanently delete ${candidate.displayName}? This cannot be undone. Profiles with memberships, invite enrollments, attendance, RSVP, dues, folder, poll, merge, message, or suppression history must be archived instead.`}
      dirty={false}
      footer={
        <>
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Cancel
            </button>
          </DialogClose>
          <button
            className="button button--danger"
            onClick={() => {
              onConfirm(contacts);
            }}
            type="button"
          >
            Delete permanently
          </button>
        </>
      }
      onClose={onCancel}
      open
      title={`Permanently delete ${candidate.displayName}?`}
    >
      <fieldset>
        <legend>Linked Contacts</legend>
        <label className="checkbox-row">
          <input
            checked={contacts === "keep"}
            name="delete-profile-contacts"
            onChange={() => {
              setContacts("keep");
            }}
            type="radio"
          />
          Keep Contacts
        </label>
        <p className="field-help">
          Remove the roster profile and unlink its Contacts. Keep their email, preferences, lists,
          messages, purchases, and donations.
        </p>
        <label className="checkbox-row">
          <input
            checked={contacts === "delete_unused"}
            name="delete-profile-contacts"
            onChange={() => {
              setContacts("delete_unused");
            }}
            type="radio"
          />
          Delete unused roster-email Contacts
        </label>
        <p className="field-help">
          Delete Contacts created solely for this profile's roster email too. Independently
          maintained Contacts and Contacts with consent, lists, messages, purchases, donations, or
          contact-import history must be kept.
        </p>
      </fieldset>
    </Dialog>
  );
}
