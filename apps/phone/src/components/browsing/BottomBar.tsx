import { StyleSheet, View } from "react-native";
import type { BrowserTab } from "../../state/tabs/tabModels";
import { display } from "../../state/search/omnibox";
import { browseLayout, capsule, PressScale, Symbol, TabFace, tabsInk, tabsLayout, type ColorRoles } from "../ui";

type Props = { order: BrowserTab[]; roles: ColorRoles; showsPlus: boolean; onTabs: () => void; onPlus: () => void };

export function BottomBar({ order, roles, showsPlus, onTabs, onPlus }: Props) {
  const plus = browseLayout.plusCapsule;
  const count = order.length;
  return (
    <View style={styles.row}>
      <View style={styles.side}>
        <PressScale label="Tabs" hint={`${count} ${count === 1 ? "tab" : "tabs"}`} onPress={onTabs} style={styles.tabs}>
          <TabStack tabs={order.slice(-2)} roles={roles} />
        </PressScale>
      </View>
      <View style={{ width: plus.width, height: plus.height }}>
        {showsPlus ? (
          <PressScale
            label="New Search"
            onPress={onPlus}
            style={[
              styles.center,
              { width: plus.width, height: plus.height, borderRadius: capsule(plus.height), backgroundColor: roles.plusFill, borderColor: roles.controlEdge },
            ]}
          >
            <Symbol name="plus" size={17} color={roles.foregroundPrimary} />
          </PressScale>
        ) : null}
      </View>
      <View style={[styles.side, styles.end]}>
        <View accessibilityLabel="Page Menu" accessibilityState={{ disabled: true }} style={styles.more}>
          <View
            style={[
              styles.center,
              styles.chevron,
              { backgroundColor: roles.chevronFill, borderColor: roles.controlEdge, borderRadius: capsule(browseLayout.chevronCircle) },
            ]}
          >
            <Symbol name="chevronUp" size={16} color={roles.foregroundPrimary} />
          </View>
        </View>
      </View>
    </View>
  );
}

function TabStack({ tabs, roles }: { tabs: BrowserTab[]; roles: ColorRoles }) {
  const tile = tabsLayout.tabStackTile;
  if (!tabs.length) {
    return <View style={[styles.tile, { width: tile.width, height: tile.height, borderColor: roles.foregroundSecondary, borderWidth: 1.5 }]} />;
  }
  if (tabs.length === 1) return <Thumbnail tab={tabs[0]!} roles={roles} turn="-4deg" x={0} y={0} />;
  return (
    <View style={{ width: tile.width, height: tile.height }}>
      <Thumbnail tab={tabs[0]!} roles={roles} turn="-12deg" x={-4} y={1} />
      <Thumbnail tab={tabs[1]!} roles={roles} turn="6deg" x={4} y={-1} />
    </View>
  );
}

function Thumbnail({ tab, roles, turn, x, y }: { tab: BrowserTab; roles: ColorRoles; turn: string; x: number; y: number }) {
  const tile = tabsLayout.tabStackTile;
  const shown = display(tab.url);
  return (
    <View
      style={[
        styles.tile,
        styles.thumbnail,
        {
          width: tile.width,
          height: tile.height,
          borderColor: roles.tileEdge,
          shadowColor: tabsInk.tileShadow,
          transform: [{ translateX: x }, { translateY: y }, { rotate: turn }],
        },
      ]}
    >
      <TabFace tab={tab} title={tab.title} host={shown.host} tone={roles.tileFill} roles={roles} compact />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: browseLayout.hitTarget,
    paddingHorizontal: browseLayout.barSideInset - 4,
  },
  side: { flex: 1, alignItems: "flex-start", justifyContent: "center" },
  end: { alignItems: "flex-end" },
  tabs: { width: tabsLayout.tabStackButton, height: browseLayout.hitTarget, alignItems: "center", justifyContent: "center", left: -2.8 },
  center: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  more: { width: browseLayout.hitTarget, height: browseLayout.hitTarget, alignItems: "center", justifyContent: "center" },
  chevron: { width: browseLayout.chevronCircle, height: browseLayout.chevronCircle },
  tile: { borderRadius: tabsLayout.tabStackRadius },
  thumbnail: { position: "absolute", overflow: "hidden", borderWidth: 0.5, elevation: 2, shadowOpacity: 1, shadowRadius: 1.5 },
});
