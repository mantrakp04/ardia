import type { Download } from "@ardia/ardiacore";

export type DownloadKind = "document" | "image" | "video" | "audio" | "archive" | "app" | "other";
export type DownloadFilter = "all" | "active" | "finished" | "failed" | DownloadKind;

const KIND_EXTENSIONS: Record<Exclude<DownloadKind, "other">, string[]> = {
  document: ["pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "key", "pages", "numbers", "txt", "md", "rtf", "epub", "json"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "heic", "avif", "svg", "bmp", "tiff", "psd"],
  video: ["mp4", "mov", "m4v", "mkv", "webm", "avi"],
  audio: ["mp3", "m4a", "wav", "flac", "aac", "ogg", "aiff"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"],
  app: ["dmg", "pkg", "app", "exe", "msi", "ipa", "apk"],
};

export const DOWNLOAD_FILTERS: { id: DownloadFilter; title: string }[] = [
  { id: "all", title: "All" },
  { id: "active", title: "Active" },
  { id: "finished", title: "Finished" },
  { id: "failed", title: "Failed" },
  { id: "document", title: "Documents" },
  { id: "image", title: "Images" },
  { id: "video", title: "Video" },
  { id: "audio", title: "Audio" },
  { id: "archive", title: "Archives" },
  { id: "app", title: "Apps" },
];

export function kindOf(d: Pick<Download, "filename" | "path" | "mimeType">): DownloadKind {
  const name = (d.filename || d.path || "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  for (const [kind, exts] of Object.entries(KIND_EXTENSIONS)) if (exts.includes(ext)) return kind as DownloadKind;
  const mime = (d.mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || mime.startsWith("text/")) return "document";
  return "other";
}

export function failedOrStopped(d: Download) {
  return d.state === "failed" || d.state === "cancelled";
}

export function matchesFilter(d: Download, filter: DownloadFilter) {
  if (filter === "all") return true;
  if (filter === "active") return d.state === "downloading";
  if (filter === "finished") return d.state === "finished";
  if (filter === "failed") return failedOrStopped(d);
  return kindOf(d) === filter;
}

export function filterCounts(downloads: Download[]): Record<DownloadFilter, number> {
  const counts = Object.fromEntries(DOWNLOAD_FILTERS.map((f) => [f.id, 0])) as Record<DownloadFilter, number>;
  for (const d of downloads) for (const f of DOWNLOAD_FILTERS) if (matchesFilter(d, f.id)) counts[f.id]++;
  return counts;
}

export type DownloadsSummary = { active: number; running: number; paused: number; failed: number; speed: number; received: number; total: number; secondsLeft: number | null };

export function summarize(downloads: Download[]): DownloadsSummary {
  const active = downloads.filter((d) => d.state === "downloading");
  const running = active.filter((d) => !d.paused);
  const sized = active.filter((d) => d.total > 0);
  const speed = running.reduce((n, d) => n + Math.max(0, d.speed), 0);
  const received = sized.reduce((n, d) => n + d.received, 0);
  const total = sized.reduce((n, d) => n + d.total, 0);
  const secondsLeft = speed > 0 && total > received && sized.length === active.length ? (total - received) / speed : null;
  return { active: active.length, running: running.length, paused: active.length - running.length, failed: downloads.filter(failedOrStopped).length, speed, received, total, secondsLeft };
}

export const RESUME_CHECK_MS = 1500;

export type RetrySteps = {
  resume: (id: string) => Promise<unknown>;
  downloadAgain: (url: string) => void;
  current: (id: string) => Pick<Download, "state" | "paused"> | undefined;
  wait: (ms: number) => Promise<void>;
};

export async function retryWith(d: Pick<Download, "id" | "url" | "state">, steps: RetrySteps): Promise<"resumed" | "again" | "gone"> {
  if (d.state === "cancelled") {
    steps.downloadAgain(d.url);
    return "again";
  }
  await steps.resume(d.id).catch(() => {});
  await steps.wait(RESUME_CHECK_MS);
  const now = steps.current(d.id);
  if (!now) return "gone";
  if (now.state === "downloading" || now.state === "finished") return "resumed";
  steps.downloadAgain(d.url);
  return "again";
}
