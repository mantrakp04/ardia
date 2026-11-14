import { useEffect } from "react";
import { create } from "zustand";
import { iconAccent } from "../../platform/favicons";
import { resolveFavicon, useFavicons } from "./favicons";

const KEPT = 64;

export const useFaviconAccents = create<{ byUri: Record<string, string | null> }>()(() => ({ byUri: {} }));

const asking = new Set<string>();

function remember(uri: string, accent: string | null) {
  const kept = Object.entries(useFaviconAccents.getState().byUri).filter(([key]) => key !== uri).slice(-(KEPT - 1));
  useFaviconAccents.setState({ byUri: { ...Object.fromEntries(kept), [uri]: accent } });
}

export function useFaviconAccent(url: string, profileId?: string): string | null | undefined {
  const uri = useFavicons(() => (url ? (resolveFavicon(url, null, profileId)?.uri ?? null) : null));
  const accent = useFaviconAccents((a) => (uri ? a.byUri[uri] : null));
  useEffect(() => {
    if (!uri || accent !== undefined || asking.has(uri)) return;
    asking.add(uri);
    void iconAccent(uri)
      .catch(() => null)
      .then((found) => remember(uri, found ?? null))
      .finally(() => asking.delete(uri));
  }, [uri, accent]);
  return accent;
}
