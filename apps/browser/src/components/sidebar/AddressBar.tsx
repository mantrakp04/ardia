import { useRef } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { useShortcutHint, withShortcut } from "../../state/commands/commandShortcuts";
import { layout, useTheme } from "../ui/theme";
import { useActiveTabId, useSettings, useTabLive, useWindowId } from "../../state/browser/hooks";
import { openPanel, toggleSidebar } from "../../state/windows/actions";
import { isAddressBarInSidebar } from "../../state/sidebar/current";
import { useIsInSplit } from "../../state/sidebar/hooks";
import { usePageProgress } from "../../state/tabs/pageProgress";
import { extensionsFitting, ToolbarExtensions, useToolbarExtensionsWidth } from "../extensions/ToolbarExtensions";
import { useHistoryAvailability } from "../../state/tabs/navigation";
import { toolbarPalette, type ToolbarPalette } from "../ui/toolbarColors";
import { Button, type ButtonHit, FadeLabel, font, useHover } from "../ui";
import { setUrlAnchor } from "../../state/windows/layout";
import { SIDEBAR_FIELD } from "./geometry";
import { SidebarFieldFill } from "./SidebarField";
import { UrlField, useToolbarTab } from "../toolbar/Toolbar";
import { HistoryButton, ReloadButton } from "../toolbar/NavButtons";
import { GLYPH } from "../toolbar/tokens";
import { HEADER_TOOLS, navButtonsFitting, type HeaderButton } from "../window/dockMotion";
import { ARC_LIGHTS_CENTER } from "../../state/windows/dockMotion";

const BUTTON = layout.toolbarButton;
const { toggleX: TOGGLE_X, edge: EDGE } = HEADER_TOOLS;
const LIGHTS_Y = ARC_LIGHTS_CENTER[1];
const PLATE = 32;
const PLATE_RADIUS = 6;

export function SidebarHeaderTools({ width }: { width: number }) {
  const windowId = useWindowId();
  const tab = useToolbarTab(useActiveTabId());
  const palette = toolbarPalette(useTheme(), null);
  const toggle = useSettings((st) => st.showSidebarButton !== false);
  const sidebarHint = useShortcutHint("toggleSidebar");
  const { buttons, step } = navButtonsFitting(width, BUTTON, toggle);
  const shown = tab ? buttons : [];
  const last = width - EDGE - BUTTON / 2;
  const centres = shown.map((_, i) => last - (shown.length - 1 - i) * step);
  const at = toggle ? [TOGGLE_X, ...centres] : centres;
  const plate = Math.min(PLATE, step);
  const place = (center: number) => ({
    style: { position: "absolute" as const, top: LIGHTS_Y - plate / 2, left: center - plate / 2 },
    hit: { width: plate, height: plate, plateX: 0, plateY: 0, box: plate, radius: PLATE_RADIUS },
  });
  return (
    <>
      {toggle && (
        <Button variant="icon" toolbar
          {...place(at[0]!)}
          palette={palette}
          icon="sidebar.left"
          size={GLYPH}
          onPress={() => toggleSidebar(windowId)}
          tooltip={withShortcut("Auto-Hide Tabs", sidebarHint)}
        />
      )}
      {tab ? <NavigationButtons tab={tab} palette={palette} buttons={shown} slots={at.slice(toggle ? 1 : 0).map(place)} /> : null}
    </>
  );
}

const alreadyFocused = () => {};

function NavigationButtons({
  tab,
  palette,
  buttons,
  slots,
}: {
  tab: NonNullable<ReturnType<typeof useToolbarTab>>;
  palette: ToolbarPalette;
  buttons: HeaderButton[];
  slots: { style: ViewStyle; hit: ButtonHit }[];
}) {
  const loading = useTabLive(tab.id, (l) => l.isLoading);
  const history = useHistoryAvailability(tab.id);
  return (
    <>
      {buttons.map((b, i) =>
        b === "reload" ? (
          <ReloadButton key={b} {...slots[i]!} tab={tab} loading={loading} palette={palette} onFocus={alreadyFocused} />
        ) : (
          <HistoryButton
            key={b}
            {...slots[i]!}
            tabId={tab.id}
            windowId={tab.windowId}
            direction={b === "back" ? -1 : 1}
            disabled={b === "back" ? !history.back : !history.forward}
            palette={palette}
            onFocus={alreadyFocused}
          />
        ),
      )}
    </>
  );
}

export function SidebarAddressRow({ width }: { width: number }) {
  const windowId = useWindowId();
  const tab = useToolbarTab(useActiveTabId());
  const field = useRef<View>(null);
  const anchor = () =>
    field.current?.measureInWindow((x, y, width, height) => {
      if (width && isAddressBarInSidebar(windowId)) setUrlAnchor(windowId, { left: x, top: y, width, sidebar: { height } });
    });

  return (
    <View
      ref={field}
      onLayout={anchor}
      style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, top: SIDEBAR_FIELD.top, height: SIDEBAR_FIELD.height }}
    >
      {tab?.url ? <PageField tab={tab} windowId={windowId} width={width - 2 * layout.sidebarInset} /> : <EmptyField windowId={windowId} />}
    </View>
  );
}

const HOST_ROOM = 84;

function PageField({ tab, windowId, width }: { tab: NonNullable<ReturnType<typeof useToolbarTab>>; windowId: string; width: number }) {
  const palette = toolbarPalette(useTheme(), null);
  const loading = useTabLive(tab.id, (l) => l.isLoading);
  const loaded = usePageProgress(tab.id);
  const progress = loading ? loaded : null;
  const inSplit = useIsInSplit(tab.id);
  const limit = extensionsFitting(width - 10 - 3 - HOST_ROOM);
  const extensionsWidth = useToolbarExtensionsWidth(windowId, limit);
  return (
    <UrlField
      tab={tab}
      palette={palette}
      windowId={windowId}
      inSplit={inSplit}
      onFocus={alreadyFocused}
      sidebar={{
        height: SIDEBAR_FIELD.height,
        progress,
        accessory: extensionsWidth ? (
          <View style={{ width: extensionsWidth - 6, height: 28 }}>
            <ToolbarExtensions tabId={tab.id} windowId={windowId} palette={palette} top={0} right={0} limit={limit} />
          </View>
        ) : null,
      }}
    />
  );
}

function EmptyField({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const open = () => openPanel(windowId, "");
  return (
    <View {...hoverProps}>
      <Pressable onPress={open}>
        <View style={{ height: SIDEBAR_FIELD.height, justifyContent: "center", paddingLeft: 11 }}>
          <SidebarFieldFill hovered={hovered} />
          <FadeLabel text="Search or enter address" fontSize={font.body.fontSize} color={theme.placeholder} fadeWidth={14} style={{ height: 18, marginLeft: -2 }} />
        </View>
      </Pressable>
    </View>
  );
}
