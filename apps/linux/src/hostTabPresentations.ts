import type { ArdiaHost } from "./host";
import type { HostTab } from "./hostTab";
import { invokeHost } from "./host.ts";
import { reserveTab } from "./hostTabQueue.ts";

type Update = { visible: boolean; resolve(): void; reject(error: unknown): void };
type Entry = {
  tab: HostTab;
  owns(): boolean;
  reservation: ReturnType<typeof reserveTab>;
  status: "pending" | "ready" | "failed";
  error?: unknown;
  updates: Update[];
};
type Batch = { host: ArdiaHost; entries: Map<string, Entry>; sealed: boolean; scheduled: boolean };
const collecting = new WeakMap<ArdiaHost, Batch>();

function finish(entry: Entry, failed = false, error?: unknown) {
  for (const update of entry.updates) {
    if (failed) update.reject(error);
    else update.resolve();
  }
  entry.reservation.finish();
}

function flush(batch: Batch) {
  batch.scheduled = false;
  batch.sealed = true;
  if (collecting.get(batch.host) === batch) collecting.delete(batch.host);
  const ready: Entry[] = [];
  for (const [key, entry] of batch.entries) {
    if (entry.status === "pending") continue;
    batch.entries.delete(key);
    if (entry.status === "failed") finish(entry, true, entry.error);
    else if (entry.tab.disposed || !entry.owns()) finish(entry);
    else ready.push(entry);
  }
  if (!ready.length) return;
  const tabs = ready.map((entry) => ({
    id: entry.tab.identity!.browserId,
    claim: entry.tab.claim,
    visible: entry.updates.at(-1)!.visible,
  }));
  void invokeHost("tab.presentations", { tabs }, batch.host).then(
    () => ready.forEach((entry) => finish(entry)),
    (error) => ready.forEach((entry) => finish(entry, true, error)),
  );
}

function schedule(batch: Batch) {
  if (batch.scheduled) return;
  batch.scheduled = true;
  queueMicrotask(() => flush(batch));
}

export function queueTabPresentation(tab: HostTab, visible: boolean, owns: () => boolean): Promise<void> {
  let batch = collecting.get(tab.host);
  const existing = batch?.entries.get(tab.key);
  if (!batch || batch.sealed || (existing && (existing.tab !== tab || !existing.reservation.isTail()))) {
    batch = { host: tab.host, entries: new Map(), sealed: false, scheduled: false };
    collecting.set(tab.host, batch);
  }
  let entry = batch.entries.get(tab.key);
  if (!entry) {
    entry = { tab, owns, reservation: reserveTab(tab.host, tab.key), status: "pending", updates: [] };
    batch.entries.set(tab.key, entry);
    const pending = entry;
    const group = batch;
    void entry.reservation.previous.then(() => tab.ready).then(
      () => { pending.status = "ready"; schedule(group); },
      (error) => { pending.status = "failed"; pending.error = error; schedule(group); },
    );
  }
  const updates = entry.updates;
  return new Promise<void>((resolve, reject) => updates.push({ visible, resolve, reject }));
}
