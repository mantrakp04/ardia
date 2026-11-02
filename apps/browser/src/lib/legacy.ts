export const LEGACY_BOOKMARK_SEED = "netnyahoo-bookmark:";

export const LEGACY_URLS: [string, string][] = [
  ["netnyahoo://yahu", "ardia://game"],
  ["chrome://yahu", "chrome://game"],
  ["netnyahoo://", "ardia://"],
];

export const LEGACY_KEYS: Record<string, string> = {
  openLinksInSmallYahu: "openLinksInLittleArdia",
  smallYahuSize: "littleArdiaSize",
  newSmallYahu: "newLittleArdia",
  toggleOpenLinksInSmallYahu: "toggleOpenLinksInLittleArdia",
};

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
  if (Array.isArray(value)) {
    const out = value.map(fromLegacy);
    return (out.some((v, i) => v !== value[i]) ? out : value) as T;
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(source)) {
      const name = LEGACY_KEYS[key] ?? key;
      if (name !== key && name in source) {
        changed = true;
        continue;
      }
      out[name] = fromLegacy(v);
      if (name !== key || out[name] !== v) changed = true;
    }
    return (changed ? out : value) as T;
  }
  return value;
}
