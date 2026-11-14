import { useRef, type RefObject } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { sfSymbol } from "../../lib/sfSymbols";
import { openSettings } from "../../state/settings/nav";
import { openRemote } from "../../state/sync/actions";
import { remoteTitle } from "../../state/sync/spaces";
import type { PinnedTile, SyncedProfile } from "../../state/sync/store";
import { capsule, Favicon, font, isSymbolName, space, spacesLayout, Symbol, useTheme } from "../ui";

const TILE_MIN_WIDTH = 72;
const TILE_HEIGHT = 56;

export function Tiles({
  tiles,
  profileId,
  onFolder,
}: {
  tiles: PinnedTile[];
  profileId: string;
  onFolder: (tile: PinnedTile, anchor: RefObject<View | null>) => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const columns = Math.max(1, Math.floor((width - space.l * 2 + space.s) / (TILE_MIN_WIDTH + space.s)));
  const rows: PinnedTile[][] = [];
  for (let i = 0; i < tiles.length; i += columns) rows.push(tiles.slice(i, i + columns));
  return (
    <View style={styles.tiles}>
      {rows.map((row, index) => (
        <View key={index} style={styles.tileRow}>
          {row.map((tile) => (
            <TileButton key={tile.key} tile={tile} profileId={profileId} onFolder={onFolder} />
          ))}
          {Array.from({ length: columns - row.length }, (_, i) => (
            <View key={`gap${i}`} style={styles.tile} />
          ))}
        </View>
      ))}
    </View>
  );
}

function TileButton({
  tile,
  profileId,
  onFolder,
}: {
  tile: PinnedTile;
  profileId: string;
  onFolder: (tile: PinnedTile, anchor: RefObject<View | null>) => void;
}) {
  const theme = useTheme();
  const anchor = useRef<View>(null);
  const folder = tile.folder?.length ? tile.folder : null;
  const label = tile.title.trim() || remoteTitle("", tile.url);
  return (
    <Pressable
      ref={anchor}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => (folder ? onFolder(tile, anchor) : openRemote(tile.url, tile.title, profileId))}
      style={styles.tile}
    >
      <View style={[styles.tileFace, { backgroundColor: theme.groupFill }]}>
        {folder ? <Symbol name="folderFill" size={22} color={theme.secondaryLabel} /> : <Favicon iconUrl={null} pageUrl={tile.url} size={24} />}
      </View>
      <Text style={[font.caption, styles.medium, { color: theme.secondaryLabel }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Switcher({
  profiles,
  selected,
  onChoose,
  bottom,
}: {
  profiles: SyncedProfile[];
  selected: string;
  onChoose: (id: string) => void;
  bottom: number;
}) {
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
              <ProfileMark icon={profile.icon} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ProfileMark({ icon }: { icon: string | null }) {
  const theme = useTheme();
  const symbol = sfSymbol(icon, isSymbolName);
  if (symbol && isSymbolName(symbol)) return <Symbol name={symbol} size={20} color={theme.label} />;
  return <View style={[styles.dot, { backgroundColor: theme.label }]} />;
}

export function Unavailable({ isOff }: { isOff: boolean }) {
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
  bold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  centered: { textAlign: "center" },
  tiles: { gap: space.s, paddingHorizontal: space.l, paddingTop: space.xs, paddingBottom: space.s },
  tileRow: { flexDirection: "row", gap: space.s },
  tile: { flex: 1, alignItems: "center", gap: spacesLayout.tileGap },
  tileFace: { alignSelf: "stretch", height: TILE_HEIGHT, borderRadius: spacesLayout.tileFaceRadius, alignItems: "center", justifyContent: "center" },
  switcherRow: { alignItems: "center", paddingTop: space.xs },
  switcher: {
    flexDirection: "row",
    height: 44,
    borderRadius: capsule(44),
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.xs,
    alignItems: "center",
  },
  switch: { width: 52, height: 36, alignItems: "center", justifyContent: "center" },
  dot: { width: spacesLayout.dot, height: spacesLayout.dot, borderRadius: capsule(spacesLayout.dot) },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacesLayout.stackGap, paddingHorizontal: space.xxl },
  primary: { minHeight: 44, borderRadius: capsule(44), paddingHorizontal: space.xl, justifyContent: "center", marginTop: spacesLayout.buttonTop },
});
