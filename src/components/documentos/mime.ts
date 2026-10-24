/**
 * Regras de arquivos aceitos no bucket "documentos" (espelham `allowed_mime_types`
 * e `file_size_limit` definidos na migração). Usado no navegador (validação
 * prévia) e nas Server Actions (validação definitiva).
 */
export const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB

const DOC_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
] as const;

const EXT_TO_MIME: Record<string, (typeof DOC_MIME_TYPES)[number]> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
};

export const DOC_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt,.csv";

export const isAllowedMime = (mime: string | null | undefined) => !!mime && (DOC_MIME_TYPES as readonly string[]).includes(mime);

/** Resolve o MIME do arquivo (alguns navegadores enviam vazio para .heic/.csv). */
export function resolveMime(name: string, type: string | null | undefined): string | null {
  if (isAllowedMime(type)) return type as string;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  // Excel no Windows costuma reportar CSV como application/vnd.ms-excel
  return EXT_TO_MIME[ext] ?? null;
}

/** Nome seguro para a chave do Storage: sem acentos, espaços ou caracteres especiais. */
export function sanitizeFileName(name: string) {
  const parts = name.normalize("NFD").replace(/[̀-ͯ]/g, "").split(".");
  const ext = parts.length > 1 ? (parts.pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) : "";
  const base =
    parts
      .join(".")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/[-.]{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 100) || "arquivo";
  return ext ? `${base}.${ext}` : base;
}

export function formatBytes(bytes: number | null | undefined) {
  const b = Number(bytes ?? 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB`;
  return `${(b / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

export type DocKind = "pdf" | "image" | "sheet" | "word" | "text" | "other";

export function docKind(mime: string | null | undefined): DocKind {
  if (!mime) return "other";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("spreadsheet") || mime === "application/vnd.ms-excel" || mime === "text/csv") return "sheet";
  if (mime.includes("word") || mime === "application/vnd.google-apps.document") return "word";
  if (mime.startsWith("text/")) return "text";
  return "other";
}
