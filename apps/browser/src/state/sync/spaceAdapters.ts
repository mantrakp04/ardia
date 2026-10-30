import { canonical, type Adapter } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { DEFAULT_SPACE_ID } from "../settings/settings";
import { sanitizeTheme } from "../../lib/profileLook";
import type { ProfileLink } from "./syncDoc";
import { profileKey } from "./identityAdapters";
import { hasLiveSpaceContent } from "./spaceContent";
import type { Space, ProfileTheme } from "../browser/types";
import { PROFILE, PROFILE_THEME, SHARE, profileRecord } from "./records";

const store = () => useBrowser.getState();

export type SpaceRecord = { n: string; c: Space["color"]; i: string | null; d?: true; p?: string; pos?: string; th?: ProfileTheme | null };

export type SpaceThemeRecord = { t: ProfileTheme } | { preset: true };

export type ThemeAngleRecord = { a?: number; d?: number };

export const themeAngleKey = (syncId: string) => `${PROFILE_THEME}${syncId}:angle`;

function withoutAngles({ angle: _angle, dark, ...theme }: ProfileTheme): ProfileTheme {
  if (!dark) return theme;
  const { angle: _darkAngle, ...darkLook } = dark;
  return { ...theme, dark: darkLook };
}

function anglesOf(theme: ProfileTheme): ThemeAngleRecord {
  return { ...(theme.angle !== undefined ? { a: theme.angle } : {}), ...(theme.dark?.angle !== undefined ? { d: theme.dark.angle } : {}) };
}

export function themeFromRecord(record: unknown, angles?: unknown): Pick<Space, "theme"> | null {
  if (!record || typeof record !== "object") return null;
  if ("preset" in record && record.preset === true) return { theme: null };
  const theme = "t" in record ? sanitizeTheme(record.t) : null;
  if (!theme) return null;
  if (!angles || typeof angles !== "object") return { theme };
  const { a, d } = angles as Record<string, unknown>;
  const look = withoutAngles(theme);
  return { theme: sanitizeTheme({ ...look, angle: a, ...(look.dark ? { dark: { ...look.dark, angle: d } } : {}) }) };
}

export function legacyThemeOf(record: SpaceRecord): Pick<Space, "theme"> | null {
  const theme = record.th ? sanitizeTheme(record.th) : null;
  return theme ? { theme } : null;
}

export function spacesAdapter(links: () => Record<string, { syncId: string; adopting?: true; pendingProfileId?: string; publishAssignment?: true }>, profiles: () => Record<string, ProfileLink> = () => ({})): Adapter {
  const linked = () => Object.entries(links()).filter(([id]) => store().spaces[id]);
  return {
    prefix: PROFILE,
    adoptRemoteOnJoin: true,
    extract: (_base, _queued, _now, known) => {
      const values = new Map<string, unknown>();
      const all = links();
      for (const [id, { syncId }] of linked()) {
        const p = store().spaces[id]!;
        const assignment = profiles()[p.profileId];
        if (!assignment || all[id]?.adopting || all[id]?.pendingProfileId || !known(profileKey(assignment.syncId))) continue;
        values.set(`prof:${syncId}`, {
          n: p.name,
          c: p.color,
          i: p.icon,
          p: assignment.syncId,
          pos: String(store().spaceOrder.indexOf(id)).padStart(8, "0"),
          ...(id === DEFAULT_SPACE_ID ? { d: true } : {}),
        } satisfies SpaceRecord);
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key), republish: (key) => linked().some(([, link]) => key === `prof:${link.syncId}` && !!link.publishAssignment), published: (keys) => { for (const [, link] of linked()) if (keys.has(`prof:${link.syncId}`)) delete link.publishAssignment; } };
    },
    apply: (visible, changed, _base, records) => {
      let pending = false;
      for (const [id, link] of linked()) {
        const { syncId } = link;
        const record = visible.get(`prof:${syncId}`) as SpaceRecord | undefined;
        if (!record || !changed.has(`prof:${syncId}`)) continue;
        const legacy = store().spaces[id]!.theme === undefined && !records.known(`pth:${syncId}`) ? legacyThemeOf(record) : null;
        const profileId = record.p && Object.entries(profiles()).find(([local, link]) => link.syncId === record.p && store().profiles[local])?.[0];
        if (record.p && !profileId) { pending = true; continue; }
        if (profileId && store().spaces[id]!.profileId !== profileId) {
          if (hasLiveSpaceContent(store(), id)) { link.pendingProfileId = profileId; pending = true; }
          else { store().assignSpaceProfile(id, profileId); delete link.pendingProfileId; }
        } else delete link.pendingProfileId;
        store().updateSpace(id, { name: record.n, color: record.c, icon: record.i, ...legacy });
        delete link.adopting;
      }
      const order = store().spaceOrder;
      const slots = order.map((id, i) => links()[id] && visible.has(`prof:${links()[id]!.syncId}`) ? i : -1).filter((i) => i >= 0);
      const sorted = slots.map((i) => order[i]!).sort((a, b) => {
        const one = visible.get(`prof:${links()[a]!.syncId}`) as SpaceRecord;
        const two = visible.get(`prof:${links()[b]!.syncId}`) as SpaceRecord;
        return (one.pos ?? "").localeCompare(two.pos ?? "") || links()[a]!.syncId.localeCompare(links()[b]!.syncId);
      });
      const next = [...order];
      slots.forEach((slot, i) => next[slot] = sorted[i]!);
      if (next.some((id, i) => id !== order[i])) store().reorderSpaces(next);
      return !pending;
    },
  };
}

export function spaceThemesAdapter(
  links: () => Record<string, { syncId: string; themeAdopting?: true }>,
  records: () => Record<string, { v: unknown }> | undefined,
): Adapter {
  const linked = () => Object.entries(links()).filter(([id]) => store().spaces[id]);
  const unapplied = (key: string, base: (key: string) => unknown) => {
    const record = records()?.[key];
    return !!record && record.v !== null && canonical(record.v) !== canonical(base(key) ?? null);
  };
  return {
    prefix: PROFILE_THEME,
    adoptRemoteOnJoin: true,
    extract: (base, _queued, _now, known) => {
      const values = new Map<string, unknown>();
      for (const [id, { syncId, themeAdopting }] of linked()) {
        const theme = store().spaces[id]!.theme;
        const key = `pth:${syncId}`;
        const angleKey = themeAngleKey(syncId);
        if (theme === undefined || themeAdopting || unapplied(key, base) || unapplied(angleKey, base)) continue;
        values.set(key, (theme ? { t: withoutAngles(theme) } : { preset: true }) satisfies SpaceThemeRecord);
        const angles = theme ? anglesOf(theme) : {};
        if (Object.keys(angles).length || known(angleKey)) values.set(angleKey, angles satisfies ThemeAngleRecord);
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key) };
    },
    apply: (visible, changed) => {
      for (const [id, { syncId }] of linked()) {
        const angleKey = themeAngleKey(syncId);
        if (!changed.has(`${PROFILE_THEME}${syncId}`) && !changed.has(angleKey)) continue;
        const patch = themeFromRecord(visible.get(`${PROFILE_THEME}${syncId}`), visible.get(angleKey));
        if (!patch) continue;
        store().updateSpace(id, patch);
      }
    },
  };
}
