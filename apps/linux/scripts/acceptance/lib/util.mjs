import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

export class DeadlineError extends Error {}

const cancellation = new AsyncLocalStorage();

export function withSignal(signal, body) {
  return cancellation.run(signal, body);
}

export function currentSignal() {
  return cancellation.getStore() ?? null;
}

export function throwIfCancelled(signal = currentSignal()) {
  if (signal?.aborted) throw signal.reason;
}

export function whenCancelled(signal, reject) {
  if (!signal) return () => {};
  const onAbort = () => reject(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

export async function pause(ms, signal = currentSignal()) {
  throwIfCancelled(signal);
  await delay(ms, undefined, signal ? { signal } : undefined).catch((error) => {
    if (signal?.aborted) throw signal.reason;
    throw error;
  });
}

export async function settles(promise, timeout) {
  let timer;
  const settled = promise.then(() => true, () => true);
  try {
    return await Promise.race([settled, new Promise((resolve) => { timer = setTimeout(resolve, timeout, false); })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function until(test, { timeout = 15000, interval = 100, label = "condition", abort, signal = currentSignal() } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  let lastValue;
  while (Date.now() < deadline) {
    throwIfCancelled(signal);
    const reason = abort?.();
    if (reason) throw new Error(`${label} aborted: ${reason}`);
    try {
      lastValue = await test();
      if (lastValue) return lastValue;
    } catch (error) {
      last = error;
    }
    await pause(interval, signal);
  }
  const suffix = last ? `: ${last.message}` : lastValue !== undefined ? `; last value ${JSON.stringify(lastValue)}` : "";
  throw new DeadlineError(`Timed out after ${timeout} ms waiting for ${label}${suffix}`);
}

export async function withDeadline(promise, timeout, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new DeadlineError(`${label} exceeded its ${timeout} ms deadline`)), timeout); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const js = (value) => JSON.stringify(value);

export function nonce(prefix = "n") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function errorText(error) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}
