import type { Adapter, Extraction } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { fromSync } from "../pins/pinOrderChoices";
import { pinnedGroupMembers } from "../pins/pinHomes";
import { pinKeyOf } from "../pins/pinMirror";
import type { Tab } from "../browser/types";
import { PIN_HOME, syncedHome, syncedHomeIn } from "./pinRecords";
import { homeWindow, openWindows, store } from "./pinnedSyncState";

function parkedAt<T extends { url: string; pinnedUrl?: string | null; restoreFrom?: string }>(p: T, home: string): T {
  if (p.url === home) return { ...p, pinnedUrl: home };
  const { restoreFrom: _, ...rest } = p;
  return { ...rest, url: home, pinnedUrl: home } as T;
}

export function pinnedHomesAdapter(profileId: string): Adapter {
  const keyOf = (k: string) => k.slice(PIN_HOME.length);
  return {
    prefix: PIN_HOME,
    publishAfterPull: true,
    extract: (base, _queued, _now, recorded, remote) => {
      const s = store();
      const values = new Map<string, unknown>();
      const known = new Set<string>();
      const held = new Set<string>();
      const offer = (key: string, member: boolean, home: string | null | undefined) => {
        if (known.has(key)) return;
        known.add(key);
        if (!member) return;
        const k = `${PIN_HOME}${key}`;
        if (!home) held.add(key);
        else if (base(k) !== undefined || (remote(k) ?? null) === null) values.set(k, home);
      };
      const members = pinnedGroupMembers(s);
      const home = homeWindow(s, profileId);
      for (const w of home ? [home, ...openWindows(s).filter((w) => w.id !== home.id)] : openWindows(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (t?.profileId === profileId && (t.pinned || members.has(id))) offer(pinKeyOf(t), !t.pinned, t.pinnedUrl);
        }
      }
      for (const p of s.parkedPins[profileId]?.tabs ?? []) offer(p.id, !!p.groupId, p.pinnedUrl || p.url);
      const unpinned = (key: string) => recorded(`pin:t:${key}`) && remote(`pin:t:${key}`) === null;
      return {
        values,
        ignore: (k) => held.has(keyOf(k)) || (!known.has(keyOf(k)) && base(`pin:t:${keyOf(k)}`) === undefined && !unpinned(keyOf(k))),
      } satisfies Extraction;
    },
    apply: (visible, changed, base) => {
      const incoming = new Map<string, string>();
      for (const k of changed) {
        const home = syncedHome(visible.get(k));
        if (home) incoming.set(keyOf(k), home);
      }
      if (!incoming.size) return true;
      const wanted = (key: string, current: string | null | undefined) => {
        const home = incoming.get(key);
        if (!home || home === current) return undefined;
        const synced = syncedHomeIn(base, key);
        return !current || synced === undefined || synced === current ? home : undefined;
      };
      const s = store();
      let tabs: Record<string, Tab> | null = null;
      for (const id of pinnedGroupMembers(s)) {
        const t = s.tabs[id];
        if (!t || t.profileId !== profileId || t.pinned) continue;
        const home = wanted(pinKeyOf(t), t.pinnedUrl);
        if (home) (tabs ??= { ...s.tabs })[id] = { ...t, pinnedUrl: home };
      }
      const park = s.parkedPins[profileId];
      const parked = park?.tabs.map((p) => {
        const home = p.groupId ? wanted(p.id, p.pinnedUrl || p.url) : undefined;
        return home ? parkedAt(p, home) : p;
      });
      const parkEdited = !!park && parked!.some((p, i) => p !== park.tabs[i]);
      if (!tabs && !parkEdited) return true;
      fromSync(() =>
        useBrowser.setState({
          ...(tabs ? { tabs } : {}),
          ...(parkEdited ? { parkedPins: { ...s.parkedPins, [profileId]: { ...park!, tabs: parked! } } } : {}),
        }),
      );
      return true;
    },
  };
}
