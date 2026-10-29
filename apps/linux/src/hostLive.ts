import { LiveError, type LiveErrorKind, type LiveSourceId } from "../../browser/src/state/live/types";
import { ardiaHost, hostSupports, invokeHost, type ArdiaHost } from "./host.ts";

export const LIVE_CAPABILITIES = ["ArdiaLive.request", "ArdiaLive.connect", "ArdiaLive.cancel", "ArdiaLive.disconnect"] as const;

export const UNAVAILABLE_MESSAGE = "Live folder services are unavailable in this Linux host";

export type LinuxLiveErrorKind = LiveErrorKind | "keyringLocked" | "keyringUnavailable";

const KINDS: Record<string, LinuxLiveErrorKind> = {
  ERR_LIVE_SIGNED_OUT: "signedOut",
  ERR_LIVE_SSO: "sso",
  ERR_LIVE_RATE_LIMITED: "rateLimited",
  ERR_LIVE_NETWORK: "network",
  ERR_LIVE_KEYRING_LOCKED: "keyringLocked",
  ERR_LIVE_KEYRING_UNAVAILABLE: "keyringUnavailable",
};

export type LiveCallOptions = { signal?: AbortSignal };

export type LiveClient = {
  available(): boolean;
  request<T>(source: LiveSourceId, operation: string, params?: Record<string, unknown>, options?: LiveCallOptions): Promise<T>;
  connect<T>(source: LiveSourceId, fields: Record<string, unknown>, options?: LiveCallOptions): Promise<T>;
  disconnect(source: LiveSourceId): Promise<void>;
};

export function liveError(error: unknown, connected: boolean): LiveError {
  if (error instanceof LiveError) return error;
  const code = (error as { code?: unknown })?.code;
  const message = String((error as Error)?.message ?? error);
  if (code === "ERR_LIVE_NOT_CONNECTED") return new LiveError(connected ? "signedOut" : "notConfigured", "Not signed in");
  return new LiveError(((typeof code === "string" && KINDS[code]) || "other") as LiveErrorKind, message);
}

const cancelled = () => new LiveError("other", "Cancelled");
const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
let sequence = 0;

export function liveRequestId(random: () => number = Math.random): string {
  const salt = Array.from({ length: 12 }, () => ID_CHARS[Math.floor(random() * ID_CHARS.length)]).join("");
  return `live-${salt}-${++sequence}`;
}

export function hostLiveClient(host: ArdiaHost | undefined = ardiaHost, connected: (source: LiveSourceId) => boolean = () => false): LiveClient {
  const available = () => !!host && LIVE_CAPABILITIES.every((method) => hostSupports(method, host));
  const call = <T>(method: string, args: unknown[], source: LiveSourceId, signal?: AbortSignal, id?: string): Promise<T> => {
    if (!available()) return Promise.reject(new LiveError("other", UNAVAILABLE_MESSAGE));
    if (signal?.aborted) return Promise.reject(cancelled());
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const abort = () => {
        if (settled) return;
        settled = true;
        if (id) void invokeHost("ArdiaLive.cancel", { args: [id] }, host).catch(() => {});
        reject(cancelled());
      };
      signal?.addEventListener("abort", abort, { once: true });
      invokeHost<T>(method, { args }, host).then(
        (value) => {
          signal?.removeEventListener("abort", abort);
          if (settled) return;
          settled = true;
          resolve(value);
        },
        (error: unknown) => {
          signal?.removeEventListener("abort", abort);
          if (settled) return;
          settled = true;
          if (id && typeof (error as { code?: unknown })?.code !== "string") void invokeHost("ArdiaLive.cancel", { args: [id] }, host).catch(() => {});
          reject(liveError(error, connected(source)));
        },
      );
    });
  };
  return {
    available,
    async request<T>(source: LiveSourceId, operation: string, params: Record<string, unknown> = {}, options: LiveCallOptions = {}) {
      const id = liveRequestId();
      const reply = await call<{ body?: unknown }>("ArdiaLive.request", [source, operation, params, id], source, options.signal, id);
      if (!reply || typeof reply.body !== "string") throw new LiveError("other", "The service sent an unreadable reply");
      try {
        return JSON.parse(reply.body) as T;
      } catch {
        throw new LiveError("other", "The service sent an unreadable reply");
      }
    },
    connect<T>(source: LiveSourceId, fields: Record<string, unknown>, options: LiveCallOptions = {}) {
      const id = liveRequestId();
      return call<T>("ArdiaLive.connect", [source, fields, id], source, options.signal, id);
    },
    async disconnect(source: LiveSourceId) {
      await call<unknown>("ArdiaLive.disconnect", [source], source);
    },
  };
}
