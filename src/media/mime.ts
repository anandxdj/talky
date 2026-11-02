import path from "node:path";
import { compactText } from "../utils";

export function guessMimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

export function isImageExt(ext: string): boolean {
  return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"].includes(ext);
}

export function isVideoExt(ext: string): boolean {
  return [".mp4", ".mov", ".mkv", ".webm"].includes(ext);
}

export function isAudioExt(ext: string): boolean {
  return [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"].includes(ext);
}

export function normalizeGeminiInlineMimeType(mimeType: string): string {
  const raw = compactText(mimeType).toLowerCase();
  if (!raw) return "application/octet-stream";
  const base = raw.split(";")[0]?.trim() ?? raw;
  if (!base) return "application/octet-stream";
  if (base === "audio/opus") return "audio/ogg";
  return base;
}
