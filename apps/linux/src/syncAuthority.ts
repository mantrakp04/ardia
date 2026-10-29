export const SYNC_AUTHORITY_LOCK = "ardia.linux.sync-authority";
export const SYNC_CHANNEL = "ardia.linux.sync";
export const RENEW_MS = 10_000;
export const CLAIM_RETRY_MS = 5_000;
export const CALL_TIMEOUT_MS = 30_000;
export const INTERACTIVE_CALL_TIMEOUT_MS = 900_000;
export const AUTHORITY_WAIT_MS = 10_000;
export const BECOME_RETRY_MAX_MS = 60_000;
export const NO_AUTHORITY_MESSAGE = "Sync runs in an Ardia browser window, and none answered. Open a browser window and try again.";

export const REMOTE_METHODS = [
  "syncNow",
  "turnOnSync",
  "enterRecoveryPhrase",
  "stopSync",
  "setTypeSynced",
  "setProfileSynced",
  "addRemoteProfile",
  "adoptProfileTheme",
  "useFolder",
] as const;

export type RemoteMethod = (typeof REMOTE_METHODS)[number];
export type SyncRemote = Record<RemoteMethod, (...args: never[]) => unknown>;
export type Role = "client" | "claiming" | "authority" | "unavailable";

export type StoreLike<S> = {
  getState(): S;
  setState(state: S, replace: true): void;
  subscribe(listener: (state: S) => void): () => void;
};

export type ChannelLike = {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
};

export type LocksLike = {
  request(name: string, options: { mode: "exclusive" }, callback: () => Promise<void>): Promise<unknown>;
};

export type Timers = {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export type AuthorityOptions<S> = {
  id: string;
  candidate: boolean;
  locks?: LocksLike;
  channel: ChannelLike | null;
  mirror: StoreLike<S>;
  claim(): Promise<{ granted: boolean }>;
  release(): Promise<void>;
  become(): Promise<{ store: StoreLike<S>; remote: SyncRemote }>;
  present?(state: S): S;
  timers?: Timers;
  onRole?(role: Role): void;
  report?(error: unknown): void;
};

type Message<S> =
  | { kind: "hello"; from: string }
  | { kind: "state"; from: string; state: S }
  | { kind: "gone"; from: string }
  | { kind: "call"; from: string; id: string; method: RemoteMethod; args: unknown[] }
  | { kind: "result"; to: string; id: string; ok: boolean; value?: unknown; error?: string };

const PERMANENT_CLAIM_ERRORS = new Set(["ERR_PRIVATE_SERVICE", "ERR_UNKNOWN_CALL"]);
const isRemote = (method: unknown): method is RemoteMethod => typeof method === "string" && (REMOTE_METHODS as readonly string[]).includes(method);

const defaultTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function startSyncAuthority<S>(options: AuthorityOptions<S>) {
  const { id, channel, mirror } = options;
  const timers = options.timers ?? defaultTimers;
  const report = options.report ?? ((error: unknown) => console.warn("[ardia linux] sync authority", error));
  const present = options.present ?? ((state: S) => state);
  let role: Role = options.candidate ? "claiming" : "client";
  let remote: SyncRemote | null = null;
  let stopped = false;
  let sequence = 0;
  let renewal: unknown;
  let unsubscribe: (() => void) | null = null;
  let releaseLock: (() => void) | null = null;
  let leader: string | null = null;
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: unknown }>();
  const arrivals = new Set<() => void>();

  const setRole = (next: Role) => {
    role = next;
    options.onRole?.(next);
    if (next === "authority") arrived();
  };
  const arrived = () => {
    for (const resolve of [...arrivals]) resolve();
    arrivals.clear();
  };
  const settle = (callId: string, error: Error) => {
    const entry = pending.get(callId);
    if (!entry) return;
    pending.delete(callId);
    timers.clear(entry.timer);
    entry.reject(error);
  };
  const post = (message: Message<S>) => {
    try {
      channel?.postMessage(message);
    } catch (error) {
      report(error);
    }
  };
  const wait = (ms: number) => new Promise<void>((resolve) => timers.set(resolve, ms));

  async function runRemote(method: RemoteMethod, args: unknown[]) {
    const run = remote?.[method] as ((...values: unknown[]) => unknown) | undefined;
    if (!run) throw new Error(NO_AUTHORITY_MESSAGE);
    return await run(...args);
  }

  channel?.addEventListener("message", (event) => {
    if (stopped) return;
    const message = event.data as Message<S>;
    if (!message || typeof message !== "object") return;
    if (message.kind === "state" && role !== "authority" && message.from !== id) {
      leader = message.from;
      mirror.setState(message.state, true);
      arrived();
    } else if (message.kind === "gone" && message.from === leader) {
      leader = null;
      for (const callId of [...pending.keys()]) settle(callId, new Error(NO_AUTHORITY_MESSAGE));
      post({ kind: "hello", from: id });
    } else if (message.kind === "hello" && role === "authority" && remote) {
      post({ kind: "state", from: id, state: present(mirror.getState()) });
    } else if (message.kind === "call" && role === "authority" && message.from !== id && isRemote(message.method)) {
      void runRemote(message.method, Array.isArray(message.args) ? message.args : []).then(
        (value) => post({ kind: "result", to: message.from, id: message.id, ok: true, value }),
        (error: unknown) => post({ kind: "result", to: message.from, id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    } else if (message.kind === "result" && message.to === id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      timers.clear(entry.timer);
      if (message.ok) entry.resolve(message.value);
      else entry.reject(new Error(message.error ?? "Sync failed in another window"));
    }
  });

  async function claimUntilGranted(): Promise<boolean> {
    while (!stopped) {
      try {
        if ((await options.claim()).granted) return true;
      } catch (error) {
        if (PERMANENT_CLAIM_ERRORS.has((error as { code?: string })?.code ?? "")) {
          setRole("unavailable");
          return false;
        }
        report(error);
      }
      await wait(CLAIM_RETRY_MS);
    }
    return false;
  }

  function renew() {
    renewal = timers.set(() => {
      if (stopped) return;
      void options.claim().then(
        (claim) => {
          if (!claim.granted) report(new Error("The native sync lease is held by another renderer"));
        },
        report,
      ).finally(() => {
        if (!stopped) renew();
      });
    }, RENEW_MS);
  }

  async function lead() {
    let became: Awaited<ReturnType<typeof options.become>> | null = null;
    for (let attempt = 0; !became; attempt++) {
      if (!(await claimUntilGranted()) || stopped) return;
      try {
        became = await options.become();
      } catch (error) {
        report(error);
        await options.release().catch(report);
        if (stopped) return;
        await wait(Math.min(CLAIM_RETRY_MS * 2 ** attempt, BECOME_RETRY_MAX_MS));
      }
    }
    if (stopped) return;
    remote = became.remote;
    setRole("authority");
    const publish = (state: S) => {
      const shown = present(state);
      mirror.setState(shown, true);
      post({ kind: "state", from: id, state: shown });
    };
    publish(became.store.getState());
    unsubscribe = became.store.subscribe(publish);
    renew();
  }

  if (options.candidate) {
    if (options.locks) {
      options.locks
        .request(SYNC_AUTHORITY_LOCK, { mode: "exclusive" }, async () => {
          if (stopped) return;
          await lead().catch(report);
          if (role !== "authority") return;
          await new Promise<void>((resolve) => (releaseLock = resolve));
        })
        .catch((error: unknown) => {
          report(error);
          if (role === "claiming") setRole("client");
        });
    } else {
      void lead().catch(report);
    }
  }
  post({ kind: "hello", from: id });

  function whenLeaderKnown(): Promise<boolean> {
    if (role === "authority" || leader) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => {
        timers.clear(timer);
        arrivals.delete(done);
        resolve(role === "authority" || !!leader);
      };
      const timer = timers.set(done, AUTHORITY_WAIT_MS);
      arrivals.add(done);
      post({ kind: "hello", from: id });
    });
  }

  return {
    role: () => role,
    isAuthority: () => role === "authority",
    async call(method: RemoteMethod, args: unknown[], timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
      if (role === "authority") return runRemote(method, args);
      if (!channel || stopped || !(await whenLeaderKnown())) throw new Error(NO_AUTHORITY_MESSAGE);
      if ((role as Role) === "authority") return runRemote(method, args);
      const callId = `${id}:${++sequence}`;
      return new Promise((resolve, reject) => {
        const timer = timers.set(() => {
          if (pending.delete(callId)) reject(new Error(NO_AUTHORITY_MESSAGE));
        }, timeoutMs);
        pending.set(callId, { resolve, reject, timer });
        post({ kind: "call", from: id, id: callId, method, args });
      });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      timers.clear(renewal);
      unsubscribe?.();
      for (const [, entry] of pending) {
        timers.clear(entry.timer);
        entry.reject(new Error("This window closed"));
      }
      pending.clear();
      const wasAuthority = role === "authority";
      remote = null;
      setRole("client");
      arrived();
      if (wasAuthority) {
        post({ kind: "gone", from: id });
        void options.release().catch(report);
      }
      releaseLock?.();
      channel?.close();
    },
  };
}

export type SyncAuthority = ReturnType<typeof startSyncAuthority>;
