import { engineCall } from "./engine";
import { Cef } from "./native";

export type FaviconImage = { uri: string; width: number; height: number };

export async function faviconsFor(profile: string, pages: string[], icons: string[] = [], size = 32) {
  const result = await engineCall<{ pages: Record<string, { png: string; icon: string }>; icons: Record<string, { png: string }> }>(
    "ac_favicons_get",
    profile,
    { pages, icons, size },
  );
  const uri = (png: string) => `data:image/png;base64,${png}`;
  return {
    pages: new Map(Object.entries(result.pages).map(([page, r]) => [page, { uri: uri(r.png), icon: r.icon }])),
    icons: new Map(Object.entries(result.icons).map(([icon, r]) => [icon, uri(r.png)])),
  };
}

export function storeFavicon(profile: string, page: string, icon: string, png: string) {
  return engineCall<{ stored: boolean }>("ac_favicons_set", profile, { page, icon, png });
}

export async function fetchFavicon(url: string, profile: string, page?: string): Promise<FaviconImage | null> {
  const image = await Cef.fetchFavicon(url, profile);
  const png = image?.uri.startsWith("data:image/png;base64,") ? image.uri.slice(22) : null;
  if (page && png) await storeFavicon(profile, page, url, png).catch(() => null);
  return image;
}
