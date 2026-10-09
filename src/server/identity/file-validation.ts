import "@tanstack/react-start/server-only";
import { API_ERROR } from "@/types/api";
import type { DocumentFileType } from "@/types/identity";
import { DomainError } from "../errors";

/**
 * Server-side file validation. Nothing the client says is trusted on its own:
 * the declared extension, the declared MIME type and the actual magic bytes
 * must all agree, and the content is inspected.
 */

const EXTENSIONS: Record<string, DocumentFileType> = {
  jpg: "JPEG",
  jpeg: "JPEG",
  png: "PNG",
  pdf: "PDF",
};
const MIME_TYPES: Record<string, DocumentFileType> = {
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "application/pdf": "PDF",
};
export const CONTENT_TYPE: Record<DocumentFileType, string> = {
  JPEG: "image/jpeg",
  PNG: "image/png",
  PDF: "application/pdf",
};

const unsupported = () =>
  new DomainError(
    API_ERROR.UNSUPPORTED_DOCUMENT,
    415,
    "This file type isn't supported. Upload a JPG, PNG or PDF of your ID.",
  );
const rejected = () =>
  new DomainError(
    API_ERROR.DOCUMENT_REJECTED,
    422,
    "This file couldn't be accepted. Upload a different, clear image or PDF of your ID.",
  );

/** Identifies the real file type from its signature. */
export function sniffFileType(bytes: Uint8Array): DocumentFileType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "JPEG";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "PNG";
  if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-")
    return "PDF";
  return null;
}

export function imageDimensions(
  bytes: Uint8Array,
  type: "JPEG" | "PNG",
): { width: number; height: number } | null {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "PNG") {
    if (view.length < 24 || view.toString("latin1", 12, 16) !== "IHDR") return null;
    return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
  }
  // JPEG: walk segments until a Start-Of-Frame marker.
  let offset = 2;
  while (offset + 9 < view.length) {
    if (view[offset] !== 0xff) return null;
    const marker = view[offset + 1];
    const length = view.readUInt16BE(offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof)
      return { height: view.readUInt16BE(offset + 5), width: view.readUInt16BE(offset + 7) };
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/**
 * PDF features that can execute code or carry hidden payloads are not accepted.
 * (/OpenAction alone is common and benign — e.g. "open at page 1" — so it's allowed;
 * an OpenAction that runs JavaScript is still caught by /JavaScript or /JS.)
 */
const PDF_ACTIVE_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/;

export interface ValidatedDocument {
  fileType: DocumentFileType;
  contentType: string;
  width: number | null;
  height: number | null;
}

export function validateDocument(input: {
  bytes: Uint8Array;
  declaredMime: string | null;
  declaredExtension: string | null;
}): ValidatedDocument {
  const ext = input.declaredExtension?.toLowerCase().replace(/^\./, "") ?? "";
  const mime = input.declaredMime?.toLowerCase().split(";")[0].trim() ?? "";
  const byExt = EXTENSIONS[ext];
  const byMime = MIME_TYPES[mime];
  if (!byExt || !byMime || byExt !== byMime) throw unsupported();

  const actual = sniffFileType(input.bytes);
  if (actual !== byExt) throw unsupported(); // spoofed extension / Content-Type

  if (actual === "PDF") {
    const text = Buffer.from(input.bytes).toString("latin1");
    if (!text.slice(-2048).includes("%%EOF")) throw rejected();
    if (PDF_ACTIVE_CONTENT.test(text)) throw rejected();
    return { fileType: "PDF", contentType: CONTENT_TYPE.PDF, width: null, height: null };
  }

  const dims = imageDimensions(input.bytes, actual);
  if (!dims) throw rejected();
  if (dims.width < 300 || dims.height < 200 || dims.width > 12000 || dims.height > 12000) {
    throw new DomainError(
      API_ERROR.DOCUMENT_REJECTED,
      422,
      "The image is too small or too large to read. Upload a clear photo or scan of your ID.",
    );
  }
  return { fileType: actual, contentType: CONTENT_TYPE[actual], ...dims };
}

/** The verification photo is always a JPEG captured by the exam page. */
export function validatePhoto(bytes: Uint8Array): { width: number; height: number } {
  if (sniffFileType(bytes) !== "JPEG") throw unsupported();
  const dims = imageDimensions(bytes, "JPEG");
  if (!dims || dims.width < 320 || dims.height < 240 || dims.width > 4096 || dims.height > 4096) {
    throw rejected();
  }
  return dims;
}
