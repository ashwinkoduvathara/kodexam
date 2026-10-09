import "@tanstack/react-start/server-only";
import type { ScanStatus } from "@/types/identity";

export interface VerificationInput {
  photo: Uint8Array;
  document: Uint8Array;
  documentFileType: "JPEG" | "PNG" | "PDF";
  documentScanStatus: ScanStatus;
}

export interface VerificationOutcome {
  decision: "VERIFIED" | "FAILED" | "REVIEW_REQUIRED";
  faceMatch: boolean | null;
  documentValid: boolean | null;
  documentReadable: boolean | null;
  verificationScore: number | null;
  reason: string;
}

/**
 * Decides the verification result. Implementations run server-side only and
 * never receive anything the browser claims about the result.
 *
 * Rules for every implementation:
 * - uncertain or low-confidence results → REVIEW_REQUIRED (never auto-fail on confidence)
 * - FAILED only for definitive, explainable reasons
 * - never accuse the candidate of malpractice
 */
export interface IdentityVerificationProvider {
  readonly name: string;
  evaluate(input: VerificationInput): Promise<VerificationOutcome>;
}

/**
 * Default provider: no automated face-match or document-authenticity service is
 * configured, so every submission is routed to a human reviewer. It reports
 * only what is actually known (the files passed validation and are readable)
 * and leaves face match / document validity unknown (null).
 */
export const manualReviewProvider: IdentityVerificationProvider = {
  name: "manual-review",
  async evaluate(input) {
    return {
      decision: "REVIEW_REQUIRED",
      faceMatch: null,
      documentValid: null,
      documentReadable: true,
      verificationScore: null,
      reason:
        input.documentScanStatus === "SCAN_PENDING"
          ? "Automated verification is not configured and the document has not been malware-scanned."
          : "Automated verification is not configured.",
    };
  },
};

let provider: IdentityVerificationProvider = manualReviewProvider;

export function getVerificationProvider(): IdentityVerificationProvider {
  return provider;
}

export function setVerificationProviderForTests(next: IdentityVerificationProvider | null) {
  provider = next ?? manualReviewProvider;
}
