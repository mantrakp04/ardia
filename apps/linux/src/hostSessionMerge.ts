const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>) => Object.keys(value).filter((key) => !unsafeKeys.has(key) && value[key] !== undefined).sort();

export function cloneSessionValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneSessionValue(item === undefined ? null : item)) as T;
  if (record(value)) return Object.fromEntries(keys(value).map((key) => [key, cloneSessionValue(value[key])])) as T;
  return value;
}

export function canonicalSessionValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalSessionValue(item === undefined ? null : item)).join(",")}]`;
  if (record(value)) return `{${keys(value).map((key) => `${JSON.stringify(key)}:${canonicalSessionValue(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const equalSessionValue = (a: unknown, b: unknown) => a === b || canonicalSessionValue(a) === canonicalSessionValue(b);

export function sessionItemIdentity(value: unknown): string {
  if (record(value)) {
    if (typeof value.id === "string") return `id:${value.id}`;
    if (record(value.tab) && typeof value.tab.id === "string") return `tab:${value.tab.id}`;
  }
  return `json:${canonicalSessionValue(value)}`;
}

function indexItems(items: unknown[]) {
  const indexed = new Map<string, unknown>();
  for (const item of items) {
    const id = sessionItemIdentity(item);
    if (!indexed.has(id)) indexed.set(id, item);
  }
  return indexed;
}

export function mergeSession<T>(base: unknown, local: T, current: unknown): T {
  if (equalSessionValue(local, base)) return cloneSessionValue(current) as T;
  if (record(local) && record(current) && (base === undefined || record(base))) {
    const before = record(base) ? base : {};
    const output: Record<string, unknown> = cloneSessionValue(current);
    for (const key of new Set([...keys(before), ...keys(local)])) {
      if (!Object.hasOwn(local, key) || local[key] === undefined) delete output[key];
      else {
        const merged = mergeSession(before[key], local[key], current[key]);
        if (merged === undefined) delete output[key];
        else output[key] = merged;
      }
    }
    return output as T;
  }
  if (Array.isArray(local) && (base === undefined || Array.isArray(base))) {
    const before = indexItems(Array.isArray(base) ? base : []);
    const remote = Array.isArray(current) ? current : [];
    const remoteItems = indexItems(remote);
    const seen = new Set<string>();
    const localIds = new Set(local.map(sessionItemIdentity));
    const output: unknown[] = [];
    for (const item of local) {
      const id = sessionItemIdentity(item);
      if (seen.has(id)) continue;
      seen.add(id);
      const merged = mergeSession(before.get(id), item, remoteItems.get(id));
      if (merged !== undefined) output.push(merged);
    }
    for (const item of remote) {
      const id = sessionItemIdentity(item);
      if (seen.has(id) || localIds.has(id) || before.has(id)) continue;
      seen.add(id);
      output.push(cloneSessionValue(item));
    }
    return output as T;
  }
  return cloneSessionValue(local);
}

export function shareSessionValue<T>(previous: T, next: T): T {
  if (equalSessionValue(previous, next)) return previous;
  if (Array.isArray(previous) && Array.isArray(next)) return next.map((item, index) => shareSessionValue(previous[index], item)) as T;
  if (record(previous) && record(next)) return Object.fromEntries(keys(next).map((key) => [key, shareSessionValue(previous[key], next[key])])) as T;
  return next;
}
