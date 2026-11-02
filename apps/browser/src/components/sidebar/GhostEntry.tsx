import { tabTitle } from "../../state/browser/model";
import { Image, View } from "react-native";
import { knownFaviconTheme, resolveFavicon } from "../../state/favicons/favicons";
import { Divider, FadeLabel, font, radius, space, Symbol, Text, withAlpha } from "../ui";
import { layout, useTheme } from "../ui/theme";
import type { BrowserState } from "../../state/browser/store";
import type { GroupColor } from "../../state/browser/types";
import { groupLabel } from "../../state/pins/tabGrouping";
import { splitRowPanes } from "../../state/splits/splits";
import { isSilenced } from "../../state/tabs/mute";
import { groupEntries, keptEntry } from "../../state/sidebar/entries";
import { GROUP_BORDER, GROUP_INDENT, GROUP_RADIUS } from "./geometry";
import { headGap } from "../../state/sidebar/geometry";
import { pointerOnGroup, pointerOnRow } from "../../state/sidebar/hover";
import { FaviconFallback, NewTabIcon } from "../favicon/Favicon";
import { TabIcon } from "./TabIcon";
import { iconSymbol } from "../../lib/customIcon";
import { groupSurface, TAB_ROW, TABULAR_NUMS, useSidebarTokens } from "./tokens";
import { SidebarRowLabel } from "./SidebarRow";
import { entryKey, parseEntry } from "../../state/sidebar/entryKey";

type TabShot = { kind: "tab"; key: string; title: string; url: string; favicon?: string | null; icon?: string | null; profileId: string; uri: string | null; template: boolean; sound: "muted" | "playing" | null; hovered: boolean };
type SplitShot = { kind: "split"; key: string; panes: TabShot[] };
type GroupShot = {
  kind: "group";
  key: string;
  label: string;
  color: GroupColor | null;
  icon: { url: string; favicon?: string | null; icon?: string | null; profileId?: string } | null;
  collapsed: boolean;
  hovered: boolean;
  members: (TabShot | SplitShot | GroupShot)[];
};
export type EntrySnapshot = TabShot | SplitShot | GroupShot;

function tabShot(s: BrowserState, tabId: string, hovered: boolean): TabShot | null {
  const tab = s.tabs[tabId];
  if (!tab) return null;
  const uri = tab.customIcon ? null : (resolveFavicon(tab.url, tab.favicon, tab.profileId)?.uri ?? null);
  const shape = uri ? knownFaviconTheme(uri) : null;
  return {
    uri,
    template: shape?.kind === "template" && !!shape.stroke,
    kind: "tab",
    key: entryKey("tab", tabId),
    title: tabTitle(tab),
    url: tab.url,
    favicon: tab.favicon,
    icon: tab.customIcon,
    profileId: tab.profileId,
    sound: isSilenced(s, tab) ? "muted" : s.live[tabId]?.playingAudio ? "playing" : null,
    hovered,
  };
}

function splitShot(s: BrowserState, splitId: string): SplitShot {
  const panes = splitRowPanes(s, s.splits[splitId]);
  return { kind: "split", key: entryKey("split", splitId), panes: panes.flatMap((id) => tabShot(s, id, false) ?? []) };
}

export function snapshotEntry(s: BrowserState, windowId: string, profileId: string, entry: string): EntrySnapshot | null {
  const { kind, id } = parseEntry(entry);
  if (kind === "split") return splitShot(s, id);
  if (kind !== "group") return tabShot(s, id, pointerOnRow(id));
  const group = s.groups[id];
  if (!group) return null;
  const entries = groupEntries(s, id);
  const kept = group.collapsed ? keptEntry(s, windowId, profileId, entries) : null;
  const first = s.tabs[group.tabIds[0] ?? ""];
  return {
    kind: "group",
    key: entry,
    label: groupLabel(s, group),
    color: group.color ?? null,
    icon: group.icon || first ? { url: first?.url ?? "", favicon: first?.favicon, icon: group.icon ?? first?.customIcon, profileId: first?.profileId } : null,
    collapsed: !!group.collapsed,
    hovered: pointerOnGroup(id),
    members: (group.collapsed ? (kept ? [kept] : []) : entries).flatMap((e) => (parseEntry(e).kind === "tab" ? tabShot(s, parseEntry(e).id, false) : snapshotEntry(s, windowId, profileId, e)) ?? []),
  };
}

export function ghostEntry(snapshot: EntrySnapshot, theme: ReturnType<typeof useTheme>, top: number) {
  if (snapshot.kind === "tab") return tabGhost(snapshot, theme, top);
  return <View style={{ marginTop: top }}>{snapshot.kind === "split" ? <SplitGhost shot={snapshot} /> : <GroupGhost shot={snapshot} />}</View>;
}

function ghostIcon(shot: TabShot, theme: ReturnType<typeof useTheme>) {
  const symbol = iconSymbol(shot.icon);
  if (symbol) return <Symbol name={symbol} size={13} weight="medium" color={theme.icon} style={{ width: 16, height: 16 }} />;
  if (shot.icon) return <TabIcon url={shot.url} icon={shot.icon} profileId={shot.profileId} />;
  if (shot.uri) return <Image source={{ uri: shot.uri }} style={{ width: 16, height: 16, borderRadius: radius.hair, tintColor: shot.template && !theme.dark ? theme.textPrimary : undefined }} />;
  return shot.url ? <FaviconFallback url={shot.url} /> : <NewTabIcon />;
}

function tabGhost(shot: TabShot, theme: ReturnType<typeof useTheme>, top = 0) {
  return (
    <View
      key={shot.key}
      style={{
        marginTop: top,
        height: layout.rowHeight,
        borderRadius: radius.chrome,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: TAB_ROW.contentLeft,
        paddingRight: shot.hovered ? TAB_ROW.trailing : TAB_ROW.trailing + TAB_ROW.closeSlot,
        backgroundColor: shot.hovered ? theme.tabHover : undefined,
      }}
    >
      {ghostIcon(shot, theme)}
      {shot.sound ? <Symbol name={shot.sound === "muted" ? "speaker.slash" : "speaker.wave.2"} size={12} color={theme.textTab} style={{ width: 18, height: 16, marginLeft: space.s }} /> : null}
      <SidebarRowLabel text={shot.title} color={theme.textTab} />
      {shot.hovered ? <Symbol name="xmark" size={10} weight="semibold" color={theme.icon} style={{ width: TAB_ROW.closeSlot, height: TAB_ROW.closeSlot }} /> : null}
    </View>
  );
}

function SplitGhost({ shot }: { shot: SplitShot }) {
  const theme = useTheme();
  return (
    <View style={{ height: layout.rowHeight, borderRadius: radius.chrome, flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs }}>
      {shot.panes.map((pane, i) => (
        <View key={pane.key} style={{ flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0, gap: space.xxs }}>
          {i > 0 && <Divider vertical thick length={16} />}
          <View style={{ flex: 1, minWidth: 0, height: layout.rowHeight - 6, flexDirection: "row", alignItems: "center", paddingLeft: space.s }}>
            <TabIcon url={pane.url} favicon={pane.favicon} icon={pane.icon} profileId={pane.profileId} compact />
            <FadeLabel text={pane.title} fontSize={font.small.fontSize} color={theme.textTab} style={{ flex: 1, height: 16, marginLeft: space.xs }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const MEASURE_LABEL = { opacity: 0, fontVariant: TABULAR_NUMS } as const;

function GroupGhost({ shot }: { shot: GroupShot }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const { fill, stroke } = groupSurface(shot.color, tokens);
  return (
    <View style={{ paddingVertical: GROUP_BORDER }}>
      {shot.hovered ? <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: GROUP_RADIUS, backgroundColor: fill, borderWidth: GROUP_BORDER, borderColor: stroke }} /> : null}
      <View style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: TAB_ROW.contentLeft, paddingRight: TAB_ROW.trailing }}>
        {shot.icon ? <TabIcon url={shot.icon.url} favicon={shot.icon.favicon} icon={shot.icon.icon} profileId={shot.icon.profileId} /> : <View style={{ width: 16 }} />}
        <View style={{ flexShrink: 1, height: TAB_ROW.titleHeight, marginLeft: TAB_ROW.titleGap, paddingRight: space.m, justifyContent: "center" }}>
          <Text lines={1} weight="medium" style={MEASURE_LABEL}>
            {shot.label}
          </Text>
          <FadeLabel text={shot.label} fontSize={font.body.fontSize} weight="medium" color={tokens.groupTitle} style={{ position: "absolute", left: 0, right: 0, top: 0, height: TAB_ROW.titleHeight }} />
        </View>
        <View style={{ width: 10, height: 10, transform: [{ rotate: shot.collapsed ? "-90deg" : "0deg" }] }}>
          <Symbol name="chevron.down" size={9} weight="semibold" color={withAlpha(tokens.groupTitle, 0.5)} style={{ width: 10, height: 10 }} />
        </View>
      </View>
      <View style={{ gap: layout.rowGap, paddingTop: headGap(shot.members[0]?.key), paddingLeft: GROUP_INDENT }}>{shot.members.map((m) => (m.kind === "split" ? <SplitGhost key={m.key} shot={m} /> : m.kind === "group" ? <GroupGhost key={m.key} shot={m} /> : tabGhost(m, theme)))}</View>
    </View>
  );
}
