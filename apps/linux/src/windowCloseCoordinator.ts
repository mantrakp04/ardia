import type { ConfirmOptions } from "@ardia-real/shell";
import { validCloseRequest, closeIdentity, type WindowCloseRequest } from "./utilityClose";

export type CloseReason = "window" | "lastTab";
export type CloseAnswer = { confirmed: boolean; suppressed: boolean };
export type CloseDecision = { decision: "allow" | "cancel"; suppressWarning: boolean };
export type AbortableAsk = (options: ConfirmOptions, signal: AbortSignal) => Promise<CloseAnswer>;
export type DialogSuspension = { readonly settled: Promise<void> };
export type DrainReply = { accepted?: boolean; endsSession?: boolean } | null | undefined;
export type DecideClose = (windowId: string, reason: CloseReason, ask?: (options: ConfirmOptions) => Promise<CloseAnswer>) => Promise<CloseDecision>;

export type WindowCloseCoordinatorHooks = {
  windowId: string;
  utility: boolean;
  decide: DecideClose;
  ask?: AbortableAsk;
  suppress(reason: CloseReason): void;
  flush(): Promise<void>;
  request(windowId: string): Promise<WindowCloseRequest>;
  beginDrain(request: WindowCloseRequest): Promise<DrainReply>;
  reject(request: WindowCloseRequest): Promise<void>;
  barrier(request: WindowCloseRequest): Promise<void>;
  cancelled(request: WindowCloseRequest): boolean;
  suspendDialogs?(request: WindowCloseRequest): DialogSuspension;
  resumeDialogs?(suspension: DialogSuspension): boolean;
  report?(error: unknown): void;
};

const ATTEMPT_LIMIT = 256;
const cancelledClose = () => Object.assign(new Error("Window close cancelled"), { code: "ERR_WINDOW_CLOSE_CANCELLED" });
const staleClose = () => Object.assign(new Error("Window close is no longer current"), { code: "ERR_WINDOW_CLOSE_STALE" });

export function createWindowCloseCoordinator(hooks: WindowCloseCoordinatorHooks) {
  type Attempt = {
    request: WindowCloseRequest;
    reason: CloseReason;
    quitting: boolean;
    controller: AbortController;
    cancelled: boolean;
    suspension?: DialogSuspension;
    dialogsResumed: boolean;
    departing: boolean;
    undecided: boolean;
    rejecting?: Promise<void>;
    promise?: Promise<void>;
  };
  const attempts = new Map<string, Attempt>();
  let latest: string | undefined;
  let nextReason: CloseReason | undefined;

  const resumeDialogs = (attempt: Attempt) => {
    if (!attempt.suspension || attempt.dialogsResumed) return;
    attempt.dialogsResumed = true;
    hooks.resumeDialogs?.(attempt.suspension);
  };
  const confirmCancelled = (attempt: Attempt) => {
    if (!attempt.cancelled) {
      attempt.cancelled = true;
      attempt.controller.abort();
    }
    resumeDialogs(attempt);
  };
  const rejectAttempt = async (attempt: Attempt) => {
    await hooks.reject(attempt.request);
    confirmCancelled(attempt);
  };
  const rejectUndecided = (attempt: Attempt) => {
    if (!attempt.rejecting) {
      const rejecting: Promise<void> = rejectAttempt(attempt).finally(() => {
        if (attempt.rejecting === rejecting) attempt.rejecting = undefined;
      });
      attempt.rejecting = rejecting;
    }
    return attempt.rejecting;
  };
  const current = (attempt: Attempt, key: string) => !attempt.cancelled && latest === key && attempt.request.windowId === hooks.windowId;
  const settleOnAbort = <T,>(attempt: Attempt, work: Promise<T>) => new Promise<T>((resolve, reject) => {
    if (attempt.controller.signal.aborted) return reject(cancelledClose());
    attempt.controller.signal.addEventListener("abort", () => reject(cancelledClose()), { once: true });
    work.then(resolve, reject);
  });

  const decision = (attempt: Attempt): Promise<CloseDecision> => {
    if (hooks.utility || attempt.quitting) return Promise.resolve({ decision: "allow", suppressWarning: false });
    const ask = hooks.ask;
    const signal = attempt.controller.signal;
    return hooks.decide(hooks.windowId, attempt.reason, ask ? (options) => ask(options, signal) : undefined);
  };

  const run = async (attempt: Attempt, key: string) => {
    let decided: CloseDecision;
    try {
      decided = await settleOnAbort(attempt, decision(attempt));
    } catch (error) {
      if (!attempt.cancelled) {
        attempt.undecided = true;
        await rejectUndecided(attempt).catch((rejection) => hooks.report?.(rejection));
      }
      throw error;
    }
    const { decision: choice, suppressWarning } = decided;
    if (!current(attempt, key)) throw attempt.cancelled ? cancelledClose() : staleClose();
    if (suppressWarning) hooks.suppress(attempt.reason);
    if (choice === "cancel") {
      const rejected = rejectAttempt(attempt);
      if (suppressWarning) await hooks.flush().catch((error) => hooks.report?.(error));
      await rejected;
      throw cancelledClose();
    }
    let drain: DrainReply;
    try {
      drain = await hooks.beginDrain(attempt.request);
    } catch (error) {
      if (!attempt.cancelled) await rejectAttempt(attempt).catch((rejection) => hooks.report?.(rejection));
      throw error;
    }
    if (!current(attempt, key)) throw attempt.cancelled ? cancelledClose() : staleClose();
    attempt.departing = !hooks.utility && drain?.endsSession === false;
    if (suppressWarning) {
      try {
        await hooks.flush();
      } catch (error) {
        if (current(attempt, key)) await rejectAttempt(attempt);
        throw error;
      }
    }
    if (!current(attempt, key)) throw attempt.cancelled ? cancelledClose() : staleClose();
    attempt.suspension = hooks.suspendDialogs?.(attempt.request);
    if (attempt.suspension) await attempt.suspension.settled;
    if (attempt.cancelled) {
      confirmCancelled(attempt);
      throw cancelledClose();
    }
    await hooks.barrier(attempt.request);
  };

  const evict = () => {
    for (const key of attempts.keys()) {
      if (attempts.size < ATTEMPT_LIMIT) return;
      if (key !== latest) attempts.delete(key);
    }
  };

  const accept = (request: WindowCloseRequest, { quitting = false }: { quitting?: boolean } = {}): Promise<void> => {
    if (request?.windowId !== hooks.windowId) return Promise.resolve();
    if (!validCloseRequest(request)) return Promise.reject(staleClose());
    const key = closeIdentity(request);
    const existing = attempts.get(key);
    if (existing?.undecided && !existing.cancelled) {
      existing.promise = rejectUndecided(existing).then(() => { throw cancelledClose(); });
      return existing.promise;
    }
    if (existing) return existing.promise!;
    evict();
    const attempt: Attempt = {
      request: { windowId: request.windowId, rendererGeneration: request.rendererGeneration, closeGeneration: request.closeGeneration },
      reason: nextReason ?? "window",
      quitting,
      controller: new AbortController(),
      cancelled: false,
      dialogsResumed: false,
      departing: false,
      undecided: false,
    };
    nextReason = undefined;
    attempts.set(key, attempt);
    latest = key;
    attempt.promise = run(attempt, key);
    return attempt.promise;
  };

  const cancelled = (request: WindowCloseRequest) => {
    if (!validCloseRequest(request) || request.windowId !== hooks.windowId) return false;
    const attempt = attempts.get(closeIdentity(request));
    if (attempt && !attempt.cancelled) {
      attempt.cancelled = true;
      attempt.controller.abort();
    }
    const resumed = hooks.cancelled(request);
    if (attempt) confirmCancelled(attempt);
    return resumed || !!attempt;
  };

  const producersResumed = (request: WindowCloseRequest) => {
    const attempt = validCloseRequest(request) ? attempts.get(closeIdentity(request)) : undefined;
    if (attempt) confirmCancelled(attempt);
  };

  const close = async (reason: CloseReason) => {
    nextReason = reason;
    try {
      return await accept(await hooks.request(hooks.windowId));
    } finally {
      if (nextReason === reason) nextReason = undefined;
    }
  };

  const closeWindow = async (id: string) => {
    if (id === hooks.windowId) return close("window");
    await accept(await hooks.request(id));
  };

  const departs = (request: WindowCloseRequest) => {
    const attempt = validCloseRequest(request) ? attempts.get(closeIdentity(request)) : undefined;
    return !!attempt?.departing && !attempt.cancelled;
  };

  return { accept, cancelled, producersResumed, close, closeWindow, departs };
}
