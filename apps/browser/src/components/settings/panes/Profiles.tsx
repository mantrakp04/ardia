import { Box, Button, ContextMenuArea, Divider, PopUp, radius, space, Symbol, Text, TextField, Toggle, useHover } from "../../ui";
import { hapticTick } from "../../../state/app/system";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { deleteProfile } from "../../../state/browser/actions";
import { requestCreateProfile } from "../../../state/profiles/createProfileRequest";
import { hex, profileAccent, useTheme } from "../../ui/theme";
import { useProfileDataStats, useProfileOrder, useProfileRecords } from "../../../state/profiles/hooks";
import { currentProfileOrder, currentProfiles } from "../../../state/browser/current";
import { commitProfileName, reorderProfiles, setDefaultProfile } from "../../../state/profiles/actions";
import { openProfileIconPicker } from "../../../state/profiles/iconPicker";
import { updateSettings } from "../../../state/settings/actions";
import { useProfile, useProfiles, useSettings } from "../../../state/browser/hooks";
import { sharingProfiles } from "../../../state/profiles/profiles";
import { ClearDataDialog } from "../../pages/ClearDataDialog";
import { Group, PaneIntro, Row, SectionHeader } from "../Form";
import { ColorStack } from "../../profiles/CreateProfile";
import { PROFILE_SYMBOLS, ProfileBadge } from "../../profiles/ProfileIcons";
import { iconSymbol } from "../../../lib/customIcon";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { ThemeSection } from "../ThemeEditor";
import { goToSettingsPane, SETTINGS_WINDOW_ID } from "../../../state/settings/settingsWindows";
import { openProfileItemMenu } from "../../profiles/profileMenu";
import { curve } from "../../ui/motion";
import { settingsMotion } from "../tokens";

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
  const profiles = useProfiles();
  const defaultId = useSettings((s) => s.defaultProfileId);
  const switcherIcons = useSettings((s) => s.profileSwitcherIcons);

  return (
    <View>
      <PaneIntro>
        Profiles keep your browsing organized. Each keeps its own history, logins, cookies, and extensions, unless you turn on Share data
        when you create it: then it uses another profile's, and only the tabs are its own.
      </PaneIntro>

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

      <SectionHeader title="Profile switcher" />
      <Group>
        <Row anchor="profiles.switcherIcons">
          <Toggle value={switcherIcons} onChange={(profileSwitcherIcons) => updateSettings({ profileSwitcherIcons })} />
        </Row>
      </Group>

      <SectionHeader
        anchor="profiles.list"
        action={<Button title="Create Profile" icon="plus" onPress={() => void requestCreateProfile()} />}
      />
      <ProfileList />
    </View>
  );
}

const ROW_HEIGHT = 46;
const settle = (value: Animated.Value, toValue: number) =>
  Animated.timing(value, { toValue, duration: settingsMotion.profileRowSettle, easing: curve.enter, useNativeDriver: true });

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
    <Box fill="groupFill" border="groupBorder" radius="panel">
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
  const badge = useRef<View>(null);
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
  const openMenu = () => openProfileItemMenu(profileId, "settings", SETTINGS_WINDOW_ID, badge.current);

  return (
    <Animated.View
      {...pan.panHandlers}
      style={{
        zIndex: lifted ? 1 : 0,
        transform: [{ translateY: offset }],
        borderRadius: lifted ? radius.tile : 0,
        backgroundColor: lifted ? hex(theme.panel) : undefined,
        borderWidth: lifted ? StyleSheet.hairlineWidth * 2 : 0,
        borderColor: theme.groupBorder,
      }}
    >
      {!first && !lifted && <Divider inset="l" thick />}
      <ContextMenuArea onContextMenu={() => void openMenu()}>
        <View {...hoverProps}>
          <Pressable onPress={() => goToSettingsPane("profiles", profileId)}>
            <View
              style={{
                height: ROW_HEIGHT - (first ? 0 : StyleSheet.hairlineWidth * 2),
                paddingLeft: space.m,
                paddingRight: space.l,
                flexDirection: "row",
                alignItems: "center",
                gap: space.ml,
                backgroundColor: hovered && !lifted ? theme.rowHover : undefined,
              }}
            >
              <View tooltip="Drag to reorder">
                <Symbol name="line.3.horizontal" size={11} color={theme.textTertiary} style={{ width: 14, height: 14 }} />
              </View>
              <View ref={badge} collapsable={false}>
                <ProfileBadge profile={profile} />
              </View>
              <View style={{ flex: 1 }}>
                <Text>{profile.name}</Text>
                {description ? (
                  <Text size="caption" tone="textSecondary" style={DESCRIPTION}>
                    {description}
                  </Text>
                ) : null}
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
  const symbol = iconSymbol(icon);
  if (symbol) return PROFILE_SYMBOLS.find((s) => s.name === symbol)?.title ?? "Symbol";
  return icon ?? "Initial";
}

export function ProfileDetailsPane({ profileId }: { profileId: string }) {
  const profile = useProfile(profileId, (p) => p);
  const isDefault = useSettings((s) => s.defaultProfileId === profileId);
  const only = useProfileOrder((o) => o.length <= 1);
  const shared = useSharedWith(profileId);
  const sharedNames = useProfileRecords(useShallow((profiles) => shared.map((id) => profiles[id]?.name ?? "")));
  const sharedColors = useProfileRecords(useShallow((profiles) => shared.map((id) => profileAccent(profiles[id]))));
  const stats = useProfileDataStats(profileId);
  const savedName = profile?.name ?? "";
  const [name, setName] = useState(savedName);
  const typed = useRef(name);
  typed.current = name;
  const edited = useRef(false);
  useEffect(() => {
    if (!edited.current) setName(savedName);
  }, [savedName]);
  useEffect(
    () => () => {
      if (edited.current) commitProfileName(profileId, typed.current);
    },
    [profileId],
  );
  const badge = useRef<View>(null);
  const changeButton = useRef<View>(null);
  if (!profile) return null;
  const editName = (text: string) => {
    edited.current = true;
    setName(text);
  };
  const commitName = () => {
    edited.current = false;
    setName(commitProfileName(profileId, name) ? name.trim() : profile.name);
  };
  const sharing = shared.length > 1;
  const pickIcon = (anchor: View | null) => void openProfileIconPicker(profileId, SETTINGS_WINDOW_ID, "settings", anchor);

  return (
    <View>
      <Box gap="ml" style={DETAILS_HEAD}>
        <Pressable onPress={() => pickIcon(badge.current)} tooltip="Change Icon">
          <View ref={badge} collapsable={false}>
            <ProfileBadge profile={profile} size={64} />
          </View>
        </Pressable>
        <Text size="small" tone="textSecondary">
          {stats}
        </Text>
      </Box>

      <SectionHeader title="Profile" />
      <Group>
        <Row title="Name">
          <TextField value={name} onChangeText={editName} onSubmit={commitName} onBlur={commitName} width={220} />
        </Row>
        <Row title="Icon" description={iconTitle(profile.icon)}>
          <View ref={changeButton} collapsable={false}>
            <Button title="Change…" onPress={() => pickIcon(changeButton.current)} />
          </View>
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

const DESCRIPTION = { marginTop: space.xxs } as const;
const DETAILS_HEAD = { alignItems: "center", marginTop: space.xxxl } as const;
