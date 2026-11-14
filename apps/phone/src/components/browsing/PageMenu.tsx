import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  closePageMenu,
  copyCurrentLink,
  editPageQuery,
  menuBack,
  menuForward,
  menuReload,
  menuStop,
  resetZoom,
  openInDefaultBrowser,
  pinCurrentToMac,
  sendCurrentTab,
  openSiteSettings,
  setBlockersOn,
  setDesktopSite,
  setNightShadeOn,
  shareCurrentPage,
  showFind,
  showReader,
  translatePage,
  zoomIn,
  zoomOut,
} from "../../state/page/actions";
import { useMenuModel, useMenuTitle, useTitleFeedback } from "../../state/page/hooks";
import { useIsPinned, useSendTargets } from "../../state/sync/hooks";
import { useTab } from "../../state/tabs/hooks";
import { capsule, FloatingMenu, font, menuLayout, PressScale, Sheet, space, Symbol, Toggle, useTheme, type SymbolName } from "../ui";

export function PageMenu({ tabId, open, onHidden }: { tabId: string; open: boolean; onHidden: () => void }) {
  const model = useMenuModel(tabId);
  return (
    <Sheet open={open} onDismiss={closePageMenu} onHidden={onHidden}>
      <ScrollView contentContainerStyle={styles.column} bounces={false}>
        <NavigationCapsule tabId={tabId} />
        <View style={styles.tiles}>
          <Tile icon="docPlaintext" title="Reader" enabled={model.tiles} onPress={showReader} />
          <Tile icon="link" title="Copy Link" enabled={model.tiles} onPress={copyCurrentLink} />
          <Tile icon="squareAndArrowUp" title="Share" enabled={model.tiles} onPress={shareCurrentPage} />
        </View>
        <Group>
          <Row icon="textMagnifyingglass" title="Find on Page" enabled={model.find} divider={model.pageRows} onPress={showFind} />
          {model.pageRows ? <SendRow tabId={tabId} enabled={model.isWebPage} /> : null}
          {model.pageRows ? <Row icon="translate" title="Translate" enabled={model.translate} divider={false} onPress={translatePage} /> : null}
        </Group>
        {model.pageRows ? (
          <>
            <Group>
              <ToggleRow
                icon={model.nightShadeOn ? "moonFill" : "moon"}
                title="Night Shade"
                value={model.nightShadeOn}
                enabled={model.isWebPage}
                onChange={setNightShadeOn}
              />
              <ZoomRow percent={model.zoomPercent} canZoomOut={model.zoomOut} canZoomIn={model.zoomIn} enabled={model.isWebPage} />
              <ToggleRow icon="desktop" title="Desktop Site" value={model.desktopSite} enabled={model.isWebPage} divider={false} onChange={setDesktopSite} />
            </Group>
            <Group>
              <ToggleRow
                icon={model.blockersEnabled ? "handRaised" : "handRaisedSlash"}
                title="Block Ads and Trackers"
                value={model.blockersEnabled}
                enabled={model.isWebPage}
                detail={model.blockedCount}
                onChange={setBlockersOn}
              />
              <Row icon="gearshape" title="Site Settings" enabled onPress={openSiteSettings} />
              <Row icon="globe" title="Open in Default Browser" enabled={model.isWebPage} divider={false} onPress={openInDefaultBrowser} />
            </Group>
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

function NavigationCapsule({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const model = useMenuModel(tabId);
  const title = useMenuTitle(tabId);
  const feedback = useTitleFeedback();
  return (
    <View style={[styles.capsule, { backgroundColor: theme.groupFill }]}>
      <CapsuleButton icon="chevronLeft" label="Back" enabled={model.back} onPress={menuBack} />
      <CapsuleButton icon="chevronRight" label="Forward" enabled={model.forward} onPress={menuForward} />
      <Pressable accessibilityRole="button" accessibilityLabel={feedback ?? title} accessibilityHint="Edits the search" onPress={editPageQuery} style={styles.title}>
        <Text style={[font.body, styles.centered, feedback ? styles.feedback : null, { color: feedback ? theme.formAccent : theme.label }]} numberOfLines={1}>
          {feedback ?? title}
        </Text>
      </Pressable>
      <PinButton tabId={tabId} enabled={model.isWebPage} />
      {model.reload === "stop" ? (
        <CapsuleButton icon="xmark" label="Stop" enabled onPress={menuStop} />
      ) : (
        <CapsuleButton icon="arrowClockwise" label="Reload" enabled={model.reloadEnabled} onPress={menuReload} />
      )}
    </View>
  );
}

function PinButton({ tabId, enabled }: { tabId: string; enabled: boolean }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const pinned = useIsPinned(tabId);
  const can = enabled && !tab?.isPrivate;
  return (
    <PressScale label={pinned ? "Pinned to Mac" : "Pin to Mac"} disabled={!can} onPress={pinCurrentToMac} style={styles.capsuleButton}>
      <Symbol name={pinned ? "starFill" : "star"} size={19} color={can ? theme.label : theme.tertiaryLabel} />
    </PressScale>
  );
}

function SendRow({ tabId, enabled }: { tabId: string; enabled: boolean }) {
  const devices = useSendTargets(tabId);
  const [menuAt, setMenuAt] = useState<number | null>(null);
  if (!enabled || !devices.length) return null;
  if (devices.length === 1) return <Row icon="paperplane" title={`Send to ${devices[0]!.name}`} enabled onPress={() => sendCurrentTab(devices[0]!)} />;
  return (
    <>
      <RowWithEvent icon="paperplane" title="Send to Device" onPress={(y) => setMenuAt(y)} />
      {menuAt !== null ? (
        <FloatingMenu
          items={devices.map((device) => ({ label: device.name, icon: device.kind === "mac" ? "laptop" : "iphone", onPress: () => sendCurrentTab(device) }))}
          place={{ top: menuAt, left: space.xxl, width: 250 }}
          onDismiss={() => setMenuAt(null)}
        />
      ) : null}
    </>
  );
}

function RowWithEvent({ icon, title, onPress }: { icon: SymbolName; title: string; onPress: (y: number) => void }) {
  const theme = useTheme();
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        onPress={(event) => onPress(event.nativeEvent.pageY)}
        style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.rowHighlight } : null]}
      >
        <View style={styles.icon}>
          <Symbol name={icon} size={20} color={theme.secondaryLabel} />
        </View>
        <Text style={[font.body, styles.rowTitle, { color: theme.label }]}>{title}</Text>
        <Symbol name="chevronDown" size={14} color={theme.tertiaryLabel} />
      </Pressable>
      <Divider />
    </View>
  );
}

function CapsuleButton({ icon, label, enabled, onPress }: { icon: SymbolName; label: string; enabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <PressScale label={label} disabled={!enabled} onPress={onPress} style={styles.capsuleButton}>
      <Symbol name={icon} size={19} color={enabled ? theme.label : theme.tertiaryLabel} />
    </PressScale>
  );
}

function Tile({ icon, title, enabled, onPress }: { icon: SymbolName; title: string; enabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  const ink = enabled ? theme.label : theme.tertiaryLabel;
  return (
    <PressScale label={title} disabled={!enabled} onPress={onPress} grow style={[styles.tile, { backgroundColor: theme.groupFill }]}>
      <Symbol name={icon} size={22} color={ink} />
      <Text style={[font.footnote, styles.medium, { color: ink }]} numberOfLines={1}>
        {title}
      </Text>
    </PressScale>
  );
}

function Group({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.group, { backgroundColor: theme.groupFill }]}>{children}</View>;
}

function Divider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.separator }]} />;
}

type RowProps = { icon: SymbolName; title: string; enabled: boolean; divider?: boolean; onPress: () => void };

function Row({ icon, title, enabled, divider = true, onPress }: RowProps) {
  const theme = useTheme();
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !enabled }}
        disabled={!enabled}
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.rowHighlight } : null]}
      >
        <View style={styles.icon}>
          <Symbol name={icon} size={20} color={theme.secondaryLabel} />
        </View>
        <Text style={[font.body, styles.rowTitle, { color: enabled ? theme.label : theme.tertiaryLabel }]}>{title}</Text>
      </Pressable>
      {divider ? <Divider /> : null}
    </View>
  );
}

type ToggleRowProps = { icon: SymbolName; title: string; value: boolean; enabled: boolean; detail?: string | null; divider?: boolean; onChange: (value: boolean) => void };

function ToggleRow({ icon, title, value, enabled, detail, divider = true, onChange }: ToggleRowProps) {
  const theme = useTheme();
  return (
    <View>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Symbol name={icon} size={20} color={theme.secondaryLabel} />
        </View>
        <Text style={[font.body, styles.rowTitle, { color: enabled ? theme.label : theme.tertiaryLabel }]}>{title}</Text>
        {detail ? (
          <Text accessibilityLabel={`Blocked ${detail}`} style={[font.subheadline, styles.digits, { color: theme.secondaryLabel }]}>
            {detail}
          </Text>
        ) : null}
        <Toggle label={title} value={value} disabled={!enabled} onChange={onChange} />
      </View>
      {divider ? <Divider /> : null}
    </View>
  );
}

function ZoomRow({ percent, canZoomOut, canZoomIn, enabled }: { percent: string; canZoomOut: boolean; canZoomIn: boolean; enabled: boolean }) {
  const theme = useTheme();
  const zoomButton = (icon: SymbolName, label: string, can: boolean, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={!can} onPress={onPress} style={styles.zoomButton}>
      <Symbol name={icon} size={16} color={can ? theme.label : theme.tertiaryLabel} />
    </Pressable>
  );
  return (
    <View>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Symbol name="textformatSize" size={20} color={theme.secondaryLabel} />
        </View>
        <Text style={[font.body, styles.rowTitle, { color: enabled ? theme.label : theme.tertiaryLabel }]}>Page Zoom</Text>
        <View style={[styles.zoom, { backgroundColor: theme.tertiaryFill, borderRadius: capsule(menuLayout.zoomButton.height) }]}>
          {zoomButton("minus", "Zoom Out", canZoomOut, zoomOut)}
          <Pressable accessibilityRole="button" accessibilityLabel="Reset Zoom" accessibilityValue={{ text: percent }} disabled={!enabled} onPress={resetZoom} style={styles.zoomReset}>
            <Text style={[font.subheadline, styles.digits, styles.medium, { color: theme.label }]}>{percent}</Text>
          </Pressable>
          {zoomButton("plus", "Zoom In", canZoomIn, zoomIn)}
        </View>
      </View>
      <Divider />
    </View>
  );
}

const styles = StyleSheet.create({
  column: { padding: menuLayout.inset, gap: menuLayout.inset },
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: menuLayout.capsuleHeight,
    borderRadius: capsule(menuLayout.capsuleHeight),
    paddingHorizontal: space.xs,
  },
  capsuleButton: { minWidth: 44, minHeight: menuLayout.capsuleHeight, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, paddingHorizontal: space.xs, justifyContent: "center", minHeight: menuLayout.capsuleHeight },
  centered: { textAlign: "center" },
  feedback: { fontWeight: "600" },
  tiles: { flexDirection: "row", gap: space.s },
  tile: {
    minHeight: menuLayout.tileHeight,
    borderRadius: menuLayout.innerRadius,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs + 2,
    paddingVertical: space.m,
  },
  medium: { fontWeight: "500" },
  group: { borderRadius: menuLayout.innerRadius, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", minHeight: menuLayout.rowHeight, paddingHorizontal: space.l, gap: space.m },
  icon: { width: menuLayout.iconSlot, alignItems: "center" },
  rowTitle: { flex: 1, paddingVertical: space.s },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: space.l + menuLayout.iconSlot + space.m },
  digits: { fontVariant: ["tabular-nums"] },
  zoom: { flexDirection: "row", alignItems: "center", overflow: "hidden" },
  zoomButton: { width: menuLayout.zoomButton.width, height: menuLayout.zoomButton.height, alignItems: "center", justifyContent: "center" },
  zoomReset: { minWidth: menuLayout.zoomReset, height: menuLayout.zoomButton.height, alignItems: "center", justifyContent: "center" },
});
