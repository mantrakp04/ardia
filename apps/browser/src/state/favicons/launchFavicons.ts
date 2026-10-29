import { isIncognitoProfile } from "../browser/model";
import { cacheKey, EMPTY_ICONS, useFavicons, type Favicons } from "./favicons";
import { withoutFragment } from "../../lib/url";

export type LaunchFavicons = {
  images: string[];
  profiles: Record<string, { pages: Record<string, number>; srcs: Record<string, number> }>;
  themes: Favicons["themes"];
};

const LAUNCH_ICON_LIMIT = 240;
const LAUNCH_URI_LIMIT = 16 * 1024;
export const LAUNCH_FAVICONS_LIMIT = 1024 * 1024;

const serialized = (value: unknown) => JSON.stringify(value).length + 1;

export function launchFavicons(tabs: { url: string; favicon: string | null; profileId: string }[]): LaunchFavicons {
  const { profiles, themes } = useFavicons.getState();
  const look: LaunchFavicons = { images: [], profiles: {}, themes: {} };
  const indexOf = new Map<string, number>();
  let size = serialized(look);
  for (const t of tabs) {
    if (indexOf.size >= LAUNCH_ICON_LIMIT) break;
    if (!t.url || isIncognitoProfile(t.profileId)) continue;
    const key = cacheKey(t.profileId);
    const icons = profiles[key];
    const page = withoutFragment(t.url);
    const uri = icons?.pages[page];
    if (!icons || !uri || uri.length > LAUNCH_URI_LIMIT || look.profiles[key]?.pages[page] !== undefined) continue;
    const fromSrc = t.favicon ? icons.srcs[t.favicon] : undefined;
    const src = t.favicon && fromSrc && fromSrc.length <= LAUNCH_URI_LIMIT ? fromSrc : undefined;
    const fresh = [...new Set([uri, src].filter((u): u is string => !!u && !indexOf.has(u)))];
    const cost =
      (look.profiles[key] ? 0 : serialized(key) + serialized({ pages: {}, srcs: {} })) +
      serialized(page) + 6 +
      (src && t.favicon ? serialized(t.favicon) + 6 : 0) +
      fresh.reduce((sum, u) => sum + serialized(u) + (themes[u] !== undefined ? serialized(themes[u] ?? null) + 8 : 0), 0);
    if (size + cost > LAUNCH_FAVICONS_LIMIT) continue;
    size += cost;
    for (const u of fresh) {
      indexOf.set(u, look.images.push(u) - 1);
      if (themes[u] !== undefined) look.themes[indexOf.get(u)!] = themes[u] ?? null;
    }
    const entry = (look.profiles[key] ??= { pages: {}, srcs: {} });
    entry.pages[page] = indexOf.get(uri)!;
    if (src && t.favicon) entry.srcs[t.favicon] = indexOf.get(src)!;
  }
  return look;
}

const imagesOf = (map: unknown, images: string[]): Record<string, string> =>
  map && typeof map === "object"
    ? Object.fromEntries(Object.entries(map).flatMap(([k, i]) => (typeof i === "number" && typeof images[i] === "string" ? [[k, images[i]!]] : [])))
    : {};

export function seedFavicons(seed: LaunchFavicons) {
  const images = Array.isArray(seed.images) ? seed.images : [];
  const seeded = Object.entries(seed.profiles ?? {}).filter(([key]) => !isIncognitoProfile(key));
  if (!seeded.length || !images.length) return;
  const themes: Favicons["themes"] = {};
  for (const [i, theme] of Object.entries(seed.themes && typeof seed.themes === "object" ? seed.themes : {})) {
    const uri = images[Number(i)];
    if (typeof uri === "string" && (theme === null || typeof theme === "object")) themes[uri] = theme;
  }
  useFavicons.setState((f) => {
    const profiles = { ...f.profiles };
    for (const [key, saved] of seeded) {
      const icons = profiles[key] ?? EMPTY_ICONS;
      profiles[key] = {
        pages: { ...imagesOf(saved?.pages, images), ...icons.pages },
        srcs: { ...imagesOf(saved?.srcs, images), ...icons.srcs },
        appearances: icons.appearances,
      };
    }
    return { profiles, themes: { ...themes, ...f.themes } };
  });
}
