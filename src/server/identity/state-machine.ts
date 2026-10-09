import "@tanstack/react-start/server-only";
import { API_ERROR } from "@/types/api";
import {
  IDENTITY_VERIFICATION_STATUS as S,
  type IdentityVerificationStatus,
} from "@/types/identity";
import { DomainError } from "../errors";

export type IdentityActor = "CANDIDATE" | "SYSTEM" | "REVIEWER";

/**
 * Every allowed transition and who may cause it. Anything not listed is
 * rejected — the browser can never set a status directly.
 */
const TRANSITIONS: Record<
  IdentityVerificationStatus,
  Partial<Record<IdentityVerificationStatus, readonly IdentityActor[]>>
> = {
  [S.NOT_STARTED]: { [S.CAMERA_PENDING]: ["CANDIDATE"], [S.EXPIRED]: ["SYSTEM"] },
  [S.CAMERA_PENDING]: { [S.PHOTO_CAPTURED]: ["CANDIDATE"], [S.EXPIRED]: ["SYSTEM"] },
  [S.PHOTO_CAPTURED]: {
    [S.PHOTO_CAPTURED]: ["CANDIDATE"], // retake
    [S.DOCUMENT_UPLOADED]: ["CANDIDATE"],
    [S.DOCUMENT_PENDING]: ["CANDIDATE", "SYSTEM"], // rejected upload
    [S.EXPIRED]: ["SYSTEM"],
  },
  [S.DOCUMENT_PENDING]: {
    [S.DOCUMENT_PENDING]: ["CANDIDATE", "SYSTEM"], // retake / rejected upload
    [S.DOCUMENT_UPLOADED]: ["CANDIDATE"],
    [S.EXPIRED]: ["SYSTEM"],
  },
  [S.DOCUMENT_UPLOADED]: {
    [S.DOCUMENT_UPLOADED]: ["CANDIDATE"], // replace document / retake photo
    [S.DOCUMENT_PENDING]: ["CANDIDATE", "SYSTEM"], // delete / rejected replacement
    [S.PROCESSING]: ["CANDIDATE"],
    [S.EXPIRED]: ["SYSTEM"],
  },
  [S.PROCESSING]: {
    [S.VERIFIED]: ["SYSTEM"],
    [S.FAILED]: ["SYSTEM"],
    [S.REVIEW_REQUIRED]: ["SYSTEM"],
    [S.EXPIRED]: ["SYSTEM"],
  },
  [S.REVIEW_REQUIRED]: {
    [S.VERIFIED]: ["REVIEWER"],
    [S.FAILED]: ["REVIEWER"],
    [S.EXPIRED]: ["SYSTEM"],
  },
  [S.FAILED]: { [S.CAMERA_PENDING]: ["CANDIDATE"], [S.EXPIRED]: ["SYSTEM"] },
  [S.VERIFIED]: {},
  [S.EXPIRED]: {},
};

export function canTransition(
  from: IdentityVerificationStatus,
  to: IdentityVerificationStatus,
  actor: IdentityActor,
): boolean {
  return TRANSITIONS[from]?.[to]?.includes(actor) ?? false;
}

export function assertTransition(
  from: IdentityVerificationStatus,
  to: IdentityVerificationStatus,
  actor: IdentityActor,
): void {
  if (!canTransition(from, to, actor)) {
    throw new DomainError(
      API_ERROR.INVALID_STATE,
      409,
      "This verification step isn't available right now. Refresh the page to continue.",
    );
  }
}

/** Statuses from which the candidate may still change their submission. */
export const EDITABLE_STATUSES: readonly IdentityVerificationStatus[] = [
  S.CAMERA_PENDING,
  S.PHOTO_CAPTURED,
  S.DOCUMENT_PENDING,
  S.DOCUMENT_UPLOADED,
];

export const TERMINAL_STATUSES: readonly IdentityVerificationStatus[] = [S.VERIFIED, S.EXPIRED];
