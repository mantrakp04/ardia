import { useEffect, useRef } from "react";
import { View } from "react-native";
import { useShortcutHint, withShortcut } from "../../state/commands/commandShortcuts";
import { toggleDownloadsOpen } from "../../state/windows/actions";
import { useWindowUiOf } from "../../state/windows/hooks";
import { SIDEBAR_FOOTER_DOWNLOADS } from "../sidebar/geometry";
import { Button } from "../ui";
import { anchorInside, type Rect } from "./downloadsPlacement";
import { DOWNLOADS_BUTTON } from "./tokens";

const downloadsButtons = new Map<string, Set<View>>();

export function measureInWindow(view: View): Promise<Rect | null> {
  return new Promise((resolve) => view.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null)));
}

export async function locateDownloadsButton(windowId: string, origin: Rect): Promise<Rect | null> {
  const rects = await Promise.all([...(downloadsButtons.get(windowId) ?? [])].map(measureInWindow));
  for (const rect of rects) {
    const local = rect && { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
    if (anchorInside(origin, local)) return local;
  }
  return null;
}

export function DownloadsButton({ windowId }: { windowId: string }) {
  const open = useWindowUiOf(windowId, (ui) => !!ui?.downloadsOpen);
  const hint = useShortcutHint("downloads");
  const view = useRef<View>(null);
  useEffect(() => {
    const node = view.current;
    if (!node) return;
    const set = downloadsButtons.get(windowId) ?? new Set<View>();
    downloadsButtons.set(windowId, set);
    set.add(node);
    return () => {
      set.delete(node);
      if (!set.size && downloadsButtons.get(windowId) === set) downloadsButtons.delete(windowId);
    };
  }, [windowId]);
  return (
    <View ref={view} collapsable={false}>
      <Button variant="icon"
        icon="arrow.down.circle"
        size={DOWNLOADS_BUTTON.icon}
        box={SIDEBAR_FOOTER_DOWNLOADS.size}
        radius={DOWNLOADS_BUTTON.radius}
        active={open}
        tooltip={open ? undefined : withShortcut("Downloads", hint)}
        onPress={() => toggleDownloadsOpen(windowId)}
      />
    </View>
  );
}
