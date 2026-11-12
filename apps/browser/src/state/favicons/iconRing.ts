import { iconTheme } from "../../platform/favicons";
import { useEffect, useState } from "react";
import type { TileTheme } from "./tileTheme";

const rings = new Map<string, Promise<TileTheme | null>>();

function readableUri(uri: string): Promise<string | null> {
  if (uri.startsWith("data:") || uri.startsWith("file:")) return Promise.resolve(uri);
  return fetch(uri)
    .then((response) => response.blob())
    .then(
      (blob) =>
        new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => null);
}

function ringOf(uri: string): Promise<TileTheme | null> {
  let pending = rings.get(uri);
  if (!pending) {
    pending = readableUri(uri).then(async (image) => {
      if (!image) return null;
      const theme = await iconTheme({ uri: image }).catch(() => null);
      return theme ? { theme, image } : null;
    });
    rings.set(uri, pending);
  }
  return pending;
}

const WARM_GAP_MS = 40;
const warmQueue: string[] = [];
let warming = false;

function warmNext() {
  if (warming) return;
  const next = warmQueue.shift();
  if (!next) return;
  warming = true;
  void ringOf(next).finally(() => {
    warming = false;
    setTimeout(warmNext, WARM_GAP_MS);
  });
}

export function warmIconRing(uri: string | null) {
  if (!uri || rings.has(uri) || warmQueue.includes(uri)) return;
  warmQueue.push(uri);
  warmNext();
}

export function useIconRing(uri: string | null): TileTheme | null {
  const [ring, setRing] = useState<{ uri: string; ring: TileTheme | null } | null>(null);
  useEffect(() => {
    if (!uri) return;
    let live = true;
    void ringOf(uri).then((next) => live && setRing({ uri, ring: next }));
    return () => {
      live = false;
    };
  }, [uri]);
  return uri && ring?.uri === uri ? ring.ring : null;
}
