import type { ArdiaHost } from "./host";

const operations = new WeakMap<ArdiaHost, Map<string, Promise<void>>>();

function queueFor(host: ArdiaHost) {
  const queue = operations.get(host) ?? new Map<string, Promise<void>>();
  operations.set(host, queue);
  return queue;
}

function publish(queue: Map<string, Promise<void>>, key: string, settled: Promise<void>) {
  queue.set(key, settled);
  void settled.then(() => {
    if (queue.get(key) === settled) queue.delete(key);
  });
}

export function enqueueTab<T>(host: ArdiaHost, key: string, operation: () => Promise<T>): Promise<T> {
  const queue = queueFor(host);
  const task = (queue.get(key) ?? Promise.resolve()).then(operation);
  publish(queue, key, task.then(() => {}, () => {}));
  return task;
}

export function reserveTab(host: ArdiaHost, key: string) {
  const queue = queueFor(host);
  const previous = queue.get(key) ?? Promise.resolve();
  let finish!: () => void;
  const released = new Promise<void>((resolve) => { finish = resolve; });
  const settled = previous.then(() => released);
  publish(queue, key, settled);
  return { previous, finish, isTail: () => queue.get(key) === settled };
}
