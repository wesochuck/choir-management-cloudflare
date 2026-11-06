export const ROSTER_INVITE_BANNER_STORAGE_KEY = "choir.roster-invite-banner.dismissed:v1";

export interface RosterInviteBannerEligibility {
  readonly hasActiveInvite: boolean;
  readonly isAnonymous: boolean;
  readonly isDismissed: boolean;
}

export function shouldShowRosterInviteBanner(eligibility: RosterInviteBannerEligibility): boolean {
  return eligibility.hasActiveInvite && eligibility.isAnonymous && !eligibility.isDismissed;
}

export function readRosterInviteBannerDismissed(scope: string): boolean {
  if (!scope) return false;
  try {
    return sessionStorage.getItem(`${ROSTER_INVITE_BANNER_STORAGE_KEY}:${scope}`) !== null;
  } catch {
    return false;
  }
}

export function writeRosterInviteBannerDismissed(scope: string): void {
  if (!scope) return;
  try {
    sessionStorage.setItem(`${ROSTER_INVITE_BANNER_STORAGE_KEY}:${scope}`, "true");
  } catch {
    // SessionStorage quota/security errors safely ignored
  }
}
