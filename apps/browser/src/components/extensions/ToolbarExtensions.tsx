import { terminateCastRoute, type ActionState, type CastRoute, type InstalledExtension } from "@ardia/ardiacore";
import { ContextMenuArea, showMenu, Symbol } from "@ardia/shell";
import { memo, useMemo, useRef } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { toggleCastPicker, useCastRoutes } from "../media/cast";
import type { ToolbarPalette } from "../layout/toolbarColors";
import { usePages } from "../layout/pageState";
import { useHover } from "../primitives";
import { toolbarAnchors } from "./bridge";
import {
  activateExtension,
  openManageExtensions,
  openPinDialog,
  openWebStore,
  showExtensionMenu,
  useExtensions,
  useWindowExtensions,
  windowExtensions,
  type Anchor,
} from "./state";

const BUTTON = 28;
const GAP = 2;
const PITCH = BUTTON + GAP;

function useToolbarExtensions(windowId: string, limit: number) {
  const shown = useWindowExtensions(windowId);
  const routes = useCastRoutes(windowId);
  const casting = routes.length > 0;
  return useMemo(() => {
    const all = shown.filter((x) => x.pinned);
    const room = Math.max(0, limit - (casting ? 1 : 0));
    const overflow = all.length > room;
    return { pinned: overflow ? all.slice(0, Math.max(0, room - 1)) : all, overflow, casting, routes };
  }, [shown, routes, casting, limit]);
}

export const extensionsFitting = (room: number) => Math.max(1, Math.floor((room + GAP) / PITCH));

export function useToolbarExtensionsWidth(windowId: string, limit = Infinity): number {
  const { pinned, overflow, casting } = useToolbarExtensions(windowId, limit);
  const count = pinned.length + (overflow ? 1 : 0) + (casting ? 1 : 0);
  return count ? count * PITCH - GAP + 6 : 0;
}

export const ToolbarExtensions = memo(function ToolbarExtensions({
  tabId,
  windowId,
  palette,
  top,
  right,
  limit = Infinity,
}: {
  tabId: string;
  windowId: string;
  palette: ToolbarPalette;
  top: number;
  right: number;
  limit?: number;
}) {
  const { pinned, overflow, routes } = useToolbarExtensions(windowId, limit);
  const browserId = usePages((p) => {
    for (const [id, tab] of Object.entries(p.browsers)) if (tab === tabId) return Number(id);
    return 0;
  });
  if (!pinned.length && !overflow && !routes.length) return null;
  return (
    <View style={{ position: "absolute", top, right, flexDirection: "row", gap: GAP }}>
      {routes.length ? <CastButton windowId={windowId} tabId={tabId} routes={routes} palette={palette} /> : null}
      {pinned.map((ext) => (
        <ExtensionButton key={ext.id} ext={ext} windowId={windowId} tabId={tabId} browserId={browserId} palette={palette} />
      ))}
      {overflow && <OverflowButton windowId={windowId} tabId={tabId} palette={palette} />}
    </View>
  );
});

function useAnchor(key: string) {
  const ref = useRef<View>(null);
  const measure = () =>
    new Promise<Anchor>((resolve) => {
      const view = ref.current;
      if (!view) return resolve({ x: 0, y: 0, width: BUTTON, height: BUTTON });
      view.measureInWindow((x, y, width, height) => {
        const anchor = { x, y, width, height };
        toolbarAnchors.set(key, anchor);
        resolve(anchor);
      });
    });
  return { ref, measure };
}

function ExtensionButton({ ext, windowId, tabId, browserId, palette }: { ext: InstalledExtension; windowId: string; tabId: string; browserId: number; palette: ToolbarPalette }) {
  const fetched = useExtensions((e) => (browserId ? e.actions[browserId] : undefined));
  const held = useRef<ActionState | undefined>(undefined);
  if (fetched) held.current = fetched[ext.id];
  const state = held.current;
  const open = useExtensions((e) => e.popup?.windowId === windowId && e.popup.extensionId === ext.id);
  const { hovered, hoverProps } = useHover();
  const { ref, measure } = useAnchor(`${windowId}|${ext.id}`);
  const badge = state?.badgeText ?? "";
  const dimmed = state ? !state.enabled : false;
  const title = state?.title || ext.actionTitle || ext.name;
  const icon = state?.icon || ext.actionIcon || ext.icon;
  return (
    <View ref={ref} tooltip={title} {...hoverProps} onLayout={() => void measure()}>
      <ContextMenuArea onContextMenu={() => void showExtensionMenu(windowId, ext)}>
        <Pressable onPress={async () => activateExtension(windowId, ext, await measure(), fetched?.[ext.id], tabId)}>
          {({ pressed }) => (
            <View
              style={{
                width: BUTTON,
                height: BUTTON,
                borderRadius: 7,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed || open ? palette.pressed : hovered ? palette.hover : undefined,
              }}
            >
              {icon ? (
                <View pointerEvents="none">
                  <Image source={{ uri: icon }} style={{ width: 16, height: 16, opacity: dimmed ? 0.45 : 1 }} />
                </View>
              ) : (
                <Symbol name="puzzlepiece.extension" size={14} color={palette.icon} style={{ width: 18, height: 18 }} />
              )}
              {badge ? <Badge text={badge} color={state?.badgeColor} textColor={state?.badgeTextColor} /> : null}
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

function Badge({ text, color, textColor }: { text: string; color?: string | null; textColor?: string | null }) {
  const fill = color && color !== "#000000" ? color : "#5F6368";
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        right: 1,
        bottom: 3,
        minWidth: 13,
        height: 11,
        paddingHorizontal: 2.5,
        borderRadius: 3,
        backgroundColor: fill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 8.5, lineHeight: 11, fontWeight: "700", color: textColor ?? contrastText(fill) }}>
        {text.slice(0, 4)}
      </Text>
    </View>
  );
}

function contrastText(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#000000" : "#FFFFFF";
}

function CastButton({ windowId, tabId, routes, palette }: { windowId: string; tabId: string; routes: CastRoute[]; palette: ToolbarPalette }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const tooltip = routes.map((r) => (r.description ? `${r.description} on ${r.sink}` : `Casting to ${r.sink}`)).join("\n");
  const menu = async () => {
    const choice = await showMenu([
      ...routes.map((r) => ({ id: `stop:${r.id}`, title: `Stop Casting to ${r.sink}`, symbol: "stop.circle" })),
      { separator: true as const },
      { id: "open", title: "Cast…", symbol: "tv.and.mediabox" },
    ]);
    if (choice === "open") void toggleCastPicker(windowId);
    else if (choice?.startsWith("stop:")) void terminateCastRoute(choice.slice(5));
  };
  return (
    <View tooltip={tooltip} {...hoverProps}>
      <ContextMenuArea onContextMenu={() => void menu()}>
        <Pressable onPress={() => void toggleCastPicker(windowId, tabId)}>
          {({ pressed }) => (
            <View
              style={{
                width: BUTTON,
                height: BUTTON,
                borderRadius: 7,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? palette.pressed : hovered ? palette.hover : undefined,
              }}
            >
              <Symbol name="tv.and.mediabox.fill" size={14} color={theme.accent} style={{ width: 18, height: 18 }} />
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

function OverflowButton({ windowId, tabId, palette }: { windowId: string; tabId: string; palette: ToolbarPalette }) {
  const { hovered, hoverProps } = useHover();
  const { ref, measure } = useAnchor(`${windowId}|*`);
  const onPress = async () => {
    const anchor = await measure();
    const enabled = windowExtensions(useBrowser.getState(), windowId);
    const choice = await showMenu([
      ...enabled.map((x) => ({ id: `open:${x.id}`, title: x.name, symbol: x.pinned ? "pin.fill" : undefined })),
      ...(enabled.length ? [{ separator: true as const }] : []),
      { id: "pin", title: "Pin Extensions…", symbol: "pin" },
      { id: "manage", title: "Manage Extensions…", symbol: "puzzlepiece.extension" },
      { id: "add", title: "Add Extension…", symbol: "plus" },
    ]);
    if (choice === "pin") return openPinDialog(windowId);
    if (choice === "manage") return openManageExtensions(windowId);
    if (choice === "add") return openWebStore(windowId);
    const ext = choice?.startsWith("open:") ? enabled.find((x) => x.id === choice.slice(5)) : undefined;
    if (ext) void activateExtension(windowId, ext, anchor, undefined, tabId);
  };
  return (
    <View ref={ref} tooltip="Extensions" {...hoverProps} onLayout={() => void measure()}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              width: BUTTON,
              height: BUTTON,
              borderRadius: 7,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? palette.pressed : hovered ? palette.hover : undefined,
            }}
          >
            <Symbol name="puzzlepiece.extension" size={14} color={palette.icon} style={{ width: 18, height: 18 }} />
          </View>
        )}
      </Pressable>
    </View>
  );
}
