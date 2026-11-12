import { assignPositions, type Extraction, type HLC } from "../../platform/sync";
import { ancestorIds, depthOf } from "../groups/groups";
import { groupChoiceKey, placeChoiceKey } from "../pins/pinChoices";
import type { Tab, TabGroup } from "../browser/types";
import { PIN_TAB, PIN_GROUP, legacyColor, PIN_NEST, PIN_ROW, type NestGroupValue, type NestTabValue, type PinGroupValue, type PinValue } from "./pinRecords";
import { choiceStillOut, homeWindow, settleChoices, store, windowsHomeFirst } from "./pinnedSyncState";
import { isPinnedRow, pinKeyOf } from "../browser/model";

export function extractPinned(profileId: string, base: (key: string) => unknown, queued: (key: string) => boolean, now: number, stamp: (key: string) => HLC | undefined): Extraction {
  const s = store();
  type Pin = Pick<Tab, "id" | "url" | "title" | "customTitle" | "customIcon"> & Pick<Tab, "pin"> & Partial<Pick<Tab, "pinnedUrl">>;
  type Node = { pin: Pin } | { group: string };
  const area: Node[] = [];
  const inside = new Map<string, Node[]>();
  const info = new Map<string, Pick<TabGroup, "name" | "icon" | "color"> & { parent: string | null }>();
  const enter = (chain: (Pick<TabGroup, "name" | "icon" | "color"> & { key: string })[]) =>
    chain.forEach((g, i) => {
      if (info.has(g.key)) return;
      const parent = chain[i - 1]?.key ?? null;
      info.set(g.key, { name: g.name, icon: g.icon, color: g.color, parent });
      inside.set(g.key, []);
      (parent ? inside.get(parent)! : area).push({ group: g.key });
    });
  const pinned = Object.values(s.groups).filter((g) => g.pinned && g.profileId === profileId);
  const pinnedGroupOf = new Map<string, TabGroup>();
  for (const g of pinned.map((g) => [g, depthOf(s.groups, g.id)] as const).sort((a, z) => a[1] - z[1]).map(([g]) => g)) g.tabIds.forEach((id) => pinnedGroupOf.set(id, g));
  const seen = new Set<string>();
  const home = homeWindow(s, profileId);
  for (const w of windowsHomeFirst(s, home)) {
    for (const id of w.tabIds) {
      const t = s.tabs[id];
      if (!t || t.profileId !== profileId || seen.has(pinKeyOf(t))) continue;
      const g = pinnedGroupOf.get(id);
      if (t.pin) area.push({ pin: { ...t, id: pinKeyOf(t) } });
      else if (g) {
        const chain = [...ancestorIds(s.groups, g.id).reverse().map((x) => s.groups[x]!).filter((x) => x.pinned), g];
        enter(chain.map((x) => ({ ...x, key: pinKeyOf(x) })));
        inside.get(pinKeyOf(g))!.push({ pin: { ...t, id: pinKeyOf(t) } });
      } else continue;
      seen.add(pinKeyOf(t));
    }
  }
  const park = s.parkedPins[profileId];
  const parkGroups = new Map((park?.groups ?? []).map((g) => [g.id, g]));
  const parkChain = (key: string) => {
    const chain: (Pick<TabGroup, "name" | "icon" | "color"> & { key: string })[] = [];
    for (let g = parkGroups.get(key); g && !chain.some((c) => c.key === g!.id); g = g.parentId ? parkGroups.get(g.parentId) : undefined) chain.unshift({ ...g, key: g.id });
    return chain;
  };
  for (const p of park?.tabs ?? []) {
    if (!p.groupId) area.push({ pin: p });
    else if (parkGroups.has(p.groupId)) (enter(parkChain(p.groupId)), inside.get(p.groupId)!.push({ pin: p }));
  }
  for (const g of park?.groups ?? []) enter(parkChain(g.id));
  const values = new Map<string, unknown>();
  const chosen = s.pinChoices[profileId] ?? {};
  const sync = s.pinSync[profileId] ?? {};
  const baseTab = (key: string) => base(`${PIN_TAB}${key}`) as PinValue | undefined;
  const baseGroup = (key: string) => base(`${PIN_GROUP}${key}`) as PinGroupValue | undefined;
  const pinValue = (t: Pin, group: string | null, pos: string): PinValue => {
    const was = baseTab(t.id);
    const entry = was ? sync[t.id] : undefined;
    const waiting = !group && !!was?.g && entry?.g === was.g && now < (entry.w ?? 0);
    return {
      g: waiting ? was!.g : group,
      u: (group ? t.url : t.pinnedUrl || t.url) || "",
      t: t.customTitle,
      i: t.customIcon,
      ti: t.title,
      pos: waiting ? was!.pos : pos,
    };
  };
  const flat = (key: string): { pin: Pin; inner: string }[] => inside.get(key)!.flatMap((n) => ("pin" in n ? [{ pin: n.pin, inner: key }] : flat(n.group)));
  const nest = (key: string) => {
    for (const n of inside.get(key)!) {
      if (!("group" in n)) continue;
      const g = info.get(n.group)!;
      values.set(`${PIN_NEST}g:${n.group}`, { n: g.name, i: g.icon, c: legacyColor(g.color), p: key } satisfies NestGroupValue);
      nest(n.group);
    }
  };
  const legacyRank = (n: Node) => ("pin" in n ? (isPinnedRow(n.pin) ? 1 : 0) : 2);
  area.sort((a, z) => legacyRank(a) - legacyRank(z));
  const areaPositions = assignPositions(area.map((n) => ("pin" in n ? ((baseTab(n.pin.id)?.g ?? null) === null ? baseTab(n.pin.id)?.pos : undefined) : baseGroup(n.group)?.pos)));
  area.forEach((n, i) => {
    if ("pin" in n) {
      values.set(`${PIN_TAB}${n.pin.id}`, pinValue(n.pin, null, areaPositions[i]!));
      return;
    }
    const g = info.get(n.group)!;
    values.set(`${PIN_GROUP}${n.group}`, { n: g.name, i: g.icon, c: legacyColor(g.color), pos: areaPositions[i]! } satisfies PinGroupValue);
    const members = flat(n.group);
    const positions = assignPositions(members.map(({ pin }) => (baseTab(pin.id)?.g === n.group ? baseTab(pin.id)?.pos : undefined)));
    members.forEach(({ pin, inner }, j) => {
      values.set(`${PIN_TAB}${pin.id}`, pinValue(pin, n.group, positions[j]!));
      if (inner !== n.group) values.set(`${PIN_NEST}t:${pin.id}`, { g: inner } satisfies NestTabValue);
    });
    nest(n.group);
  });
  const choiceOf = (k: string) => (k.startsWith(PIN_GROUP) ? groupChoiceKey(k.slice(PIN_GROUP.length)) : placeChoiceKey(k.slice(PIN_TAB.length)));
  return {
    values,
    ignore: (k) => k.startsWith(PIN_ROW),
    republish: (k) => k.startsWith("pin:") && choiceStillOut(chosen, choiceOf(k), stamp(k)) && !queued(k),
    published: (keys) =>
      settleChoices(profileId, Object.fromEntries([...keys].filter((k) => k.startsWith("pin:")).map(choiceOf).filter((c) => c in chosen).map((c) => [c, chosen[c]!]))),
  } satisfies Extraction;
}
