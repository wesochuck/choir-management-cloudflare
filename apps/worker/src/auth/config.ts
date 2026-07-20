export const authenticationPolicy = {
  allowPublicRegistration: false,
  organizationMfaRequired: false,
  platformAdministratorMfaRequired: true,
  primarySignInMethod: "email-one-time-code",
  userManagedPasswords: true,
} as const;

export type AuthenticationPolicy = typeof authenticationPolicy;
