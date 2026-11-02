import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useWindowId } from "../../state/browser/hooks";
import { currentProfiles } from "../../state/browser/current";
import { useProfileOrder, useProfileRecords, useCreateProfileShareDefault } from "../../state/profiles/hooks";
import { createProfile } from "../../state/profiles/actions";
import { endCreateProfileRequest, profileNames, takeCreateProfileSheet, useCreateProfileRequest, type CreateProfilePreset } from "../../state/profiles/createProfileRequest";
import { dataGroups, unusedProfileColor } from "../../state/profiles/profiles";
import type { ProfileColor } from "../../state/browser/types";
import { Box, Button, DialogActions, DialogTitle, Divider, Dot, Group, PROFILE_COLORS, radius, Radio, Row, Sheet, Text, TextField, Toggle, useTheme } from "../ui";
import { profileColors, SHARE_ROW_HEIGHT } from "./tokens";
import { ThemeSwatches } from "../settings/ThemeEditor";
import { closeSettingsSheet, showSettingsSheet } from "../../state/settings/sheet";

useCreateProfileRequest.subscribe((s, prev) => {
  if (!s.sheet || s.sheet === prev.sheet) return;
  const request = takeCreateProfileSheet();
  if (!request) return;
  const done = (id: string | null) => {
    closeSettingsSheet();
    request.resolve(id);
  };
  showSettingsSheet(<CreateProfileSheet windowId={null} preset={request.preset} onDone={done} />);
});

export function CreateProfileHost() {
  const windowId = useWindowId();
  const request = useCreateProfileRequest((r) => (r.request?.windowId === windowId ? r.request : null));
  if (!request) return null;
  const done = (id: string | null) => endCreateProfileRequest(request, id);
  return <CreateProfileSheet windowId={windowId} preset={request.preset} onDone={done} />;
}

function CreateProfileSheet({ windowId, preset, onDone }: { windowId: string | null; preset: CreateProfilePreset; onDone: (id: string | null) => void }) {
  const theme = useTheme();
  const profiles = useProfileRecords();
  const profileOrder = useProfileOrder();
  const groups = useMemo(() => dataGroups({ profiles, profileOrder }), [profiles, profileOrder]);
  const current = useCreateProfileShareDefault(windowId);
  const [name, setName] = useState(preset.name ?? "");
  const [color, setColor] = useState<ProfileColor>(() => unusedProfileColor(currentProfiles()));
  const [share, setShare] = useState(!!preset.shareWith);
  const [shareWith, setShareWith] = useState(preset.shareWith ?? current);
  const selectedGroup = groups.find((g) => g.profileIds.includes(shareWith)) ?? groups[0];

  const submit = () => {
    const id = createProfile({ name, color, shareWith: share ? (selectedGroup?.profileIds[0] ?? null) : null });
    onDone(id);
  };
  const single = groups.length === 1;

  return (
    <Sheet size="s" onClose={() => onDone(null)}>
      <Box gap="xl">
        <DialogTitle subtitle="Profiles separate your logins, cookies, passwords, extensions, history and bookmarks.">Create a Profile</DialogTitle>
        <Box gap="l">
          <TextField value={name} onChangeText={setName} placeholder="Profile name" autoFocus onSubmit={submit} onEscape={() => onDone(null)} />
          <ThemeSwatches color={color} onPreset={setColor} />
        </Box>
        <Group>
          <Row
            title={single ? "Share data with current profile" : "Share data with another profile"}
            description={
              share
                ? single
                  ? "This profile will share your cookies, logins, passwords, extensions, bookmarks and history with your current profile. Tabs stay separate."
                  : "This profile will share your cookies, logins, passwords, extensions, bookmarks and history with another profile you choose. Tabs stay separate."
                : undefined
            }
          >
            <Toggle value={share} onChange={setShare} />
          </Row>
          {share && !single && (
            <Box pad="l">
              <View style={{ borderRadius: radius.tile, backgroundColor: theme.field, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: theme.fieldBorder, overflow: "hidden" }}>
                {groups.map((g, i) => (
                  <Pressable key={g.dataId} onPress={() => setShareWith(g.profileIds[0]!)}>
                    {i ? <Divider thick /> : null}
                    <Box row gap="ml" padX="ml" style={SHARE_ROW}>
                      <Radio on={g === selectedGroup} look="compact" />
                      <ColorStack colors={g.profileIds.map((id) => PROFILE_COLORS[profiles[id]!.color]?.swatch ?? profileColors.unknownSwatch)} />
                      <Text numberOfLines={1} style={FLEX}>
                        {profileNames(g.profileIds.map((id) => profiles[id]!.name))}
                      </Text>
                    </Box>
                  </Pressable>
                ))}
              </View>
            </Box>
          )}
        </Group>
      </Box>
      <DialogActions>
        <Button title="Cancel" onPress={() => onDone(null)} />
        <Button title="Create Profile" kind="primary" onPress={submit} />
      </DialogActions>
    </Sheet>
  );
}

const FLEX = { flex: 1 } as const;
const SHARE_ROW = { height: SHARE_ROW_HEIGHT, alignItems: "center" } as const;

export function ColorStack({ colors: swatches, size = 12 }: { colors: string[]; size?: number }) {
  const theme = useTheme();
  const shown = swatches.slice(0, 4);
  return (
    <View style={{ flexDirection: "row", width: size + (shown.length - 1) * (size * 0.6) }}>
      {shown.map((c, i) => (
        <Dot key={i} size={size} color={c} ring={theme.dark ? profileColors.stackRing.dark : profileColors.stackRing.light} style={{ marginLeft: i ? -size * 0.4 : 0 }} />
      ))}
    </View>
  );
}
