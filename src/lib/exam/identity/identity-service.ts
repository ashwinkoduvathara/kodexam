import type {
  IdDocumentType,
  IdentityStatusResponse,
  IdentityVerifyResponse,
} from "@/types/identity";
import { apiRequest } from "../api-client";

/**
 * Candidate-side identity verification. The browser only ever sends a photo,
 * a document and consent — never a status or a result. Nothing is persisted
 * in browser storage.
 */
export interface IdentityVerificationService {
  getStatus(attemptId: string): Promise<IdentityStatusResponse>;
  start(attemptId: string): Promise<IdentityStatusResponse>;
  capturePhoto(attemptId: string, photo: Blob): Promise<IdentityStatusResponse>;
  uploadDocument(
    attemptId: string,
    file: File,
    documentType: IdDocumentType,
  ): Promise<IdentityStatusResponse>;
  deleteDocument(attemptId: string): Promise<IdentityStatusResponse>;
  verify(attemptId: string): Promise<IdentityVerifyResponse>;
  retry(attemptId: string): Promise<IdentityStatusResponse>;
}

const base = (attemptId: string) => `/api/exam-attempts/${encodeURIComponent(attemptId)}/identity`;

export function fileExtension(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : "";
}

export function createHttpIdentityService(): IdentityVerificationService {
  return {
    getStatus: (id) => apiRequest("GET", `${base(id)}/status`),
    start: (id) => apiRequest("POST", `${base(id)}/start`, { json: {} }),
    capturePhoto: (id, photo) =>
      apiRequest("POST", `${base(id)}/capture`, {
        body: photo,
        headers: { "content-type": "image/jpeg" },
      }),
    uploadDocument: (id, file, documentType) =>
      apiRequest("POST", `${base(id)}/document`, {
        body: file,
        headers: {
          // Declarations only — the server re-validates the real file signature.
          "content-type": file.type || "application/octet-stream",
          "x-file-extension": fileExtension(file.name),
          "x-document-type": documentType,
        },
      }),
    deleteDocument: (id) => apiRequest("DELETE", `${base(id)}/document`),
    verify: (id) => apiRequest("POST", `${base(id)}/verify`, { json: { consent: true } }),
    retry: (id) => apiRequest("POST", `${base(id)}/retry`, { json: {} }),
  };
}

let service: IdentityVerificationService | null = null;
export function getIdentityService(): IdentityVerificationService {
  service ??= createHttpIdentityService();
  return service;
}

/** Captures one still frame from the live preview as a JPEG (un-mirrored). */
export async function captureStill(video: HTMLVideoElement, maxWidth = 1280): Promise<Blob> {
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  // Clear the canvas so the frame doesn't linger in memory longer than needed.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("Capture failed");
  return blob;
}
