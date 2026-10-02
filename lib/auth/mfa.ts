export const MFA_COOKIE = "fanela_mfa";
export const MFA_TTL_MS = 5 * 60 * 1000; // pending_mfa: minutes, not hours (spec §10)

// B3: TOTP MFA mandatory for these roles; optional for others
export const MFA_MANDATORY_ROLES = ["admin", "ops", "dispatch"] as const;

export const RECOVERY_CODE_COUNT = 8;
