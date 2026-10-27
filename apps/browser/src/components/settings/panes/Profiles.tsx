import { ContextMenuArea, Symbol, Box, Button, font, PopUp, TextField, useHover } from "../../ui";
import { hapticTick, showMenu } from "../../../state/app/system";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { createProfile, deleteProfile } from "../../../state/browser/actions";
import { hex, profileAccent, useTheme } from "../../ui/theme";
import { useProfileDataStats, useProfileOrder, useProfileRecords } from "../../../state/profiles/hooks";
import { currentProfileOrder, currentProfiles } from "../../../state/browser/current";
import { reorderProfiles, setDefaultProfile, updateProfile } from "../../../state/profiles/actions";
import { useProfile, useProfiles, useSettings } from "../../../state/browser/hooks";
import { sharingProfiles } from "../../../state/profiles/profiles";
import type { Profile } from "../../../state/browser/types";
import { ClearDataDialog } from "../../pages/ClearDataDialog";
import { Group, Row, SectionHeader } from "../Form";
import { ColorStack } from "../../profiles/CreateProfile";
import { iconMenuItems, PROFILE_SYMBOLS, ProfileBadge, profileSymbol } from "../../profiles/ProfileIcons";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { ThemeSection } from "../ThemeEditor";
import { goToSettingsPane } from "../../../state/settings/settingsWindows";
import { curve } from "../../ui/motion";
import { settingsType, settingsMotion } from "../tokens";

const listOf = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`);

function useSharedWith(profileId: string): string[] {
  const order = useProfileOrder();
  const profiles = useProfileRecords();
  return useMemo(() => {
    const others = sharingProfiles({ profiles, profileOrder: order }, profileId);
    return others.length ? order.filter((id) => id === profileId || others.includes(id)) : [profileId];
  }, [order, profiles, profileId]);
}

export function ProfilesPane() {
  const theme = useTheme();
  const profiles = useProfiles();
  const defaultId = useSettings((s) => s.defaultProfileId);

  return (
    <View>
      <Text style={{ marginTop: 20, ...settingsType.lead, lineHeight: 17, color: theme.textSecondary }}>
        Profiles keep your browsing organized. Each keeps its own history, logins, cookies, and extensions, unless you turn on Share data
        when you create it: then it uses another profile's, and only the tabs are its own.
      </Text>

      <SectionHeader title="New windows open with" />
      <Group>
        <Row anchor="profiles.defaultProfile">
          <PopUp
            value={defaultId}
            options={profiles.map((p) => ({ value: p.id, title: p.name }))}
            onChange={(id) => setDefaultProfile(id)}
            minWidth={160}
          />
        </Row>
      </Group>

      <SectionHeader
        anchor="profiles.list"
        description="Drag to reorder. ⌃1–⌃9 switch to the first nine."
        action={<Button title="Create Profile" icon="plus" onPress={() => void createProfile()} />}
      />
      <ProfileList />
    </View>
  );
}

const ROW_HEIGHT = 46;
const settle = (value: Animated.Value, toValue: number) =>
  Animated.timing(value, { toValue, duration: settingsMotion.profileRowSettle, easing: curve.outCubic, useNativeDriver: true });

function ProfileList() {
  const order = useProfileOrder();
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
      const ids = currentProfileOrder();
      const from = ids.indexOf(id);
      drag.current = { id, from, to: from, reorderPending: false };
      setDragging(id);
    },
    move(dy: number) {
      const { id, from } = drag.current;
      const ids = currentProfileOrder();
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
      const ids = currentProfileOrder().filter((x) => x !== id);
      ids.splice(to, 0, id);
      drag.current.reorderPending = true;
      reorderProfiles(ids);
    },
  }).current;

  return (
    <Box fill="groupFill" border="groupBorder" radius="card">
      {order.map((id, i) => (
        <ProfileRow key={id} profileId={id} first={i === 0} offset={offsetOf(id)} lifted={dragging === id} controller={controller} />
      ))}
    </Box>
  );
}

type DragController = { start(id: string): void; move(dy: number): void; end(commit: boolean): void };

function ProfileRow({
  profileId,
  first,
  offset,
  lifted,
  controller,
}: {
  profileId: string;
  first: boolean;
  offset: Animated.Value;
  lifted: boolean;
  controller: DragController;
}) {
  const theme = useTheme();
  const profile = useProfile(profileId, (p) => p);
  const isDefault = useSettings((s) => s.defaultProfileId === profileId);
  const shared = useSharedWith(profileId);
  const names = useProfileRecords(useShallow((profiles) => shared.filter((id) => id !== profileId).map((id) => profiles[id]?.name ?? "")));
  const { hovered, hoverProps } = useHover();
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 3,
      onPanResponderGrant: () => controller.start(profileId),
      onPanResponderMove: (_, g) => controller.move(g.dy),
      onPanResponderRelease: () => controller.end(true),
      onPanResponderTerminate: () => controller.end(false),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;
  if (!profile) return null;

  const description = [isDefault ? "Default" : null, names.length ? `Shares data with ${listOf(names)}` : null].filter(Boolean).join(" · ");
  const openMenu = async () => {
    const choice = await showMenu([
      { id: "details", title: "Show Profile Details" },
      { id: "default", title: "Make Default Profile", enabled: !isDefault },
      { separator: true },
      { id: "delete", title: "Delete Profile…", enabled: currentProfileOrder().length > 1 },
    ]);
    if (choice === "details") goToSettingsPane("profiles", profileId);
    else if (choice === "default") setDefaultProfile(profileId);
    else if (choice === "delete") void deleteProfile(profileId);
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
          <Pressable onPress={() => goToSettingsPane("profiles", profileId)}>
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
              <ProfileBadge profile={profile} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...font.body, color: theme.textPrimary }}>{profile.name}</Text>
                {description ? <Text style={{ ...font.footnote, marginTop: 2, color: theme.textSecondary }}>{description}</Text> : null}
              </View>
              <Symbol name="chevron.right" size={11} weight="semibold" color={theme.textTertiary} style={{ width: 12, height: 14 }} />
            </View>
          </Pressable>
        </View>
      </ContextMenuArea>
    </Animated.View>
  );
}

function iconTitle(icon: string | null): string {
  const symbol = profileSymbol(icon);
  if (symbol) return PROFILE_SYMBOLS.find((s) => s.name === symbol)?.title ?? "Symbol";
  return icon ?? "Initial";
}

export function ProfileDetailsPane({ profileId }: { profileId: string }) {
  const theme = useTheme();
  const profile = useProfile(profileId, (p) => p);
  const isDefault = useSettings((s) => s.defaultProfileId === profileId);
  const only = useProfileOrder((o) => o.length <= 1);
  const shared = useSharedWith(profileId);
  const sharedNames = useProfileRecords(useShallow((profiles) => shared.map((id) => profiles[id]?.name ?? "")));
  const sharedColors = useProfileRecords(useShallow((profiles) => shared.map((id) => profileAccent(profiles[id]))));
  const stats = useProfileDataStats(profileId);
  const [name, setName] = useState(profile?.name ?? "");
  if (!profile) return null;
  const update = (patch: Partial<Pick<Profile, "name" | "color" | "icon">>) => updateProfile(profileId, patch);
  const commitName = () => (name.trim() ? update({ name: name.trim() }) : setName(profile.name));
  const sharing = shared.length > 1;

  const pickIcon = async () => {
    const choice = await showMenu(iconMenuItems(profile.icon));
    if (choice?.startsWith("icon:")) update({ icon: choice.slice("icon:".length) || null });
  };

  return (
    <View>
      <View style={{ alignItems: "center", marginTop: 24, gap: 10 }}>
        <Pressable onPress={() => void pickIcon()} tooltip="Change Icon">
          <ProfileBadge profile={profile} size={64} />
        </Pressable>
        <Text style={{ ...font.small, color: theme.textSecondary }}>{stats}</Text>
      </View>

      <SectionHeader title="Profile" />
      <Group>
        <Row title="Name">
          <TextField value={name} onChangeText={setName} onSubmit={commitName} onBlur={commitName} style={{ width: 220 }} />
        </Row>
        <Row title="Icon" description={iconTitle(profile.icon)}>
          <Button title="Change…" onPress={() => void pickIcon()} />
        </Row>
      </Group>

      <ThemeSection profileId={profileId} />

      <SectionHeader title="Data" />
      <Group>
        {sharing ? (
          <Row
            icon={<ColorStack colors={sharedColors} size={14} />}
            title="Shared data"
            description={`${listOf(sharedNames)} share Cookies, Passwords, Extensions, Bookmarks, and History. Each keeps its own tabs.`}
          />
        ) : null}
        <Row title="Make Default Profile" description={isDefault ? "New windows already open with this profile." : "Open new windows with this profile."}>
          <Button title="Make Default" disabled={isDefault} onPress={() => setDefaultProfile(profileId)} />
        </Row>
        <Row
          title="Clear Browsing Data"
          description={sharing ? "History, cookies, site data and cached files, for every profile that shares them." : "History, cookies, site data and cached files for this profile."}
        >
          <Button title="Clear…" onPress={() => showSettingsSheet(<ClearDataDialog profileId={profileId} onClose={closeSettingsSheet} />)} />
        </Row>
        <Row
          title="Delete Selected Profile"
          description={only ? "You can't delete your only profile." : sharing ? "Removes its tabs. The data it shares stays." : "Removes its tabs, history, bookmarks and site data."}
        >
          <Button
            title="Delete…"
            kind="destructive"
            disabled={only}
            onPress={() =>
              void deleteProfile(profileId).then(() => {
                if (!currentProfiles()[profileId]) goToSettingsPane("profiles");
              })
            }
          />
        </Row>
      </Group>
    </View>
  );
}
