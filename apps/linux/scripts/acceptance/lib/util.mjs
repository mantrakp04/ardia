import { setTimeout as delay } from "node:timers/promises";

export class DeadlineError extends Error {}

export async function until(test, { timeout = 15000, interval = 100, label = "condition", abort } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  let lastValue;
  while (Date.now() < deadline) {
    const reason = abort?.();
    if (reason) throw new Error(`${label} aborted: ${reason}`);
    try {
      lastValue = await test();
      if (lastValue) return lastValue;
    } catch (error) {
      last = error;
    }
    await delay(interval);
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
