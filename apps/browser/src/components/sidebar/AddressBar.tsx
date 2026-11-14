import { useRef } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { useShortcutHint, withShortcut } from "../../state/commands/commandShortcuts";
import { layout, useTheme } from "../ui/theme";
import { useActiveTabId, useSettings, useSidebarSide, useTabLive, useWindowFullScreen, useWindowId } from "../../state/browser/hooks";
import { toggleSidebar } from "../../state/windows/actions";
import { openEmptySidebarField } from "../../state/omnibox/barState";
import { isAddressBarInSidebar } from "../../state/sidebar/current";
import { usePageProgress } from "../../state/tabs/pageProgress";
import { extensionsFitting, ToolbarExtensions, useToolbarExtensionsWidth } from "../extensions/ToolbarExtensions";
import { useHistoryAvailability } from "../../state/tabs/navigation";
import { toolbarPalette, type ToolbarPalette } from "../ui/toolbarColors";
import { Button, type ButtonHit, FadeLabel, font, radius, space, ToolbarRowContext, useHover } from "../ui";
import { TOOLBAR_ROWS } from "../../lib/toolbarRow";
import { setUrlAnchor, useSidebarCaptionRoom } from "../../state/windows/layout";
import { useSidebarPart } from "../../state/sidebar/chrome";
import { SIDEBAR_FIELD } from "./geometry";
import { SidebarFieldFill } from "./SidebarField";
import { SidebarUrlField, useToolbarTab } from "../toolbar/Toolbar";
import { HistoryButton, ReloadButton } from "../toolbar/NavButtons";
import { GLYPH } from "../toolbar/tokens";
import { HEADER_TOOLS, headerToggleX, navButtonsFitting, type HeaderButton } from "../window/dockMotion";
import { ARC_LIGHTS_CENTER } from "../../state/windows/dockMotion";

const BUTTON = layout.toolbarButton;
const { edge: EDGE } = HEADER_TOOLS;
const LIGHTS_Y = ARC_LIGHTS_CENTER[1];
const PLATE = 32;

export function SidebarHeaderTools({ width }: { width: number }) {
  const windowId = useWindowId();
  const tab = useToolbarTab(useActiveTabId());
  const palette = toolbarPalette(useTheme(), null);
  const toggleWanted = useSettings((st) => st.showSidebarButton !== false);
  const toggle = useSidebarPart("sidebarButton") && toggleWanted;
  const navShown = useSidebarPart("navButtons");
  const right = useSidebarSide(windowId) === "right";
  const sidebarHint = useShortcutHint("toggleSidebar");
  const toggleX = headerToggleX(useWindowFullScreen(windowId));
  const usable = width - useSidebarCaptionRoom();
  const { buttons, step } = navButtonsFitting(usable, BUTTON, toggle, toggleX);
  const shown = tab && navShown ? buttons : [];
  const last = usable - EDGE - BUTTON / 2;
  const centres = shown.map((_, i) => last - (shown.length - 1 - i) * step);
  const at = toggle ? [toggleX, ...centres] : centres;
  const plate = Math.min(PLATE, step);
  const place = (center: number) => ({
    style: { position: "absolute" as const, top: LIGHTS_Y - plate / 2, left: center - plate / 2 },
    hit: { width: plate, height: plate, plateX: 0, plateY: 0, box: plate, radius: radius.toolbar },
  });
  return (
    <>
      {toggle && (
        <Button variant="icon" toolbar
          {...place(at[0]!)}
          palette={palette}
          icon={right ? "sidebar.right" : "sidebar.left"}
          glyph={GLYPH}
          onPress={() => toggleSidebar(windowId)}
          tooltip={withShortcut("Hide Tabs", sidebarHint)}
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
          <ReloadButton key={b} place={slots[i]} tab={tab} loading={loading} palette={palette} onFocus={alreadyFocused} />
        ) : (
          <HistoryButton
            key={b}
            place={slots[i]}
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

export function SidebarAddressRow({ width, top }: { width: number; top: number }) {
  const windowId = useWindowId();
  const tab = useToolbarTab(useActiveTabId());
  const field = useRef<View>(null);
  const fieldWidth = width - 2 * layout.sidebarInset;
  const anchor = () =>
    field.current?.measureInWindow((x, y, width, height) => {
      if (width && isAddressBarInSidebar(windowId)) setUrlAnchor(windowId, { left: x, top: y, width, sidebar: { height } });
    });

  return (
    <View
      ref={field}
      onLayout={anchor}
      style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, top, height: SIDEBAR_FIELD.height }}
    >
      <ToolbarRowContext.Provider value={TOOLBAR_ROWS.regular}>
        {tab?.url ? <PageField tab={tab} windowId={windowId} width={fieldWidth} /> : <EmptyField tabId={tab?.id} windowId={windowId} width={fieldWidth} />}
      </ToolbarRowContext.Provider>
    </View>
  );
}

const HOST_ROOM = 84;

function FieldExtensions({ tabId, windowId, width, palette }: { tabId: string; windowId: string; width: number; palette: ToolbarPalette }) {
  const limit = extensionsFitting(width - 10 - 3 - HOST_ROOM);
  const extensionsWidth = useToolbarExtensionsWidth(windowId, limit);
  if (!extensionsWidth) return null;
  return (
    <View style={{ width: extensionsWidth - 6, height: 28 }}>
      <ToolbarExtensions tabId={tabId} windowId={windowId} palette={palette} top={0} right={0} limit={limit} />
    </View>
  );
}

function PageField({ tab, windowId, width }: { tab: NonNullable<ReturnType<typeof useToolbarTab>>; windowId: string; width: number }) {
  const palette = toolbarPalette(useTheme(), null);
  const loading = useTabLive(tab.id, (l) => l.isLoading);
  const loaded = usePageProgress(tab.id);
  const progress = loading ? loaded : null;
  return (
    <SidebarUrlField
      tab={tab}
      palette={palette}
      windowId={windowId}
      onFocus={alreadyFocused}
      height={SIDEBAR_FIELD.height}
      progress={progress}
      accessory={<FieldExtensions tabId={tab.id} windowId={windowId} width={width} palette={palette} />}
    />
  );
}

function EmptyField({ tabId, windowId, width }: { tabId: string | undefined; windowId: string; width: number }) {
  const theme = useTheme();
  const palette = toolbarPalette(theme, null);
  const { hovered, hoverProps } = useHover();
  const open = () => openEmptySidebarField(windowId);
  return (
    <View {...hoverProps} style={{ flexDirection: "row", alignItems: "center", height: SIDEBAR_FIELD.height }}>
      <SidebarFieldFill hovered={hovered} />
      <Pressable onPress={open} style={{ flex: 1, height: SIDEBAR_FIELD.height, justifyContent: "center", paddingLeft: space.l }}>
        <FadeLabel text="Search or enter address" fontSize={font.body.fontSize} color={theme.placeholder} fadeWidth={14} style={{ height: 18, marginLeft: -space.xxs }} />
      </Pressable>
      {tabId ? (
        <View style={{ flexDirection: "row", alignItems: "center", paddingRight: space.xs }}>
          <FieldExtensions tabId={tabId} windowId={windowId} width={width} palette={palette} />
        </View>
      ) : null}
    </View>
  );
}
