import { useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent, View } from "react-native";
import { downloadsPlacement, type DownloadsFallback, type DownloadsPlacement, type Size } from "./downloadsPlacement";
import { locateDownloadsButton, measureInWindow } from "./DownloadsButton";
import { DOWNLOADS_LIST } from "./tokens";

export function useDownloadsPlacement(windowId: string, closing: boolean, fallback: DownloadsFallback) {
  const root = useRef<View>(null);
  const [placement, setPlacement] = useState<DownloadsPlacement | null>(null);
  const [viewport, setViewport] = useState<Size | null>(null);
  const latest = useRef({ closing, fallback });
  latest.current = { closing, fallback };
  const ticket = useRef(0);
  const locate = () => {
    const node = root.current;
    if (!node) return;
    const mine = ++ticket.current;
    void measureInWindow(node).then(async (origin) => {
      if (!origin || mine !== ticket.current || latest.current.closing) return;
      const anchor = await locateDownloadsButton(windowId, origin);
      if (mine === ticket.current && !latest.current.closing) setPlacement(downloadsPlacement(origin, anchor, latest.current.fallback));
    });
  };
  useEffect(() => {
    if (!closing) locate();
  }, [closing, fallback.topStrip, fallback.footer]);
  useEffect(() => {
    if (placement || !viewport) return;
    const timer = setTimeout(() => setPlacement((placed) => placed ?? downloadsPlacement(viewport, null, latest.current.fallback)), DOWNLOADS_LIST.placeDeadlineMs);
    return () => clearTimeout(timer);
  }, [placement, viewport]);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport({ width, height });
    if (!latest.current.closing) locate();
  };
  return { root, placement, onLayout };
}
