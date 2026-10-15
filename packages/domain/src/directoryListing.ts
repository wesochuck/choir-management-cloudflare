export interface DirectoryListingCandidate {
  readonly globalStatus: string;
  readonly hidden: boolean;
  readonly showInDirectory: boolean;
}

/**
 * Evaluates whether a profile is effectively listed in the Organization member directory.
 * Matches the authoritative query in listDirectoryProfiles:
 * global_status != 'Inactive' AND show_in_directory = 1 AND hidden = 0
 */
export function isProfileDirectoryListed(candidate: DirectoryListingCandidate): boolean {
  return candidate.globalStatus !== "Inactive" && !candidate.hidden && candidate.showInDirectory;
}

/**
 * Returns an accessible, human-readable reason why a profile is not listed in the directory.
 * When a profile is effectively listed, returns null.
 */
export function getDirectoryListingReason(candidate: DirectoryListingCandidate): string | null {
  if (isProfileDirectoryListed(candidate)) {
    return null;
  }
  if (!candidate.showInDirectory) {
    return "Not listed: directory preference off";
  }
  if (candidate.hidden) {
    return "Not listed: off roster";
  }
  if (candidate.globalStatus === "Inactive") {
    return "Not listed: inactive";
  }
  return "Not listed";
}
