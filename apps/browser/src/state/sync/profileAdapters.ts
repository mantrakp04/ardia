import { canonical, type Adapter } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { DEFAULT_PROFILE_ID } from "../settings/settings";
import { sanitizeTheme } from "../../lib/profileLook";
import type { Profile, ProfileTheme } from "../browser/types";

const store = () => useBrowser.getState();

export type ProfileRecord = { n: string; c: Profile["color"]; i: string | null; d?: true; th?: ProfileTheme | null };

export type ProfileThemeRecord = { t: ProfileTheme } | { preset: true };

export type ThemeAngleRecord = { a?: number; d?: number };

export const themeAngleKey = (syncId: string) => `pth:${syncId}:angle`;

function withoutAngles({ angle: _angle, dark, ...theme }: ProfileTheme): ProfileTheme {
  if (!dark) return theme;
  const { angle: _darkAngle, ...darkLook } = dark;
  return { ...theme, dark: darkLook };
}

function anglesOf(theme: ProfileTheme): ThemeAngleRecord {
  return { ...(theme.angle !== undefined ? { a: theme.angle } : {}), ...(theme.dark?.angle !== undefined ? { d: theme.dark.angle } : {}) };
}

export function themeFromRecord(record: unknown, angles?: unknown): Pick<Profile, "theme"> | null {
  if (!record || typeof record !== "object") return null;
  if ("preset" in record && record.preset === true) return { theme: null };
  const theme = "t" in record ? sanitizeTheme(record.t) : null;
  if (!theme) return null;
  if (!angles || typeof angles !== "object") return { theme };
  const { a, d } = angles as Record<string, unknown>;
  const look = withoutAngles(theme);
  return { theme: sanitizeTheme({ ...look, angle: a, ...(look.dark ? { dark: { ...look.dark, angle: d } } : {}) }) };
}

export function legacyThemeOf(record: ProfileRecord): Pick<Profile, "theme"> | null {
  const theme = record.th ? sanitizeTheme(record.th) : null;
  return theme ? { theme } : null;
}

export function profilesAdapter(links: () => Record<string, { syncId: string }>): Adapter {
  const linked = () => Object.entries(links()).filter(([id]) => store().profiles[id]);
  return {
    prefix: "prof:",
    adoptRemoteOnJoin: true,
    extract: (_base, _queued, _now, known) => {
      const values = new Map<string, unknown>();
      const all = links();
      for (const [id, { syncId }] of linked()) {
        const p = store().profiles[id]!;
        const sharesSyncedData = !!p.dataId && p.dataId !== id && !!all[p.dataId] && !!store().profiles[p.dataId];
        if (sharesSyncedData && !known(`share:${syncId}`)) continue;
        values.set(`prof:${syncId}`, {
          n: p.name,
          c: p.color,
          i: p.icon,
          ...(id === DEFAULT_PROFILE_ID ? { d: true } : {}),
        } satisfies ProfileRecord);
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key) };
    },
    apply: (visible, changed, _base, records) => {
      for (const [id, { syncId }] of linked()) {
        const record = visible.get(`prof:${syncId}`) as ProfileRecord | undefined;
        if (!record || !changed.has(`prof:${syncId}`)) continue;
        const legacy = store().profiles[id]!.theme === undefined && !records.known(`pth:${syncId}`) ? legacyThemeOf(record) : null;
        store().updateProfile(id, { name: record.n, color: record.c, icon: record.i, ...legacy });
      }
    },
  };
}

export function profileThemesAdapter(
  links: () => Record<string, { syncId: string; themeAdopting?: true }>,
  records: () => Record<string, { v: unknown }> | undefined,
  adopted: (profileId: string) => void = () => {},
): Adapter {
  const linked = () => Object.entries(links()).filter(([id]) => store().profiles[id]);
  const unapplied = (key: string, base: (key: string) => unknown) => {
    const record = records()?.[key];
    return !!record && record.v !== null && canonical(record.v) !== canonical(base(key) ?? null);
  };
  return {
    prefix: "pth:",
    adoptRemoteOnJoin: true,
    extract: (base, _queued, _now, known) => {
      const values = new Map<string, unknown>();
      for (const [id, { syncId, themeAdopting }] of linked()) {
        const theme = store().profiles[id]!.theme;
        const key = `pth:${syncId}`;
        const angleKey = themeAngleKey(syncId);
        if (theme === undefined || themeAdopting || unapplied(key, base) || unapplied(angleKey, base)) continue;
        values.set(key, (theme ? { t: withoutAngles(theme) } : { preset: true }) satisfies ProfileThemeRecord);
        const angles = theme ? anglesOf(theme) : {};
        if (Object.keys(angles).length || known(angleKey)) values.set(angleKey, angles satisfies ThemeAngleRecord);
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key) };
    },
    apply: (visible, changed) => {
      for (const [id, { syncId }] of linked()) {
        const angleKey = themeAngleKey(syncId);
        if (!changed.has(`pth:${syncId}`) && !changed.has(angleKey)) continue;
        const patch = themeFromRecord(visible.get(`pth:${syncId}`), visible.get(angleKey));
        if (!patch) continue;
        store().updateProfile(id, patch);
        adopted(id);
      }
    },
  };
}
