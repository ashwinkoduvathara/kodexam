/**
 * Wire format of the External Candidate Exam Invite Portal.
 * Invites let a coordinator admit a candidate who has no Kodeversity LMS account.
 */

export interface VerifyInviteRequest {
  fullName: string;
  email: string;
  code: string;
}

export interface VerifyInviteResponse {
  /** Where the browser goes next (the existing exam flow). The session cookie is set by the response. */
  redirectTo: string;
}

/** Display format of an invite code: KP-XXXX-XXXX (no ambiguous characters). */
export const INVITE_CODE_PATTERN = /^KP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** Accepts what people type ("kp abcd efgh", "ABCDEFGH") and returns KP-XXXX-XXXX, or null. */
export function normalizeInviteCode(input: string): string | null {
  let compact = input.toUpperCase().replace(/[\s-]/g, "");
  // The "KP" prefix is optional when typing; the body is always 8 characters.
  if (compact.length === 10 && compact.startsWith("KP")) compact = compact.slice(2);
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(compact)) return null;
  return `KP-${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Case- and whitespace-insensitive name key for comparison (Unicode NFKC-normalized). */
export const nameKey = (name: string) =>
  name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
