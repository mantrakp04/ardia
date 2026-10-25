const LEGACY_URLS: [string, string][] = [
  ["netnyahoo://yahu", "ardia://game"],
  ["chrome://yahu", "chrome://game"],
  ["netnyahoo://", "ardia://"],
];

export function fromLegacyUrl(url: string): string {
  const lower = url.toLowerCase();
  for (const prefix of ["", "view-source:"]) {
    for (const [old, now] of LEGACY_URLS) {
      if (!lower.startsWith(prefix + old)) continue;
      const rest = url.slice(prefix.length + old.length);
      if (!old.endsWith("://") && rest && !"/?#".includes(rest[0]!)) continue;
      return url.slice(0, prefix.length) + now + rest;
    }
  }
  return url;
}

export function fromLegacy<T>(value: T): T {
  if (typeof value === "string") return fromLegacyUrl(value) as T;
  if (Array.isArray(value)) return value.map(fromLegacy) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) out[key] = fromLegacy(v);
    return out as T;
  }
  return value;
}
