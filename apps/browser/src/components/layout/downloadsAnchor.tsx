import { useEffect, useRef } from "react";
import { View } from "react-native";
import { create } from "zustand";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowUi } from "../../store/hooks";
import { useSidebarWidth } from "../sidebar/tokens";
import { IconButton } from "../primitives";
import { useAddressBarInSidebar, useTabLayout } from "./windowLayout";

type Anchor = { x: number; y: number; width: number; height: number };

export const useDownloadsAnchors = create<Record<string, Anchor>>()(() => ({}));

export function DownloadsButton({ windowId, visible = true, revision = 0 }: { windowId: string; visible?: boolean; revision?: number }) {
  const theme = useTheme();
  const view = useRef<View>(null);
  const owned = useRef<Anchor | null>(null);
  const mounted = useRef(true);
  const visibleNow = useRef(visible);
  visibleNow.current = visible;
  const clear = () => {
    const state = useDownloadsAnchors.getState();
    if (state[windowId] !== owned.current) return;
    const next = { ...state };
    delete next[windowId];
    owned.current = null;
    useDownloadsAnchors.setState(next, true);
  };
  const open = useWindowUi().downloadsOpen;
  const width = useSidebarWidth(windowId);
  const layout = useTabLayout();
  const footer = useAddressBarInSidebar();
  const frame = useBrowser((s) => s.windows[windowId]?.frame);
  const measure = (done?: () => void) => view.current?.measureInWindow((x, y, width, height) => {
    if (!mounted.current || !visibleNow.current) return;
    if (width && height && x >= 0 && y >= 0) {
      const anchor = { x, y, width, height };
      owned.current = anchor;
      useDownloadsAnchors.setState({ [windowId]: anchor });
    } else clear();
    done?.();
  });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clear(); };
  }, [windowId]);
  useEffect(() => {
    if (!visible) { clear(); return; }
    measure();
  }, [open, width, layout, footer, frame, visible, revision]);
  return (
    <View ref={view} collapsable={false} onLayout={() => measure()} mouseDownCanMoveWindow={false}>
      <IconButton
        icon="arrow.down.circle"
        size={16}
        box={34}
        radius={10}
        tooltip={open ? undefined : "Downloads (⇧⌘J)"}
        style={open ? { borderRadius: 10, backgroundColor: theme.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)" } : undefined}
        onPress={() => measure(() => {
          const s = useBrowser.getState();
          s.setDownloadsOpen(windowId, !s.windowUi[windowId]?.downloadsOpen);
        })}
      />
    </View>
  );
}
