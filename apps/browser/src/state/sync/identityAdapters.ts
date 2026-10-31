import { assignPositions, type Adapter } from "../../platform/sync";
import { isFields, isString } from "../../lib/decode";
import { useBrowser } from "../browser/store";
import { topAppValue } from "../pins/topAppValue";
import type { TopApp } from "../browser/types";
import type { ProfileLink } from "./syncDoc";

export type ProfileRecord = { n: string; i: string | null; seed?: true };
export const profileKey = (syncId: string) => `identity:${syncId}`;

export const identityRecord = (value: unknown): ProfileRecord | null =>
  isFields(value) && isString(value.n) && value.n.trim() !== "" && (value.i === null || isString(value.i)) && (value.seed === undefined || value.seed === true) ? value as ProfileRecord : null;

export function profilesAdapter(links: () => Record<string, ProfileLink>): Adapter {
  return {
    prefix: "identity:",
    adoptRemoteOnJoin: true,
    extract: () => {
      const profiles = useBrowser.getState().profiles;
      const values = new Map<string, unknown>();
      for (const [id, link] of Object.entries(links())) {
        const p = profiles[id];
        if (p && !link.adopting) values.set(profileKey(link.syncId), { n: p.name, i: p.icon, ...(id === "default" ? { seed: true } : {}) } satisfies ProfileRecord);
      }
      return { values, ignore: (key) => !values.has(key) };
    },
    apply: (visible, changed) => {
      for (const [id, link] of Object.entries(links())) {
        const record = identityRecord(visible.get(profileKey(link.syncId)));
        if (record && changed.has(profileKey(link.syncId))) { useBrowser.getState().updateProfile(id, { name: record.n, icon: record.i }); delete link.adopting; }
      }
    },
  };
}

type AppRecord = TopApp & { pos: string };

export function topAppsAdapter(profileId: string): Adapter {
  return {
    prefix: "app:",
    extract: (base) => {
      const items = useBrowser.getState().topApps[profileId] ?? [];
      const positions = assignPositions(items.map((item) => (base(`app:${item.key}`) as AppRecord | undefined)?.pos));
      return { values: new Map(items.map((item, i) => [`app:${item.key}`, { ...item, favicon: null, pos: positions[i]! } satisfies AppRecord])) };
    },
    apply: (visible) => {
      const items: AppRecord[] = [];
      for (const [key, record] of visible) {
        const item = topAppValue(record);
        if (!item || !isFields(record) || !isString(record.pos) || !record.pos || key !== `app:${item.key}`) return false;
        items.push({ ...item, pos: record.pos });
      }
      items.sort((a, b) => a.pos.localeCompare(b.pos) || a.key.localeCompare(b.key));
      useBrowser.setState((s) => ({ topApps: { ...s.topApps, [profileId]: items.map(({ pos: _pos, ...item }) => item) } }));
      return true;
    },
  };
}
