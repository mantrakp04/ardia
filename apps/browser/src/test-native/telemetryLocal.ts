import type { ShellNativeModules, TelemetryLocalExport } from "@ardia/shell";

const DAY_MS = 86_400_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const lineAt = (line: string) => Number(/^\{"at":(\d+)/.exec(line)?.[1] ?? NaN);

export const telemetryLocal = {
  files: new Map<string, string>(),
  appendCalls: 0,
  appendNowCalls: 0,
  maxBytes: 8 * 1_048_576,
  keepDays: 7,
  dropped: 0,
  exports: [] as { since?: number; now?: number; text: string }[],
  reset() {
    this.files.clear();
    this.appendCalls = this.appendNowCalls = this.dropped = 0;
    this.exports = [];
  },
  lines(): string[] {
    return [...this.files.keys()].sort().flatMap((day) => this.files.get(day)!.split("\n").filter(Boolean));
  },
  records(): Record<string, unknown>[] {
    return this.lines().map((line) => JSON.parse(line));
  },
  bytes(): number {
    let total = 0;
    for (const text of this.files.values()) total += new TextEncoder().encode(text).length;
    return total;
  },
};

function write(day: string, text: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !text) return;
  telemetryLocal.files.set(day, (telemetryLocal.files.get(day) ?? "") + text);
}

function prune(now: number) {
  const cutoff = now - telemetryLocal.keepDays * DAY_MS;
  for (const day of [...telemetryLocal.files.keys()]) {
    if (day < utcDay(cutoff) || day > utcDay(now + DAY_MS)) {
      telemetryLocal.dropped += telemetryLocal.files.get(day)!.split("\n").filter(Boolean).length;
      telemetryLocal.files.delete(day);
    }
  }
  const oldest = [...telemetryLocal.files.keys()].sort()[0];
  if (oldest === utcDay(cutoff)) {
    const lines = telemetryLocal.files.get(oldest)!.split("\n").filter(Boolean);
    const kept = lines.filter((line) => !(lineAt(line) < cutoff));
    telemetryLocal.dropped += lines.length - kept.length;
    if (kept.length) telemetryLocal.files.set(oldest, kept.map((l) => `${l}\n`).join(""));
    else telemetryLocal.files.delete(oldest);
  }
  const target = telemetryLocal.maxBytes - Math.floor(telemetryLocal.maxBytes / 10);
  let total = telemetryLocal.bytes();
  if (total > telemetryLocal.maxBytes) {
    for (const day of [...telemetryLocal.files.keys()].sort()) {
      if (total <= target) break;
      const lines = telemetryLocal.files.get(day)!.split("\n").filter(Boolean);
      let cut = 0;
      while (cut < lines.length && total > target) total -= new TextEncoder().encode(lines[cut++]!).length + 1;
      telemetryLocal.dropped += cut;
      if (cut < lines.length) telemetryLocal.files.set(day, lines.slice(cut).map((l) => `${l}\n`).join(""));
      else telemetryLocal.files.delete(day);
    }
  }
  const dropped = telemetryLocal.dropped;
  telemetryLocal.dropped = 0;
  return { bytes: telemetryLocal.bytes(), lines: telemetryLocal.lines().length, files: telemetryLocal.files.size, droppedLines: dropped, pruneMs: 0.5, writeMs: [0.1, 0.2] };
}

function exported(text: string): TelemetryLocalExport {
  return { path: "/tmp/fake/local-events.jsonl.gz", bytes: text.length, lines: text.split("\n").filter(Boolean).length };
}

export const telemetryLocalModule: ShellNativeModules["ArdiaTelemetryLocal"] = {
  append: (day, text) => (telemetryLocal.appendCalls++, write(day, text)),
  appendNow: (day, text) => (telemetryLocal.appendNowCalls++, write(day, text)),
  configure: (maxBytes, keepDays) => void Object.assign(telemetryLocal, { maxBytes, keepDays }),
  prune: async (now) => prune(now),
  clear: async () => void telemetryLocal.files.clear(),
  exportForReport: async (since) => {
    const text = telemetryLocal.lines().filter((line) => !(lineAt(line) < since)).map((l) => `${l}\n`).join("");
    telemetryLocal.exports.push({ since, text });
    return exported(text);
  },
  exportToDownloads: async (now) => {
    const text = telemetryLocal.lines().map((l) => `${l}\n`).join("");
    telemetryLocal.exports.push({ now, text });
    return { ...exported(text), path: "/tmp/fake/Ardia data.jsonl" };
  },
};
