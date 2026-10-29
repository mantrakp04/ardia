import { isLinuxUtility } from "./session";

export type WindowCloseRequest = { windowId: string; rendererGeneration: string; closeGeneration: string };
export type CloseBarrierHooks = {
  quiesce(request: WindowCloseRequest): void;
  drain(): Promise<number>;
  acknowledge(request: WindowCloseRequest, watermark: number): Promise<void>;
  reject(request: WindowCloseRequest): Promise<void>;
  resume(request: WindowCloseRequest): void;
};

export const validCloseRequest = (request: WindowCloseRequest) => !!request && Object.keys(request).length === 3 &&
  Object.keys(request).every((key) => key === "windowId" || key === "rendererGeneration" || key === "closeGeneration") &&
  typeof request.windowId === "string" && request.windowId.length > 0 && request.windowId.length <= 256 &&
  typeof request.rendererGeneration === "string" && /^[1-9][0-9]{0,19}$/.test(request.rendererGeneration) &&
  typeof request.closeGeneration === "string" && /^[1-9][0-9]{0,19}$/.test(request.closeGeneration);
export const closeIdentity = (request: WindowCloseRequest) => JSON.stringify([request.windowId, request.rendererGeneration, request.closeGeneration]);
const cancelledClose = () => Object.assign(new Error("Window close cancelled"), { code: "ERR_WINDOW_CLOSE_CANCELLED" });

export function createWindowCloseBarrier(hooks: CloseBarrierHooks) {
  type Attempt = { request: WindowCloseRequest; quiesced: boolean; cancelled: boolean; resumed: boolean; promise?: Promise<void> };
  const attempts = new Map<string, Attempt>();
  const resume = (attempt: Attempt) => {
    if (!attempt.quiesced || attempt.resumed) return;
    attempt.resumed = true;
    hooks.resume(attempt.request);
  };
  const cancelled = (request: WindowCloseRequest) => {
    if (!validCloseRequest(request)) return false;
    const attempt = attempts.get(closeIdentity(request));
    if (!attempt) return false;
    attempt.cancelled = true;
    resume(attempt);
    return true;
  };
  const requestClose = (request: WindowCloseRequest): Promise<void> => {
    if (!validCloseRequest(request)) return Promise.reject(Object.assign(new Error("Invalid close identity"), { code: "ERR_WINDOW_CLOSE_STALE" }));
    const key = closeIdentity(request);
    const existing = attempts.get(key);
    if (existing) return existing.promise!;
    if (attempts.size >= 256) {
      for (const [id, attempt] of attempts) {
        if (attempt.cancelled) attempts.delete(id);
        if (attempts.size < 256) break;
      }
    }
    if (attempts.size >= 256) return Promise.reject(Object.assign(new Error("Too many pending close attempts"), { code: "ERR_WINDOW_CLOSE_LIMIT" }));
    const attempt: Attempt = { request, quiesced: false, cancelled: false, resumed: false };
    attempts.set(key, attempt);
    const current = () => { if (attempt.cancelled) throw cancelledClose(); };
    const work = Promise.resolve().then(() => {
      current();
      attempt.quiesced = true;
      hooks.quiesce(request);
    }).then(() => { current(); return hooks.drain(); }).then((watermark) => {
      current();
      return hooks.acknowledge(request, watermark);
    }).catch(async (error) => {
      if (!attempt.cancelled) {
        await hooks.reject(request);
        cancelled(request);
      }
      throw error;
    });
    attempt.promise = work;
    return work;
  };
  return Object.assign(requestClose, { cancelled });
}

export function createUtilityWindowCloser(save: () => Promise<void>, close: (id: string) => Promise<void>) {
  const pending = new Map<string, Promise<void>>();
  return (id: string): Promise<void> => {
    if (!isLinuxUtility(id)) return close(id);
    const current = pending.get(id);
    if (current) return current;
    const request = Promise.resolve().then(save).then(() => close(id));
    pending.set(id, request);
    const release = () => { if (pending.get(id) === request) pending.delete(id); };
    void request.then(release, release);
    return request;
  };
}
