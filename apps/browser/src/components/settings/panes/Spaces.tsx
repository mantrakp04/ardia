import { chooseFromMenu } from "../../../state/app/menuChoice";
import { iconSymbol as spaceSymbol } from "../../../lib/customIcon";
import { requestCreateSpace as createSpace } from "../../../state/spaces/createSpaceRequest";
import { useProfile, useProfiles } from "../../../state/profiles/hooks";
import { keepSpaceProfile } from "../../../state/sync/engine";
import { confirm } from "../../../state/app/system";
import { ContextMenuArea, Symbol, Box, Button, font, PopUp, TextField, Toggle, useHover } from "../../ui";
import { hapticTick, showMenu } from "../../../state/app/system";
import { useLayoutEffect, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { deleteSpace } from "../../../state/browser/actions";
import { hex, spaceAccent, useTheme } from "../../ui/theme";
import { useSpaceDataStats, useSpaceOrder } from "../../../state/spaces/hooks";
import { currentSpaceOrder, currentSpaces } from "../../../state/browser/current";
import { assignSpaceProfile, reorderSpaces, setDefaultSpace, updateSpace } from "../../../state/spaces/actions";
import { updateSettings } from "../../../state/settings/actions";
import { useSpace, useSpaces, useSettings } from "../../../state/browser/hooks";
import type { Space } from "../../../state/browser/types";
import { ClearDataDialog } from "../../pages/ClearDataDialog";
import { Group, Row, SectionHeader } from "../Form";
import { ColorStack } from "../../spaces/CreateSpace";
import { iconMenuItems, PROFILE_SYMBOLS, SpaceBadge } from "../../spaces/SpaceIcons";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { ThemeSection } from "../ThemeEditor";
import { goToSettingsPane } from "../../../state/settings/settingsWindows";
import { curve } from "../../ui/motion";
import { settingsType, settingsMotion } from "../tokens";

export function SpacesPane() {
  const theme = useTheme();
  const spaces = useSpaces();
  const defaultId = useSettings((s) => s.defaultSpaceId);
  const switcherIcons = useSettings((s) => s.spaceSwitcherIcons);

  return (
    <View>
      <Text style={{ marginTop: 20, ...settingsType.lead, lineHeight: 17, color: theme.textSecondary }}>
        Spaces keep your tabs, saved rows, folders and themes separate. Choose their browsing profiles in Space details.
      </Text>

      <SectionHeader title="Default space" />
      <Group>
        <Row anchor="spaces.defaultSpace">
          <PopUp
            value={defaultId}
            options={spaces.map((p) => ({ value: p.id, title: p.name }))}
            onChange={(id) => setDefaultSpace(id)}
            minWidth={160}
          />
        </Row>
      </Group>

      <SectionHeader title="Space switcher" />
      <Group>
        <Row anchor="spaces.switcherIcons">
          <Toggle value={switcherIcons} onChange={(spaceSwitcherIcons) => updateSettings({ spaceSwitcherIcons })} />
        </Row>
      </Group>

      <SectionHeader
        anchor="spaces.list"
        description="Drag to reorder. ⌃1–⌃9 switch to the first nine."
        action={<Button title="Create Space" icon="plus" onPress={() => void createSpace()} />}
      />
      <SpaceList />
    </View>
  );
}

const ROW_HEIGHT = 46;
const settle = (value: Animated.Value, toValue: number) =>
  Animated.timing(value, { toValue, duration: settingsMotion.spaceRowSettle, easing: curve.outCubic, useNativeDriver: true });

function SpaceList() {
  const order = useSpaceOrder();
  const offsets = useRef(new Map<string, Animated.Value>()).current;
  const offsetOf = (id: string) => {
    let v = offsets.get(id);
    if (!v) offsets.set(id, (v = new Animated.Value(0)));
    return v;
  };
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef({ id: "", from: 0, to: 0, reorderPending: false });

  useLayoutEffect(() => {
    if (!drag.current.reorderPending) return;
    drag.current.reorderPending = false;
    offsets.forEach((v) => v.setValue(0));
  }, [order]);

  const controller = useRef({
    start(id: string) {
      const ids = currentSpaceOrder();
      const from = ids.indexOf(id);
      drag.current = { id, from, to: from, reorderPending: false };
      setDragging(id);
    },
    move(dy: number) {
      const { id, from } = drag.current;
      const ids = currentSpaceOrder();
      const max = ids.length - 1;
      offsetOf(id).setValue(Math.max(-from * ROW_HEIGHT - 6, Math.min((max - from) * ROW_HEIGHT + 6, dy)));
      const to = Math.max(0, Math.min(max, Math.round(from + dy / ROW_HEIGHT)));
      if (to === drag.current.to) return;
      drag.current.to = to;
      hapticTick();
      ids.forEach((other, j) => {
        if (other === id) return;
        settle(offsetOf(other), from < j && j <= to ? -ROW_HEIGHT : to <= j && j < from ? ROW_HEIGHT : 0).start();
      });
    },
    end(commit: boolean) {
      const { id, from, to } = drag.current;
      setDragging(null);
      if (!commit || from === to) {
        offsets.forEach((v) => settle(v, 0).start());
        return;
      }
      const ids = currentSpaceOrder().filter((x) => x !== id);
      ids.splice(to, 0, id);
      drag.current.reorderPending = true;
      reorderSpaces(ids);
    },
  }).current;

  return (
    <Box fill="groupFill" border="groupBorder" radius="card" style={{ overflow: "hidden" }}>
      {order.map((id, i) => (
        <SpaceRow key={id} spaceId={id} first={i === 0} offset={offsetOf(id)} lifted={dragging === id} controller={controller} />
      ))}
    </Box>
  );
}

type DragController = { start(id: string): void; move(dy: number): void; end(commit: boolean): void };

function SpaceRow({
  spaceId,
  first,
  offset,
  lifted,
  controller,
}: {
  spaceId: string;
  first: boolean;
  offset: Animated.Value;
  lifted: boolean;
  controller: DragController;
}) {
  const theme = useTheme();
  const space = useSpace(spaceId, (p) => p);
  const isDefault = useSettings((s) => s.defaultSpaceId === spaceId);
  const profile = useProfile(space?.profileId ?? "");
  const { hovered, hoverProps } = useHover();
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 3,
      onPanResponderGrant: () => controller.start(spaceId),
      onPanResponderMove: (_, g) => controller.move(g.dy),
      onPanResponderRelease: () => controller.end(true),
      onPanResponderTerminate: () => controller.end(false),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;
  if (!space) return null;

  const description = [isDefault ? "Default" : null, profile ? `Profile: ${profile.name}` : null].filter(Boolean).join(" · ");
  const openMenu = async () => {
    const choice = await chooseFromMenu([
      { id: "details", title: "Show Space Details" },
      { id: "icon", title: "Icon", children: iconMenuItems(space.icon) },
      { id: "default", title: "Make Default Space", enabled: !isDefault },
      { separator: true },
      { id: "delete", title: "Delete Space…" },
    ]);
    if (choice && typeof choice === "object") updateSpace(spaceId, { icon: choice.icon });
    else if (choice === "details") goToSettingsPane("spaces", spaceId);
    else if (choice === "default") setDefaultSpace(spaceId);
    else if (choice === "delete") void deleteSpace(spaceId);
  };

  return (
    <Animated.View
      {...pan.panHandlers}
      style={{
        zIndex: lifted ? 1 : 0,
        transform: [{ translateY: offset }],
        borderRadius: lifted ? 8 : 0,
        backgroundColor: lifted ? hex(theme.panel) : undefined,
        borderWidth: lifted ? StyleSheet.hairlineWidth * 2 : 0,
        borderColor: theme.groupBorder,
      }}
    >
      {!first && !lifted && <View style={{ height: StyleSheet.hairlineWidth * 2, marginHorizontal: 12, backgroundColor: theme.divider }} />}
      <ContextMenuArea onContextMenu={() => void openMenu()}>
        <View {...hoverProps}>
          <Pressable onPress={() => goToSettingsPane("spaces", spaceId)}>
            <View
              style={{
                height: ROW_HEIGHT - (first ? 0 : StyleSheet.hairlineWidth * 2),
                paddingLeft: 8,
                paddingRight: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                backgroundColor: hovered && !lifted ? theme.rowHover : undefined,
              }}
            >
              <View tooltip="Drag to reorder">
                <Symbol name="line.3.horizontal" size={11} color={theme.textTertiary} style={{ width: 14, height: 14 }} />
              </View>
              <SpaceBadge profile={space} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...font.body, color: theme.textPrimary }}>{space.name}</Text>
                {description ? <Text style={{ ...font.footnote, marginTop: 2, color: theme.textSecondary }}>{description}</Text> : null}
              </View>
              <Button variant="icon" icon="trash" tooltip="Delete Space…" onPress={() => void deleteSpace(spaceId)} />
              <Symbol name="chevron.right" size={11} weight="semibold" color={theme.textTertiary} style={{ width: 12, height: 14 }} />
            </View>
          </Pressable>
        </View>
      </ContextMenuArea>
    </Animated.View>
  );
}

function iconTitle(icon: string | null): string {
  const symbol = spaceSymbol(icon);
  if (symbol) return PROFILE_SYMBOLS.find((s) => s.name === symbol)?.title ?? "Symbol";
  return icon ?? "Initial";
}

export function SpaceDetailsPane({ spaceId }: { spaceId: string }) {
  const workspace = useSpace(spaceId, (p) => p);
  const profiles = useProfiles();
  const isDefault = useSettings((s) => s.defaultSpaceId === spaceId);
  const only = useSpaceOrder((order) => order.length <= 1);
  const [name, setName] = useState(workspace?.name ?? "");
  if (!workspace) return null;
  const commitName = () => name.trim() ? updateSpace(spaceId, { name: name.trim() }) : setName(workspace.name);
  const pickIcon = async () => {
    const choice = await chooseFromMenu(iconMenuItems(workspace.icon));
    if (choice && typeof choice === "object") updateSpace(spaceId, { icon: choice.icon });
  };
  const assign = async (profileId: string) => {
    if (profileId === workspace.profileId) return;
    const target = profiles.find((p) => p.id === profileId);
    if (!target) return;
    const { confirmed } = await confirm({ title: "Change This Space's Profile?", message: `Pages in ${workspace.name} will reload using ${target.name}'s logins and browsing data. Unsaved form changes may be lost. Saved rows, folders and the theme stay.`, confirmTitle: "Change Profile" });
    if (confirmed) { assignSpaceProfile(spaceId, profileId); keepSpaceProfile(spaceId); }
  };
  return <Box gap="l">
    <SectionHeader title="Space" />
    <Group>
      <Row title="Name"><TextField value={name} onChangeText={setName} onSubmit={commitName} onBlur={commitName} style={{ width: 220 }} /></Row>
      <Row title="Icon"><Button title="Change…" onPress={() => void pickIcon()} /></Row>
      <Row title="Profile" description="Spaces using this profile share logins, extensions, history and Top Apps.">
        <PopUp value={workspace.profileId} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={(id) => void assign(id)} />
      </Row>
      <Row title="Default Space" description="Links from other apps and new windows open in this space.">
        <Button title={isDefault ? "Default" : "Make Default"} disabled={isDefault} onPress={() => setDefaultSpace(spaceId)} />
      </Row>
    </Group>
    <ThemeSection spaceId={spaceId} />
    <SectionHeader title="Delete Space" />
    <Group><Row title="Delete Space" description={only ? "Keep at least one space." : isDefault ? "Choose another default space first." : "Removes this space's tabs and folders. Its profile's browsing data and shared Top Apps stay."}>
      <Button title="Delete…" kind="destructive" onPress={() => void deleteSpace(spaceId).then((deleted) => { if (deleted) goToSettingsPane("spaces"); })} />
    </Row></Group>
  </Box>;
}
