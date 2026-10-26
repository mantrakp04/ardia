import { Image, Text, View } from "react-native";
import { knownFaviconTheme, resolveFavicon } from "../../state/favicons/favicons";
import { FadeLabel, font, radius, Symbol, weight } from "../ui";
import { layout, useTheme } from "../ui/theme";
import type { BrowserState } from "../../state/browser/store";
import type { GroupColor } from "../../state/browser/types";
import { groupLabel } from "../../state/pins/organize";
import { splitRowPanes } from "../../state/splits/splits";
import { tabTitle } from "../../state/sidebar/actions";
import { groupEntries, keptEntry } from "../../state/sidebar/entries";
import { GROUP_BORDER, GROUP_INDENT, GROUP_PAD, GROUP_RADIUS } from "./geometry";
import { headGap } from "../../state/sidebar/geometry";
import { pointerOnGroup, pointerOnRow } from "../../state/sidebar/hover";
import { FaviconFallback, NewTabIcon } from "../favicon/Favicon";
import { TabIcon } from "./TabIcon";
import { SYMBOL_PREFIX } from "../../state/groups/groupIcons";
import { groupSurface, TABULAR_NUMS, useSidebarTokens, withAlpha } from "./tokens";

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
    key: `t:${tabId}`,
    title: tabTitle(tab),
    url: tab.url,
    favicon: tab.favicon,
    icon: tab.customIcon,
    profileId: tab.profileId,
    sound: tab.muted ? "muted" : s.live[tabId]?.playingAudio ? "playing" : null,
    hovered,
  };
}

function splitShot(s: BrowserState, splitId: string): SplitShot {
  const panes = splitRowPanes(s, s.splits[splitId]);
  return { kind: "split", key: `s:${splitId}`, panes: panes.flatMap((id) => tabShot(s, id, false) ?? []) };
}

export function snapshotEntry(s: BrowserState, windowId: string, profileId: string, entry: string): EntrySnapshot | null {
  const id = entry.slice(2);
  if (entry.startsWith("s:")) return splitShot(s, id);
  if (!entry.startsWith("g:")) return tabShot(s, id, pointerOnRow(id));
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
    members: (group.collapsed ? (kept ? [kept] : []) : entries).flatMap((e) => (e.startsWith("t:") ? tabShot(s, e.slice(2), false) : snapshotEntry(s, windowId, profileId, e)) ?? []),
  };
}

export function ghostEntry(snapshot: EntrySnapshot, theme: ReturnType<typeof useTheme>, top: number) {
  if (snapshot.kind === "tab") return tabGhost(snapshot, theme, top);
  return <View style={{ marginTop: top }}>{snapshot.kind === "split" ? <SplitGhost shot={snapshot} /> : <GroupGhost shot={snapshot} />}</View>;
}

function ghostIcon(shot: TabShot, theme: ReturnType<typeof useTheme>) {
  if (shot.icon?.startsWith(SYMBOL_PREFIX)) return <Symbol name={shot.icon.slice(SYMBOL_PREFIX.length)} size={13} weight="medium" color={theme.icon} style={{ width: 16, height: 16 }} />;
  if (shot.icon) return <TabIcon url={shot.url} icon={shot.icon} profileId={shot.profileId} />;
  if (shot.uri) return <Image source={{ uri: shot.uri }} style={{ width: 16, height: 16, borderRadius: 3, tintColor: shot.template && !theme.dark ? theme.textPrimary : undefined }} />;
  return shot.url ? <FaviconFallback url={shot.url} /> : <NewTabIcon />;
}

function tabGhost(shot: TabShot, theme: ReturnType<typeof useTheme>, top = 0) {
  return (
    <View
      key={shot.key}
      style={{
        marginTop: top,
        height: layout.rowHeight,
        borderRadius: radius.card,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 9,
        paddingRight: shot.hovered ? 6 : 28,
        backgroundColor: shot.hovered ? theme.tabHover : undefined,
      }}
    >
      {ghostIcon(shot, theme)}
      {shot.sound ? <Symbol name={shot.sound === "muted" ? "speaker.slash" : "speaker.wave.2"} size={12} color={theme.textTab} style={{ width: 18, height: 16, marginLeft: 6 }} /> : null}
      <FadeLabel text={shot.title} fontSize={font.body.fontSize} color={theme.textTab} style={{ flex: 1, height: 18, marginLeft: 5 }} />
      {shot.hovered ? <Symbol name="xmark" size={10} weight="semibold" color={theme.icon} style={{ width: 22, height: 22 }} /> : null}
    </View>
  );
}

function SplitGhost({ shot }: { shot: SplitShot }) {
  const theme = useTheme();
  return (
    <View style={{ height: layout.rowHeight, borderRadius: radius.card, flexDirection: "row", alignItems: "center", paddingHorizontal: 3 }}>
      {shot.panes.map((pane, i) => (
        <View key={pane.key} style={{ flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 }}>
          {i > 0 && <View style={{ width: 1, height: 16, backgroundColor: theme.divider, marginRight: 2 }} />}
          <View style={{ flex: 1, minWidth: 0, height: layout.rowHeight - 6, flexDirection: "row", alignItems: "center", paddingLeft: 6 }}>
            <TabIcon url={pane.url} favicon={pane.favicon} icon={pane.icon} profileId={pane.profileId} size={14} />
            <FadeLabel text={pane.title} fontSize={font.small.fontSize} color={theme.textTab} style={{ flex: 1, height: 16, marginLeft: 5 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function GroupGhost({ shot }: { shot: GroupShot }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const { fill, stroke } = groupSurface(shot.color, tokens);
  const pad = shot.members.length || !shot.collapsed ? GROUP_PAD : 0;
  return (
    <View style={{ paddingVertical: GROUP_BORDER }}>
      {shot.hovered ? <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: GROUP_RADIUS, backgroundColor: fill, borderWidth: GROUP_BORDER, borderColor: stroke }} /> : null}
      <View style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 6 }}>
        {shot.icon ? <TabIcon url={shot.icon.url} favicon={shot.icon.favicon} icon={shot.icon.icon} profileId={shot.icon.profileId} /> : <View style={{ width: 16 }} />}
        <View style={{ flexShrink: 1, height: 18, marginLeft: 5, paddingRight: 8, justifyContent: "center" }}>
          <Text numberOfLines={1} style={{ opacity: 0, ...font.body, fontWeight: weight.medium, fontVariant: TABULAR_NUMS }}>
            {shot.label}
          </Text>
          <FadeLabel text={shot.label} fontSize={font.body.fontSize} weight="medium" color={tokens.groupTitle} style={{ position: "absolute", left: 0, right: 0, top: 0, height: 18 }} />
        </View>
        <View style={{ width: 10, height: 10, transform: [{ rotate: shot.collapsed ? "-90deg" : "0deg" }] }}>
          <Symbol name="chevron.down" size={9} weight="semibold" color={withAlpha(tokens.groupTitle, 0.5)} style={{ width: 10, height: 10 }} />
        </View>
      </View>
      <View style={{ gap: layout.rowGap, paddingTop: headGap(shot.members[0]?.key), paddingBottom: pad, paddingLeft: GROUP_INDENT }}>{shot.members.map((m) => (m.kind === "split" ? <SplitGhost key={m.key} shot={m} /> : m.kind === "group" ? <GroupGhost key={m.key} shot={m} /> : tabGhost(m, theme)))}</View>
    </View>
  );
}
