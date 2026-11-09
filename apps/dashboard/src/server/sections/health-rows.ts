import { compareVersions, isNightly } from "../../lib/versions.ts";

export type VersionUsage = { version: string; users: number; launches: number; unclean: number; uncleanPeople: number };

const noUsage = (version: string): VersionUsage => ({ version, users: 0, launches: 0, unclean: 0, uncleanPeople: 0 });

export function healthVersionRows(usage: VersionUsage[], crashesByVersion: Map<string, number>, jsByVersion: Map<string, number>) {
  const byVersion = new Map(usage.filter((u) => u.version !== "").map((u) => [u.version, u]));
  for (const version of [...crashesByVersion.keys(), ...jsByVersion.keys()]) if (version && !byVersion.has(version)) byVersion.set(version, noUsage(version));
  return [...byVersion.values()]
    .map((u) => {
      const crashes = crashesByVersion.get(u.version) ?? 0;
      return {
        ...u,
        nightly: isNightly(u.version),
        uncleanRate: u.launches ? u.unclean / u.launches : null,
        crashes,
        jsErrors: jsByVersion.get(u.version) ?? 0,
        crashesPer100: u.users ? (100 * crashes) / u.users : null,
      };
    })
    .sort((a, b) => compareVersions(b.version, a.version));
}
