import { useRef, useState, type DragEvent } from "react";
import { CloudUpload, FileText, Loader2, ShieldCheck, ShieldQuestion, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fileExtension } from "@/lib/exam/identity/identity-service";
import { cn } from "@/lib/utils";
import {
  ID_DOCUMENT_TYPES,
  type IdDocumentType,
  type IdentityStatusResponse,
} from "@/types/identity";
import { SectionHeading } from "../instructions/SectionHeading";

const ACCEPT = ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf";
const ALLOWED_EXT = ["jpg", "jpeg", "png", "pdf"];

export interface LocalDocumentPreview {
  /** Object URL for images selected in this page session (never fetched from the server). */
  url: string | null;
  sizeBytes: number;
}

interface GovernmentIdUploadProps {
  document: IdentityStatusResponse["document"];
  limits: IdentityStatusResponse["limits"];
  preview: LocalDocumentPreview | null;
  /** Upload is only possible once the photo has been captured. */
  enabled: boolean;
  uploading: boolean;
  deleting: boolean;
  error: string | null;
  onUpload: (file: File, documentType: IdDocumentType) => void;
  onDelete: () => void;
}

const formatMb = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

export function GovernmentIdUpload({
  document,
  limits,
  preview,
  enabled,
  uploading,
  deleting,
  error,
  onUpload,
  onDelete,
}: GovernmentIdUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState<IdDocumentType | "">(
    document.documentType ?? "",
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  /** Friendly pre-checks only — the server re-validates everything. */
  const submit = (file: File | undefined) => {
    setLocalError(null);
    if (!file) return;
    if (!documentType) return setLocalError("Select the type of ID first.");
    if (!ALLOWED_EXT.includes(fileExtension(file.name))) {
      return setLocalError("Upload a JPG, PNG or PDF of your ID.");
    }
    if (file.size > limits.maxDocumentBytes) {
      return setLocalError(`This file is larger than ${formatMb(limits.maxDocumentBytes)}.`);
    }
    onUpload(file, documentType);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (enabled && !uploading) submit(e.dataTransfer.files[0]);
  };

  const busy = uploading || deleting;
  const shownError = localError ?? error;

  return (
    <section
      aria-labelledby="idv-document-heading"
      data-section="document"
      className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <SectionHeading
          id="idv-document-heading"
          icon={FileText}
          title="Government ID Verification"
          description="Upload a clear image of your government issued ID proof."
        />
        <p className="shrink-0 text-[11px] text-slate-500">
          Accepted formats:{" "}
          {limits.acceptedFormats.map((f) => (f === "JPEG" ? "JPG" : f)).join(", ")} (Max{" "}
          {formatMb(limits.maxDocumentBytes)})
        </p>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-3">
        <div className="flex flex-col gap-2">
          <label htmlFor="idv-document-type" className="text-[11px] font-bold text-slate-600">
            ID type
          </label>
          <select
            id="idv-document-type"
            value={documentType}
            disabled={!enabled || busy}
            onChange={(e) => setDocumentType(e.target.value as IdDocumentType)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-navy disabled:opacity-60"
          >
            <option value="">Select ID type…</option>
            {Object.entries(ID_DOCUMENT_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <div
            role="button"
            tabIndex={enabled && !busy ? 0 : -1}
            aria-disabled={!enabled || busy}
            aria-describedby="idv-document-help"
            onClick={() => enabled && !busy && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && enabled && !busy) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (enabled) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-3 text-center transition-colors",
              enabled && !busy
                ? "cursor-pointer border-slate-200 hover:border-brand/40 hover:bg-brand-soft/30"
                : "cursor-not-allowed border-slate-100 opacity-60",
              dragging && "border-brand bg-brand-soft/40",
            )}
          >
            {uploading ? (
              <Loader2 className="h-7 w-7 animate-spin text-brand" aria-hidden />
            ) : (
              <CloudUpload className="h-7 w-7 text-brand" aria-hidden />
            )}
            <p className="mt-1.5 text-xs text-navy">
              <span className="font-bold">
                {uploading ? "Uploading and checking…" : "Click to upload"}
              </span>
              {!uploading && " or drag and drop"}
            </p>
            <p id="idv-document-help" className="mt-1 text-[11px] text-slate-500">
              {enabled
                ? "Upload a clear image of your ID (Aadhaar, PAN, Passport, Driving Licence, etc.)"
                : "Capture your photo first, then upload your ID."}
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              submit(e.target.files?.[0]);
              e.target.value = ""; // never keep the file in the input
            }}
          />
          {shownError && (
            <p role="alert" className="text-[11px] font-semibold text-red-700">
              {shownError}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col justify-center rounded-xl border border-slate-100 bg-slate-50/70 p-3">
          {document.present ? (
            <>
              <div className="flex items-start gap-2.5">
                {preview?.url ? (
                  <img
                    src={preview.url}
                    alt="Preview of your uploaded ID"
                    className="h-16 w-24 rounded-lg object-cover ring-1 ring-slate-200"
                  />
                ) : (
                  <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-white text-brand ring-1 ring-slate-200">
                    <FileText className="h-7 w-7" aria-hidden />
                  </span>
                )}
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="text-xs font-bold text-navy">
                    {document.documentType
                      ? ID_DOCUMENT_TYPES[document.documentType]
                      : "ID document"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {document.fileType === "JPEG" ? "JPG" : document.fileType}
                    {preview && ` · ${formatMb(preview.sizeBytes)}`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onDelete}
                  disabled={!enabled || busy}
                  aria-label="Remove uploaded ID"
                  className="h-8 w-8 shrink-0 rounded-lg text-slate-500 hover:text-red-600"
                >
                  {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                </Button>
              </div>
              <p
                className={cn(
                  "mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold",
                  document.scanStatus === "CLEAN" ? "text-brand-strong" : "text-amber-800",
                )}
              >
                {document.scanStatus === "CLEAN" ? (
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ShieldQuestion className="h-3.5 w-3.5" aria-hidden />
                )}
                {document.scanStatus === "CLEAN"
                  ? "Uploaded · security scan passed"
                  : "Uploaded · security scan pending (checked during review)"}
              </p>
            </>
          ) : (
            <p className="text-center text-[11px] text-slate-500">No ID uploaded yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
