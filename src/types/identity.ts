/**
 * Identity verification types shared by server and client.
 * Nothing in here may describe raw identity data — only states and minimal facts.
 */

/** Explicit verification states. Only the server moves between them. */
export const IDENTITY_VERIFICATION_STATUS = {
  NOT_STARTED: "NOT_STARTED",
  CAMERA_PENDING: "CAMERA_PENDING",
  PHOTO_CAPTURED: "PHOTO_CAPTURED",
  DOCUMENT_PENDING: "DOCUMENT_PENDING",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  PROCESSING: "PROCESSING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  EXPIRED: "EXPIRED",
} as const;
export type IdentityVerificationStatus =
  (typeof IDENTITY_VERIFICATION_STATUS)[keyof typeof IDENTITY_VERIFICATION_STATUS];

/** Government ID types a candidate may choose. The ID *number* is never collected. */
export const ID_DOCUMENT_TYPES = {
  AADHAAR: "Aadhaar Card",
  PAN: "PAN Card",
  PASSPORT: "Passport",
  DRIVING_LICENSE: "Driving Licence",
  VOTER_ID: "Voter ID",
  OTHER_GOVERNMENT_ID: "Other Government ID",
} as const;
export type IdDocumentType = keyof typeof ID_DOCUMENT_TYPES;

export const DOCUMENT_FILE_TYPES = ["JPEG", "PNG", "PDF"] as const;
export type DocumentFileType = (typeof DOCUMENT_FILE_TYPES)[number];

/** Malware scan outcome. SCAN_PENDING means "not scanned" — never presented as clean. */
export const SCAN_STATUS = {
  SCAN_PENDING: "SCAN_PENDING",
  CLEAN: "CLEAN",
  INFECTED: "INFECTED",
  SCAN_FAILED: "SCAN_FAILED",
} as const;
export type ScanStatus = (typeof SCAN_STATUS)[keyof typeof SCAN_STATUS];

/**
 * What the candidate's browser is allowed to know. Deliberately excludes
 * object references, hashes, URLs, reviewer identity and document contents.
 */
export interface IdentityStatusResponse {
  status: IdentityVerificationStatus;
  photo: { captured: boolean; capturedAt: string | null };
  document: {
    present: boolean;
    documentType: IdDocumentType | null;
    fileType: DocumentFileType | null;
    scanStatus: ScanStatus | null;
    uploadedAt: string | null;
  };
  result: {
    faceMatch: boolean | null;
    documentValid: boolean | null;
    reviewRequired: boolean;
  } | null;
  /** Server decision: VERIFIED, or under review when the exam policy allows it. */
  canProceed: boolean;
  retriesRemaining: number;
  lastError: { code: string; message: string } | null;
  limits: {
    maxDocumentBytes: number;
    maxPhotoBytes: number;
    acceptedFormats: DocumentFileType[];
  };
  /** Configured retention, so the privacy notice states the real policy. */
  retention: { documentDays: number; photoDays: number };
  serverTime: string;
}

/** Response of POST …/identity/verify — includes the updated attempt status. */
export interface IdentityVerifyResponse {
  identity: IdentityStatusResponse;
  attemptStatus: string;
}

/** Reviewer view: still minimal — no object references or URLs. */
export interface IdentityReviewResponse {
  verificationId: string;
  attemptId: string;
  examId: string;
  status: IdentityVerificationStatus;
  version: number;
  candidate: { name: string; rollNumber: string };
  photo: { present: boolean; capturedAt: string | null; sha256: string | null };
  document: {
    present: boolean;
    documentType: IdDocumentType | null;
    fileType: DocumentFileType | null;
    scanStatus: ScanStatus | null;
    sha256: string | null;
    uploadedAt: string | null;
  };
  result: {
    faceMatch: boolean | null;
    documentValid: boolean | null;
    documentReadable: boolean | null;
    verificationScore: number | null;
    reviewRequired: boolean;
    reason: string | null;
  } | null;
  reviewer: { decision: string; reviewedAt: string } | null;
}

export interface AssetAccessResponse {
  /** Short-lived signed URL. Never persisted. */
  url: string;
  expiresAt: string;
  scanStatus: ScanStatus | null;
}

export type ReviewDecision = "APPROVE" | "REJECT";
