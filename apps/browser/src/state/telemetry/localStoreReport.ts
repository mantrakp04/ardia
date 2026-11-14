import { capture, queuedChars } from "./client";
import { pruneLocalStore, type LocalStoreReading } from "./localStore";
import { percentile, takePostStats } from "./transport";

export const LOCAL_STORE_EVENT = "telemetry_local_store";

const round = (ms: number) => Math.round(ms * 100) / 100;
const p95 = (values: number[]) => (values.length ? round(percentile([...values].sort((a, b) => a - b), 0.95)) : null);
const max = (values: number[]) => (values.length ? round(Math.max(...values)) : null);

export function localStoreProperties(reading: LocalStoreReading, posts: ReturnType<typeof takePostStats>, queueBytes: number) {
  return {
    bytes: reading.bytes,
    lines: reading.lines,
    files: reading.files,
    write_ms_p95: p95(reading.writeMs),
    write_ms_max: max(reading.writeMs),
    writes: reading.writeMs.length,
    flush_js_ms_p95: p95(reading.flushMs),
    flushes: reading.flushes,
    prune_ms: round(reading.pruneMs),
    lines_dropped: reading.droppedLines,
    lines_oversize: reading.oversize,
    lines_recorded: reading.recorded,
    bytes_recorded: reading.recordedChars,
    buffered_max: reading.bufferedMax,
    write_failures: reading.failures,
    queue_bytes: queueBytes,
    bytes_posted: posts.bytes,
    posts: posts.requests,
    failed_posts: posts.failed,
  };
}

let launchPrune: ReturnType<typeof setTimeout> | undefined;

export async function reportLocalStore() {
  const reading = await pruneLocalStore(Date.now(), true);
  if (!reading) return null;
  const props = localStoreProperties(reading, takePostStats(), queuedChars());
  capture(LOCAL_STORE_EVENT, props);
  return props;
}

export function startLocalStore(delayMs: number) {
  clearTimeout(launchPrune);
  launchPrune = setTimeout(() => void pruneLocalStore(Date.now(), false), delayMs);
}
