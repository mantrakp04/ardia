import { setTimeout as delay } from "node:timers/promises";

export class CdpError extends Error {
  constructor(method, error) {
    super(`${method}: ${error?.message ?? JSON.stringify(error)}`);
    this.method = method;
    this.code = error?.code;
    this.data = error?.data;
  }
}

export async function connectCdp(url, { timeout = 5000, commandTimeout = 10000, WebSocketImpl = globalThis.WebSocket } = {}) {
  if (typeof WebSocketImpl !== "function") throw new Error("This Node.js has no WebSocket client; use Node 22 or newer");
  const socket = new WebSocketImpl(url);
  const pending = new Map();
  const listeners = new Map();
  let sequence = 0;
  let closed = false;
  let closeReason = null;
  const fail = (reason) => {
    if (closed) return;
    closed = true;
    closeReason = reason;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(`CDP connection closed during ${request.method}: ${reason}`));
    }
    pending.clear();
    for (const handlers of listeners.values()) for (const handler of handlers) handler.closed?.(reason);
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`CDP connection to ${url} timed out after ${timeout} ms`));
      try { socket.close(); } catch {}
    }, timeout);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", (event) => { clearTimeout(timer); reject(new Error(`CDP connection to ${url} failed: ${event?.message ?? "error"}`)); }, { once: true });
  });
  socket.addEventListener("close", () => fail("socket closed"));
  socket.addEventListener("error", () => fail("socket error"));
  socket.addEventListener("message", ({ data }) => {
    let message;
    try { message = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8")); } catch { return; }
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new CdpError(request.method, message.error));
      else request.resolve(message.result ?? {});
      return;
    }
    if (typeof message.method !== "string") return;
    for (const handler of listeners.get(message.method) ?? []) {
      try { handler.event(message.params ?? {}, message.sessionId); } catch {}
    }
    for (const handler of listeners.get("*") ?? []) {
      try { handler.event({ method: message.method, params: message.params ?? {} }, message.sessionId); } catch {}
    }
  });
  const on = (method, event, closedHandler) => {
    const handler = { event, closed: closedHandler };
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(handler);
    return () => listeners.get(method)?.delete(handler);
  };
  return {
    url,
    get closed() { return closed; },
    get closeReason() { return closeReason; },
    send(method, params = {}, { timeout: limit = commandTimeout, sessionId } = {}) {
      if (closed) return Promise.reject(new Error(`CDP connection closed before ${method}: ${closeReason}`));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out after ${limit} ms`));
        }, limit);
        pending.set(id, { resolve, reject, timer, method });
        try {
          socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    },
    on,
    waitFor(method, predicate = () => true, limit = commandTimeout) {
      return new Promise((resolve, reject) => {
        let off = () => {};
        const timer = setTimeout(() => { off(); reject(new Error(`Timed out after ${limit} ms waiting for ${method}`)); }, limit);
        off = on(method, (params, sessionId) => {
          let matched = false;
          try { matched = predicate(params, sessionId); } catch {}
          if (!matched) return;
          clearTimeout(timer);
          off();
          resolve(params);
        }, (reason) => { clearTimeout(timer); off(); reject(new Error(`CDP connection closed while waiting for ${method}: ${reason}`)); });
      });
    },
    async close() {
      if (closed) return;
      try { socket.close(); } catch {}
      for (let pass = 0; !closed && pass < 20; pass++) await delay(25);
      fail("closed by client");
    },
  };
}

export async function evaluate(session, expression, { timeout = 10000, awaitPromise = true, userGesture = true } = {}) {
  const result = await session.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture }, { timeout });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    throw new Error(`Evaluation failed: ${details.exception?.description ?? details.text ?? JSON.stringify(details)}`);
  }
  return result.result?.value;
}

export async function fetchJson(url, timeout = 3000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
