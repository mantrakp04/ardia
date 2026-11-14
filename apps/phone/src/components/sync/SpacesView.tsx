import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PinnedTile, SyncedProfile } from "../../platform/sync";
import { closeArchive, openArchive } from "../../state/browse/store";
import { copyLink, menuOpenedHaptic, shareUrl } from "../../state/browse/tabMenus";
import { openSettings } from "../../state/settings/nav";
import { openRemote, selectProfile, syncNow } from "../../state/sync/actions";
import { useSelectedProfile, useSyncStatus, useSyncView } from "../../state/sync/hooks";
import { remoteTitle, spaceRows, type SpaceRow } from "../../state/sync/spaces";
import { syncBanner, type BannerIcon } from "../../state/sync/syncRules";
import { Backdrop, capsule, FloatingMenu, font, space, Symbol, tabsLayout, useTheme, type MenuItem, type SymbolName } from "../ui";

const BANNER_ICONS: Record<BannerIcon, SymbolName> = { folder: "folderFill", lock: "lockFill", reset: "arrowClockwise", warning: "exclamationmarkTriangle", offline: "wifiSlash" };
const HEADER_ICONS: Record<"star" | "laptop" | "desktop" | "phone", SymbolName> = { star: "star", laptop: "laptop", desktop: "macDesktop", phone: "iphone" };
const INDENT = 20;
const TILE_MIN_WIDTH = 72;
const TILE_HEIGHT = 56;
const BANNER_ORANGE = "#FF9500";

type RowMenu = { items: MenuItem[]; y: number };

export function SpacesView() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const status = useSyncStatus();
  const view = useSyncView();
  const selected = useSelectedProfile();
  const [chosen, setChosen] = useState<string | null>(selected?.syncId ?? null);
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const profile = view.profiles.find((p) => p.syncId === chosen) ?? selected ?? view.profiles[0] ?? null;
  const banner = syncBanner(status);
  const choose = (id: string) => {
    setChosen(id);
    selectProfile(id);
  };
  return (
    <View style={StyleSheet.absoluteFill}>
      <Backdrop colors={theme.backdrop} />
      <View style={[styles.column, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[font.title2, styles.bold, styles.fill, { color: theme.label }]} numberOfLines={1}>
            {profile?.name ?? "Spaces"}
          </Text>
          <HeaderButton icon="archivebox" label="Archive" onPress={openArchive} />
          <HeaderButton icon="xmark" label="Close" onPress={closeArchive} />
        </View>
        {banner ? (
          <View style={[styles.banner, { backgroundColor: theme.tertiaryFill }]}>
            <Symbol name={BANNER_ICONS[banner.icon]} size={18} color={BANNER_ORANGE} />
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
      {menu ? <FloatingMenu items={menu.items} place={{ top: menu.y, left: space.xl, width: tabsLayout.menuWidth }} onDismiss={() => setMenu(null)} /> : null}
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
  const rows = spaceRows(profile, open, expanded);
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
          onFolder={(tile, y) => onMenu({ items: (tile.folder ?? []).map((tab) => ({ label: remoteTitle(tab.title, tab.url), onPress: () => openRemote(tab.url, tab.title, profile.syncId) })), y })}
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
  onFolder: (tile: PinnedTile, y: number) => void;
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
          <Symbol name="globe" size={20} color={tint} />
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
          <Symbol name="folderFill" size={20} color={tint} />
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

function Tiles({ tiles, profileId, onFolder }: { tiles: PinnedTile[]; profileId: string; onFolder: (tile: PinnedTile, y: number) => void }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const columns = Math.max(1, Math.floor((width - space.l * 2 + space.s) / (TILE_MIN_WIDTH + space.s)));
  const rows: PinnedTile[][] = [];
  for (let i = 0; i < tiles.length; i += columns) rows.push(tiles.slice(i, i + columns));
  return (
    <View style={styles.tiles}>
      {rows.map((row, index) => (
        <View key={index} style={styles.tileRow}>
          {row.map((tile) => {
            const folder = tile.folder?.length ? tile.folder : null;
            const label = tile.title.trim() || remoteTitle("", tile.url);
            return (
              <Pressable
                key={tile.key}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={(event) => (folder ? onFolder(tile, event.nativeEvent.pageY) : openRemote(tile.url, tile.title, profileId))}
                style={styles.tile}
              >
                <View style={[styles.tileFace, { backgroundColor: theme.groupFill }]}>
                  <Symbol name={folder ? "folderFill" : "globe"} size={22} color={theme.secondaryLabel} />
                </View>
                <Text style={[font.caption, styles.medium, { color: theme.secondaryLabel }]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
          {Array.from({ length: columns - row.length }, (_, i) => (
            <View key={`gap${i}`} style={styles.tile} />
          ))}
        </View>
      ))}
    </View>
  );
}

function Switcher({ profiles, selected, onChoose, bottom }: { profiles: SyncedProfile[]; selected: string; onChoose: (id: string) => void; bottom: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.switcherRow, { paddingBottom: bottom + space.xs }]}>
      <View accessibilityRole="tablist" style={[styles.switcher, { backgroundColor: theme.tertiaryFill, borderColor: theme.separator }]}>
        {profiles.map((profile) => {
          const isSelected = profile.syncId === selected;
          return (
            <Pressable
              key={profile.syncId}
              accessibilityRole="tab"
              accessibilityLabel={profile.name}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onChoose(profile.syncId)}
              style={[styles.switch, { opacity: isSelected ? 1 : 0.35 }]}
            >
              <View style={[styles.dot, { backgroundColor: theme.label }]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Unavailable({ isOff }: { isOff: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.unavailable}>
      <Symbol name="macAndPhone" size={48} color={theme.secondaryLabel} />
      <Text style={[font.title2, styles.bold, styles.centered, { color: theme.label }]}>Your Mac’s Spaces</Text>
      <Text style={[font.subheadline, styles.centered, { color: theme.secondaryLabel }]}>{isOff ? "Every tab, anywhere." : "Waiting for your Mac."}</Text>
      <Pressable accessibilityRole="button" onPress={() => openSettings({ page: "sync" })} style={[styles.primary, { backgroundColor: theme.label }]}>
        <Text style={[font.body, styles.bold, { color: theme.groupFill }]}>{isOff ? "Sync With Mac" : "Sync Settings"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1 },
  fill: { flex: 1 },
  bold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  centered: { textAlign: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: space.s, paddingLeft: space.l + 4, paddingRight: space.s, paddingTop: space.m, paddingBottom: space.xs },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: space.l, marginBottom: space.xs, padding: 12, borderRadius: 14 },
  fix: { borderWidth: StyleSheet.hairlineWidth, borderRadius: capsule(32), minHeight: 32, paddingHorizontal: space.m, justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space.s, minHeight: 48, paddingRight: space.l },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: 4 },
  showAll: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.l },
  empty: { alignItems: "center", gap: 10, paddingTop: space.huge * 2, paddingHorizontal: space.xxl },
  tiles: { gap: space.s, paddingHorizontal: space.l, paddingTop: space.xs, paddingBottom: space.s },
  tileRow: { flexDirection: "row", gap: space.s },
  tile: { flex: 1, alignItems: "center", gap: 6 },
  tileFace: { alignSelf: "stretch", height: TILE_HEIGHT, borderRadius: tabsLayout.tabStackRadius + 6, alignItems: "center", justifyContent: "center" },
  switcherRow: { alignItems: "center", paddingTop: space.xs },
  switcher: { flexDirection: "row", height: 44, borderRadius: capsule(44), borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.xs, alignItems: "center" },
  switch: { width: 52, height: 36, alignItems: "center", justifyContent: "center" },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: space.xxl },
  primary: { minHeight: 44, borderRadius: capsule(44), paddingHorizontal: space.xl, justifyContent: "center", marginTop: 6 },
});
