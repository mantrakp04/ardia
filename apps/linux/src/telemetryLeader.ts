export const TELEMETRY_LOCK = "ardia.linux.telemetry";
export const TELEMETRY_CHANNEL = "ardia.linux.telemetry";
const MAX_HELD = 500;
const MAX_ANSWERS = 100;

export type Relayed =
  | { kind: "capture"; event: string; props: Record<string, unknown>; options: Record<string, unknown> }
  | { kind: "log"; level: "warn" | "error"; message: string; attributes: Record<string, string | number | boolean> };

export type TelemetryOp = "reset" | "end" | "reopen";

type Wire =
  | { kind: "relay"; id: string; message: Relayed }
  | { kind: "ack"; id: string }
  | { kind: "request"; id: string; op: TelemetryOp; arg?: string }
  | { kind: "reply"; id: string; ok: boolean; value?: unknown }
  | { kind: "leader" };

export type LeaderLocks = {
  request(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => Promise<void>): Promise<unknown>;
  request(name: string, callback: (lock: unknown) => Promise<void>): Promise<unknown>;
};

export type LeaderChannel = { postMessage(message: unknown): void; onmessage: ((event: { data: unknown }) => void) | null };

export type TelemetryLeadershipDeps = {
  candidate: boolean;
  locks?: LeaderLocks;
  channel: LeaderChannel | null;
  relay(next: ((message: Relayed) => void) | null): void;
  deliver(message: Relayed): void;
  handle(op: TelemetryOp, arg?: string): Promise<unknown>;
  lead(): Promise<void>;
  report(error: unknown): void;
  newId?: () => string;
};

export type TelemetryLeadership = { leading(): boolean; request(op: TelemetryOp, timeoutMs: number, arg?: string): Promise<unknown> };

const isFields = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const OPS: readonly string[] = ["reset", "end", "reopen"];

export function isRelayed(value: unknown): value is Relayed {
  if (!isFields(value)) return false;
  if (value.kind === "capture") return typeof value.event === "string" && isFields(value.props) && isFields(value.options);
  if (value.kind === "log") return (value.level === "warn" || value.level === "error") && typeof value.message === "string" && isFields(value.attributes);
  return false;
}

function isWire(value: unknown): value is Wire {
  if (!isFields(value)) return false;
  if (value.kind === "leader") return true;
  if (typeof value.id !== "string") return false;
  if (value.kind === "relay") return isRelayed(value.message);
  if (value.kind === "ack") return true;
  if (value.kind === "request") return typeof value.op === "string" && OPS.includes(value.op) && (value.arg === undefined || typeof value.arg === "string");
  if (value.kind === "reply") return typeof value.ok === "boolean";
  return false;
}

const unanswered = () => Object.assign(new Error("No telemetry owner answered"), { code: "ERR_TELEMETRY_OWNER" });

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(unanswered()), timeoutMs);
    work.then((value) => (clearTimeout(timer), resolve(value)), (error: unknown) => (clearTimeout(timer), reject(error)));
  });
}

export function startTelemetryLeadership(deps: TelemetryLeadershipDeps): TelemetryLeadership {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const channel = deps.channel;
  const post = (message: Wire) => channel?.postMessage(message);
  let role: "pending" | "follower" | "becoming" | "leader" = "pending";
  const held: Relayed[] = [];
  const unacked = new Map<string, Relayed>();
  const heard: { id: string; message: Relayed }[] = [];
  const asked: { id: string; op: TelemetryOp; arg?: string }[] = [];
  const answers = new Map<string, Promise<unknown>>();
  const waiting = new Map<string, { op: TelemetryOp; arg?: string; resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>();

  const send = (message: Relayed) => {
    const id = newId();
    unacked.set(id, message);
    if (unacked.size > MAX_HELD) unacked.delete(unacked.keys().next().value!);
    post({ kind: "relay", id, message });
  };
  const askAgain = () => {
    for (const [id, { op, arg }] of waiting) post({ kind: "request", id, op, ...(arg === undefined ? {} : { arg }) });
  };
  const resend = () => {
    for (const [id, message] of unacked) post({ kind: "relay", id, message });
    askAgain();
  };
  const run = (id: string, op: TelemetryOp, arg?: string) => {
    let work = answers.get(id);
    if (!work) {
      work = deps.handle(op, arg);
      answers.set(id, work);
      if (answers.size > MAX_ANSWERS) answers.delete(answers.keys().next().value!);
    }
    return work;
  };
  const answer = (id: string, op: TelemetryOp, arg?: string) =>
    run(id, op, arg).then((value) => post({ kind: "reply", id, ok: true, value }), (error: unknown) => {
      deps.report(error);
      post({ kind: "reply", id, ok: false });
    });
  const settle = (id: string, ok: boolean, value?: unknown) => {
    const request = waiting.get(id);
    if (!request) return;
    waiting.delete(id);
    clearTimeout(request.timer);
    if (ok) request.resolve(value);
    else request.reject(unanswered());
  };

  deps.relay((message) => {
    if (role === "follower") send(message);
    else if (held.length < MAX_HELD) held.push(message);
  });

  if (channel) channel.onmessage = (event) => {
    const data = event.data;
    if (!isWire(data)) return;
    if (role === "leader") {
      if (data.kind === "relay") {
        deps.deliver(data.message);
        post({ kind: "ack", id: data.id });
      } else if (data.kind === "request") void answer(data.id, data.op, data.arg);
    } else if (role === "becoming") {
      if (data.kind === "relay" && heard.length < MAX_HELD) heard.push({ id: data.id, message: data.message });
      else if (data.kind === "request") asked.push({ id: data.id, op: data.op, arg: data.arg });
    } else if (data.kind === "ack") unacked.delete(data.id);
    else if (data.kind === "reply") settle(data.id, data.ok, data.value);
    else if (data.kind === "leader" && role === "follower") resend();
  };

  const follow = () => {
    role = "follower";
    for (const message of held.splice(0)) send(message);
    askAgain();
  };

  const become = async (): Promise<void> => {
    role = "becoming";
    try {
      await deps.lead();
    } catch (error) {
      deps.report(error);
    }
    role = "leader";
    deps.relay(null);
    for (const message of [...unacked.values(), ...held.splice(0)]) deps.deliver(message);
    unacked.clear();
    for (const { id, message } of heard.splice(0)) {
      deps.deliver(message);
      post({ kind: "ack", id });
    }
    for (const { id, op, arg } of asked.splice(0)) void answer(id, op, arg);
    for (const [id, { op, arg }] of [...waiting]) void run(id, op, arg).then((value) => settle(id, true, value), () => settle(id, false));
    post({ kind: "leader" });
    return new Promise<void>(() => {});
  };

  const locks = deps.locks;
  if (!deps.candidate) follow();
  else if (!locks) void become();
  else {
    locks.request(TELEMETRY_LOCK, { ifAvailable: true }, async (lock) => {
      if (lock) return become();
      follow();
      locks.request(TELEMETRY_LOCK, () => become()).catch(deps.report);
    }).catch(deps.report);
  }

  return {
    leading: () => role === "leader",
    request: (op, timeoutMs, arg) => {
      if (role === "leader") return withTimeout(deps.handle(op, arg), timeoutMs);
      return new Promise((resolve, reject) => {
        const id = newId();
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(unanswered());
        }, timeoutMs);
        waiting.set(id, { op, arg, resolve, reject, timer });
        if (role === "follower") post({ kind: "request", id, op, ...(arg === undefined ? {} : { arg }) });
      });
    },
  };
}
