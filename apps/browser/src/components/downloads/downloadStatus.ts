import type { useDownload } from "../../state/windows/hooks";

type Download = NonNullable<ReturnType<typeof useDownload>>;

function formatBytes(n: number) {
  if (n < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec left`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min left`;
  return `${Math.round(seconds / 3600)} hr left`;
}

export const awaitsKeep = (d: Download) => d.state === "downloading" && d.dangerous === true;

export function dangerWarning(d: Download, short = false) {
  if (d.url.startsWith("http:")) return short ? "Blocked: not secure" : "Insecure download blocked";
  return short ? "Blocked: unsafe file type" : "This type of file can harm your computer";
}

export function downloadStatus(d: Download, exists = true) {
  if (d.state === "finished") return exists ? formatBytes(d.total > 0 ? d.total : d.received) : "Deleted";
  if (d.state === "failed") return "Failed to Download";
  if (d.state === "cancelled") return "Cancelled";
  if (awaitsKeep(d)) return dangerWarning(d);
  const progress = d.total > 0 ? `${formatBytes(d.received)} of ${formatBytes(d.total)}` : formatBytes(d.received);
  if (d.paused) return `${progress} — Paused`;
  if (d.speed > 0 && d.total > 0) return `${progress}, ${formatBytes(d.speed)}/s — ${formatDuration((d.total - d.received) / d.speed)}`;
  return progress;
}
