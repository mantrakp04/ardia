export const DAILY_COUNT_SINCE = "0.2.41-nightly.3";

export const DAILY_COUNT_START_MS = Date.UTC(2026, 9, 25);

export const isNightly = (version: string) => version.includes("-nightly");

export function compareVersions(a: string, b: string) {
  const parse = (v: string) => {
    const [core = "", pre = ""] = v.split("-nightly.");
    return [...core.split(".").map(Number), pre ? Number(pre) : Number.POSITIVE_INFINITY];
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export const sendsDailyCount = (version: string) => compareVersions(version, DAILY_COUNT_SINCE) >= 0;

export const newestFirst = (a: string, b: string) => compareVersions(b, a);
