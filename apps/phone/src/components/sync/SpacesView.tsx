import { useEffect, useMemo, useState, type RefObject } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PinnedTile, SyncedProfile } from "../../state/sync/store";
import { Switcher, Tiles, Unavailable } from "./SpacesParts";
import { closeArchive, openArchive } from "../../state/browse/store";
import { copyLink, menuOpenedHaptic, shareUrl } from "../../state/browse/tabMenus";
import { openSettings } from "../../state/settings/nav";
import { openRemote, selectProfile, syncNow } from "../../state/sync/actions";
import { useSelectedProfile, useSyncStatus, useSyncView } from "../../state/sync/hooks";
import { remoteTitle, spaceGroupColor, spaceRows, type SpaceRow } from "../../state/sync/spaces";
import { spaceTone } from "../../lib/profileLook";
import { sfSymbol } from "../../lib/sfSymbols";
import { syncBanner, type BannerIcon } from "../../state/sync/syncRules";
import {
  Backdrop,
  capsule,
  DEFAULT_PROFILE_COLOR,
  Favicon,
  FloatingMenu,
  font,
  useSheetFrame,
  isSymbolName,
  PROFILE_PRESETS,
  space,
  Symbol,
  spacesLayout,
  syncInk,
  tabsLayout,
  useTheme,
  type MenuItem,
  type SymbolName,
} from "../ui";

const BANNER_ICONS: Record<BannerIcon, SymbolName> = {
  folder: "folderFill",
  lock: "lockFill",
  reset: "arrowClockwise",
  warning: "exclamationmarkTriangle",
  offline: "wifiSlash",
};
const HEADER_ICONS: Record<"star" | "laptop" | "desktop" | "phone", SymbolName> = { star: "star", laptop: "laptop", desktop: "macDesktop", phone: "iphone" };
const INDENT = 20;

const SPACE_ROWS_FIRST = 16;
const SPACE_ROWS_WINDOW = 5;

type RowMenu = { items: MenuItem[]; y: number; anchor?: RefObject<View | null> };

export function SpacesView() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const frame = useSheetFrame();
  const status = useSyncStatus();
  const view = useSyncView();
  const shown = useSelectedProfile();
  const [chosen, setChosen] = useState<string | null>(null);
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const profile = (chosen ? view.profiles.find((p) => p.syncId === chosen) : undefined) ?? shown ?? view.profiles[0] ?? null;
  useEffect(() => {
    if (chosen && shown?.syncId === chosen) setChosen(null);
  }, [chosen, shown?.syncId]);
  const tone = useMemo(() => spaceTone(profile, theme.dark, false, PROFILE_PRESETS, DEFAULT_PROFILE_COLOR), [profile, theme.dark]);
  const banner = syncBanner(status);
  const choose = (id: string) => {
    setChosen(id);
    selectProfile(id);
  };
  return (
    <View style={StyleSheet.absoluteFill}>
      <Backdrop colors={tone} />
      <View style={[styles.column, { paddingTop: frame ? 0 : insets.top }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[font.title2, styles.bold, styles.fill, { color: theme.label }]} numberOfLines={1}>
            {profile?.name ?? "Spaces"}
          </Text>
          <HeaderButton icon="archivebox" label="Archive" onPress={openArchive} />
          <HeaderButton icon="xmark" label="Close" onPress={closeArchive} />
        </View>
        {banner ? (
          <View style={[styles.banner, { backgroundColor: theme.tertiaryFill }]}>
            <Symbol name={BANNER_ICONS[banner.icon]} size={18} color={syncInk.banner} />
            <Text style={[font.subheadline, styles.fill, { color: theme.label }]}>{banner.text}</Text>
            {banner.needsAction ? (
              <Pressable accessibilityRole="button" onPress={() => openSettings({ page: "sync" })} style={[styles.fix, { borderColor: theme.separator }]}>
                <Text style={[font.subheadline, styles.bold, { color: theme.formAccent }]}>Fix</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {profile ? (
          <SpacePage key={profile.syncId} profile={profile} onMenu={setMenu} bottom={view.profiles.length > 1 ? 0 : insets.bottom} />
        ) : (
          <Unavailable isOff={status.phase === "off"} />
        )}
        {view.profiles.length > 1 && profile ? <Switcher profiles={view.profiles} selected={profile.syncId} onChoose={choose} bottom={insets.bottom} /> : null}
      </View>
      {menu ? (
        <FloatingMenu
          items={menu.items}
          anchor={menu.anchor}
          place={{ top: menu.y, left: space.xl, width: tabsLayout.menuWidth }}
          onDismiss={() => setMenu(null)}
        />
      ) : null}
    </View>
  );
}

function HeaderButton({ icon, label, onPress }: { icon: SymbolName; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.headerButton}>
      <View style={[styles.headerCircle, { backgroundColor: theme.tertiaryFill }]}>
        <Symbol name={icon} size={15} color={theme.secondaryLabel} />
      </View>
    </Pressable>
  );
}

function SpacePage({ profile, onMenu, bottom }: { profile: SyncedProfile; onMenu: (menu: RowMenu) => void; bottom: number }) {
  const theme = useTheme();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const frame = useSheetFrame();
  const rows = useMemo(() => spaceRows(profile, open, expanded), [profile, open, expanded]);
  const toggle = (key: string) => setOpen((now) => (now.has(key) ? new Set([...now].filter((k) => k !== key)) : new Set([...now, key])));
  const linkMenu = (url: string, title: string, y: number) => {
    menuOpenedHaptic();
    const sharing: MenuItem[] = /^https?:\/\//i.test(url)
      ? [
          { label: "Copy Link", icon: "link", onPress: () => copyLink(url) },
          { label: "Share", icon: "squareAndArrowUp", onPress: () => shareUrl(url, title) },
        ]
      : [];
    onMenu({ items: [{ label: "Open", icon: "arrowUpForward", onPress: () => openRemote(url, title, profile.syncId) }, ...sharing], y });
  };
  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.key}
      initialNumToRender={SPACE_ROWS_FIRST}
      windowSize={SPACE_ROWS_WINDOW}
      removeClippedSubviews
      {...frame?.list(true)}
      contentContainerStyle={{ paddingBottom: bottom + space.l }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void syncNow().then(() => setRefreshing(false));
          }}
        />
      }
      renderItem={({ item }) => (
        <Row
          row={item}
          profileId={profile.syncId}
          onToggle={toggle}
          onShowAll={(id) => setExpanded((now) => new Set([...now, id]))}
          onLongPress={linkMenu}
          onFolder={(tile, anchor) =>
            onMenu({
              items: (tile.folder ?? []).map((tab) => ({
                label: remoteTitle(tab.title, tab.url),
                onPress: () => openRemote(tab.url, tab.title, profile.syncId),
              })),
              y: 0,
              anchor,
            })
          }
          tint={theme.secondaryLabel}
        />
      )}
    />
  );
}

type RowProps = {
  row: SpaceRow;
  profileId: string;
  tint: string;
  onToggle: (key: string) => void;
  onShowAll: (deviceId: string) => void;
  onLongPress: (url: string, title: string, y: number) => void;
  onFolder: (tile: PinnedTile, anchor: RefObject<View | null>) => void;
};

function Row({ row, profileId, tint, onToggle, onShowAll, onLongPress, onFolder }: RowProps) {
  const theme = useTheme();
  switch (row.kind) {
    case "tiles":
      return <Tiles tiles={row.tiles} profileId={profileId} onFolder={onFolder} />;
    case "tab":
      return (
        <Pressable
          accessibilityRole="button"
          onPress={() => openRemote(row.url, row.title, profileId)}
          onLongPress={(event) => onLongPress(row.url, row.title, event.nativeEvent.pageY)}
          style={({ pressed }) => [styles.row, { paddingLeft: space.l + INDENT * row.depth }, pressed ? { backgroundColor: theme.rowHighlight } : null]}
        >
          <Favicon iconUrl={null} pageUrl={row.url} size={20} />
          <Text style={[font.body, styles.medium, styles.fill, { color: theme.label }]} numberOfLines={1}>
            {row.title}
          </Text>
        </Pressable>
      );
    case "group":
    case "folder":
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: row.isOpen }}
          onPress={() => onToggle(row.key)}
          style={({ pressed }) => [styles.row, { paddingLeft: space.l + INDENT * row.depth }, pressed ? { backgroundColor: theme.rowHighlight } : null]}
        >
          <Symbol name={groupSymbol(row.kind === "group" ? row.icon : null)} size={20} color={(row.kind === "group" ? spaceGroupColor(row.color) : null) ?? tint} />
          <Text style={[font.body, styles.medium, styles.fill, { color: theme.label }]} numberOfLines={2}>
            {row.title}
          </Text>
          <View style={{ transform: [{ rotate: row.isOpen ? "90deg" : "0deg" }] }}>
            <Symbol name="chevronRight" size={14} color={tint} />
          </View>
        </Pressable>
      );
    case "header":
      return (
        <View accessibilityRole="header" accessible style={styles.sectionHeader}>
          <Symbol name={HEADER_ICONS[row.icon]} size={15} color={tint} />
          <Text style={[font.footnote, styles.bold, { color: tint }]}>{row.title}</Text>
        </View>
      );
    case "showAll":
      return (
        <Pressable accessibilityRole="button" onPress={() => onShowAll(row.deviceId)} style={styles.showAll}>
          <Text style={[font.subheadline, styles.bold, { color: tint }]}>Show All</Text>
        </Pressable>
      );
    case "empty":
      return (
        <View style={styles.empty}>
          <Symbol name="squareStack" size={40} color={tint} />
          <Text style={[font.title3, styles.bold, styles.centered, { color: theme.label }]}>Nothing Here Yet</Text>
          <Text style={[font.subheadline, styles.centered, { color: tint }]}>{`Pinned and open tabs from ${row.name} show up here.`}</Text>
        </View>
      );
  }
}

function groupSymbol(icon: string | null): SymbolName {
  const symbol = sfSymbol(icon, isSymbolName);
  return symbol && isSymbolName(symbol) ? symbol : "folderFill";
}

const styles = StyleSheet.create({
  column: { flex: 1 },
  fill: { flex: 1 },
  bold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  centered: { textAlign: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    paddingLeft: space.l + 4,
    paddingRight: space.s,
    paddingTop: space.m,
    paddingBottom: space.xs,
  },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCircle: {
    width: spacesLayout.headerCircle,
    height: spacesLayout.headerCircle,
    borderRadius: capsule(spacesLayout.headerCircle),
    alignItems: "center",
    justifyContent: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacesLayout.bannerGap,
    marginHorizontal: space.l,
    marginBottom: space.xs,
    padding: spacesLayout.bannerPadding,
    borderRadius: spacesLayout.bannerRadius,
  },
  fix: { borderWidth: StyleSheet.hairlineWidth, borderRadius: capsule(32), minHeight: 32, paddingHorizontal: space.m, justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space.s, minHeight: 48, paddingRight: space.l },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacesLayout.headerGap,
    paddingHorizontal: space.l,
    paddingTop: space.l,
    paddingBottom: spacesLayout.headerBottom,
  },
  showAll: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.l },
  empty: { alignItems: "center", gap: spacesLayout.stackGap, paddingTop: space.huge * 2, paddingHorizontal: space.xxl },
});
