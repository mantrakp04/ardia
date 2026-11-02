import type { DiaTabsProfile, DiaTabsResult } from "../../platform/importModule";

const nameKey = (name: string) => name.trim().toLowerCase();

export function diaProfilesFor(dia: DiaTabsResult, profiles: { id: string; name: string }[]): Map<string, DiaTabsProfile> {
  const count = (names: string[]) => names.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<string, number>());
  const onDisk = count(profiles.map((p) => nameKey(p.name)));
  const inDia = count(dia.profiles.map((d) => nameKey(d.name)));
  const unique = (name: string) => onDisk.get(name) === 1 && inDia.get(name) === 1;
  const out = new Map<string, DiaTabsProfile>();
  const taken = new Set<string>();
  for (const p of profiles) {
    const key = nameKey(p.name);
    const named = unique(key) ? dia.profiles.find((d) => nameKey(d.name) === key) : undefined;
    if (named) {
      out.set(p.id, named);
      taken.add(named.id);
    }
  }
  const claimed = new Set([...onDisk.keys()].filter((name) => inDia.has(name)));
  profiles.forEach((p, position) => {
    if (out.has(p.id)) return;
    const byPosition = dia.profiles.find((d) => d.index === position + 1 && !taken.has(d.id) && !(unique(nameKey(d.name)) && claimed.has(nameKey(d.name))));
    if (!byPosition) return;
    out.set(p.id, byPosition);
    taken.add(byPosition.id);
  });
  return out;
}
