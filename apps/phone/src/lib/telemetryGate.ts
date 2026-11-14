import { EVENTS_SCOPE, eventRecord, logsRequest, outcome } from "@ardia/core/src/telemetryWire.ts";
import {
  buildRecord,
  counted,
  parseDaily,
  recordProblems,
  resourceFor,
  rollOver,
  usageProps,
  utcDay,
  type Counted,
  type DailyCounts,
  type DeviceFacts,
  type EventProps,
  type PhoneEvent,
  type PhoneRecord,
} from "./telemetrySchema.ts";

export const SHARING_KEY = "telemetry.sharing";
export const INSTALL_KEY = "telemetry.installId";
export const DAILY_KEY = "telemetry.daily";

const MAX_QUEUED = 500;
const BATCH_SIZE = 100;
const FLUSH_DELAY_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type GateStore = { read: (key: string) => string | null; write: (key: string, value: string | null) => void };

export type GateDeps = {
  store: GateStore;
  post: (body: string, signal: AbortSignal) => Promise<number>;
  canPost: () => boolean;
  newId: () => string;
  device: () => DeviceFacts;
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
  onChange?: (sharing: boolean) => void;
};

export type SharingSource = EventProps<"sharing_turned_on">["source"];

export function createGate(deps: GateDeps) {
  let sharing = false;
  let installId: string | null = null;
  let sessionId: string | null = null;
  let queue: PhoneRecord[] = [];
  let generation = 0;
  let timer: unknown = null;
  let flushing = false;
  let failures = 0;
  const inflight = new Set<AbortController>();

  function load() {
    const id = deps.store.read(INSTALL_KEY);
    installId = id && ID_PATTERN.test(id) ? id : null;
    sharing = deps.store.read(SHARING_KEY) === "on" && installId !== null;
    if (!sharing) deps.store.write(DAILY_KEY, null);
  }

  const isSharing = () => sharing && installId !== null;

  const decided = () => deps.store.read(SHARING_KEY) !== null;

  function schedule(ms: number) {
    if (!isSharing() || timer !== null) return;
    timer = deps.setTimer(() => {
      timer = null;
      void flush();
    }, ms);
  }

  function capture<E extends PhoneEvent>(event: E, props: EventProps<E>) {
    if (!isSharing()) return;
    sessionId ??= deps.newId();
    const record = buildRecord(event, props, { uuid: deps.newId(), installId: installId!, sessionId }, deps.device(), deps.now());
    if (recordProblems(record).length) return;
    queue.push(record);
    if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);
    schedule(FLUSH_DELAY_MS);
  }

  function emitDue(due: DailyCounts | null) {
    if (due) capture("usage_counts", usageProps(due));
  }

  function count(field: Counted) {
    if (!isSharing()) return;
    const next = counted(parseDaily(deps.store.read(DAILY_KEY)), field, utcDay(deps.now()));
    deps.store.write(DAILY_KEY, JSON.stringify(next.state));
    emitDue(next.due);
  }

  function countingWindow(): (field: Counted) => void {
    const opened = isSharing() ? generation : null;
    return (field) => {
      if (opened !== null && opened === generation) count(field);
    };
  }

  function rollDaily() {
    if (!isSharing()) return;
    const next = rollOver(parseDaily(deps.store.read(DAILY_KEY)), utcDay(deps.now()));
    deps.store.write(DAILY_KEY, JSON.stringify(next.state));
    emitDue(next.due);
  }

  async function flush() {
    if (!isSharing() || flushing || !queue.length || !deps.canPost()) return;
    flushing = true;
    const gen = generation;
    try {
      while (queue.length && gen === generation) {
        const batch = queue.slice(0, BATCH_SIZE);
        const body = logsRequest(resourceFor(deps.device()), EVENTS_SCOPE, batch.map((record) => eventRecord(record)));
        const abort = new AbortController();
        inflight.add(abort);
        let status = 0;
        try {
          status = await deps.post(body, abort.signal);
        } catch {
          status = 0;
        } finally {
          inflight.delete(abort);
        }
        if (gen !== generation) return;
        const result = outcome(status, batch.length);
        if (result === "retry") {
          failures++;
          schedule(Math.min(MAX_BACKOFF_MS, FLUSH_DELAY_MS * 2 ** (failures - 1)));
          return;
        }
        failures = 0;
        queue = queue.filter((record) => !batch.includes(record));
      }
    } finally {
      flushing = false;
    }
  }

  function setSharing(on: boolean, source: SharingSource) {
    if (on === isSharing()) {
      deps.store.write(SHARING_KEY, on ? "on" : "off");
      return;
    }
    generation++;
    failures = 0;
    if (!on) {
      sharing = false;
      for (const abort of inflight) abort.abort();
      inflight.clear();
      queue = [];
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
      deps.store.write(SHARING_KEY, "off");
      deps.store.write(DAILY_KEY, null);
      deps.onChange?.(false);
      return;
    }
    installId ??= deps.newId();
    deps.store.write(INSTALL_KEY, installId);
    deps.store.write(SHARING_KEY, "on");
    sharing = true;
    deps.onChange?.(true);
    capture("sharing_turned_on", { source });
  }

  const flushNow = () => void flush();

  const pending = () => queue.length;

  return { load, isSharing, decided, capture, count, countingWindow, rollDaily, setSharing, flushNow, pending };
}

export type TelemetryGate = ReturnType<typeof createGate>;
