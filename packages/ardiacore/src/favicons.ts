import { call } from "./engine/call";

export type FaviconImage = { uri: string; width: number; height: number };

export async function faviconsFor(profile: string, pages: string[], icons: string[] = [], size = 32) {
  const result = await call("favicons.get", { profile, pages, icons, size });
  const uri = (png: string) => `data:image/png;base64,${png}`;
  return {
    pages: new Map(Object.entries(result.pages).map(([page, r]) => [page, { uri: uri(r.png), icon: r.icon }])),
    icons: new Map(Object.entries(result.icons).map(([icon, r]) => [icon, uri(r.png)])),
  };
}

export function storeFavicon(profile: string, page: string, icon: string, png: string) {
  return call("favicons.set", { profile, page, icon, png });
}

export async function fetchFavicon(url: string, profile: string, page?: string): Promise<FaviconImage | null> {
  const image = await call("favicons.fetch", { profile, url });
  const png = image?.uri.startsWith("data:image/png;base64,") ? image.uri.slice(22) : null;
  if (page && png) await storeFavicon(profile, page, url, png).catch(() => null);
  return image;
}
