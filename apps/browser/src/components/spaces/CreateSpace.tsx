import { useState } from "react";
import { Pressable, View } from "react-native";
import { currentSpaces } from "../../state/browser/current";
import { useCreateSpaceShareDefault } from "../../state/spaces/hooks";
import { useProfiles } from "../../state/profiles/hooks";
import { addSpace } from "../../state/spaces/actions";
import { spaceNames, takeCreateSpaceSheet, useCreateSpaceRequest, type CreateSpacePreset } from "../../state/spaces/createSpaceRequest";
import { unusedSpaceColor } from "../../state/spaces/spaces";
import type { ProfileColor } from "../../state/browser/types";
import { Box, Button, PROFILE_COLORS, PopUp, Sheet, space, Swatch, swatch, Text, TextField, useTheme } from "../ui";
import { spaceColors } from "./tokens";
import { closeSettingsSheet, showSettingsSheet } from "../../state/settings/sheet";

useCreateSpaceRequest.subscribe((s, prev) => {
  if (!s.sheet || s.sheet === prev.sheet) return;
  const request = takeCreateSpaceSheet();
  if (!request) return;
  showSettingsSheet(<CreateSpaceSheet preset={request.preset} onDone={(id) => { closeSettingsSheet(); request.resolve(id); }} />);
});

export function CreateSpaceHost() { return null; }

function CreateSpaceSheet({ preset, onDone }: { preset: CreateSpacePreset; onDone: (id: string | null) => void }) {
  const profiles = useProfiles();
  const current = useCreateSpaceShareDefault(null);
  const [name, setName] = useState(preset.name ?? "");
  const [color, setColor] = useState<ProfileColor>(() => unusedSpaceColor(currentSpaces()));
  const [profileId, setProfileId] = useState(preset.profileId ?? currentSpaces()[current]?.profileId ?? profiles[0]?.id ?? "default");
  const submit = () => { if (name.trim()) onDone(addSpace({ name, color, profileId })); };
  return <Sheet width={420} onClose={() => onDone(null)}>
    <Box gap="l">
      <Text size="heading" weight="semibold">Create Space</Text>
      <Text tone="textSecondary">A space keeps its own tabs, saved rows, folders and theme.</Text>
      <TextField value={name} onChangeText={setName} placeholder="Space name" autoFocus onSubmit={submit} onEscape={() => onDone(null)} />
      <Box row gap="m" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <Text>Profile</Text><PopUp value={profileId} options={profiles.map((p) => ({ value: p.id, title: p.name }))} onChange={setProfileId} />
      </Box>
      <Text size="footnote" tone="textSecondary">Spaces using the same profile share logins, extensions, history and Top Apps.</Text>
      <View style={{ flexDirection: "row", gap: swatch.gap }}>{(Object.keys(PROFILE_COLORS) as ProfileColor[]).map((c) => <ColorSwatch key={c} color={c} selected={color === c} onPress={() => setColor(c)} />)}</View>
      <Box row gap="m" style={{ justifyContent: "flex-end" }}>
        <Button title="Cancel" onPress={() => onDone(null)} />
        <Button title="Create Space" kind="primary" disabled={!name.trim()} onPress={submit} />
      </Box>
    </Box>
  </Sheet>;
}

export function ColorStack({ colors: swatches, size = 12 }: { colors: string[]; size?: number }) {
  const theme = useTheme();
  const shown = swatches.slice(0, 4);
  return (
    <View style={{ flexDirection: "row", width: size + (shown.length - 1) * (size * 0.6) }}>
      {shown.map((c, i) => (
        <View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            marginLeft: i ? -size * 0.4 : 0,
            backgroundColor: c,
            borderWidth: 1,
            borderColor: theme.dark ? spaceColors.stackRing.dark : spaceColors.stackRing.light,
          }}
        />
      ))}
    </View>
  );
}

function ColorSwatch({ color, selected, onPress }: { color: ProfileColor; selected: boolean; onPress: () => void }) {
  const spec = PROFILE_COLORS[color];
  return (
    <Pressable onPress={onPress} tooltip={spec.name}>
      <Swatch selected={selected} ring={spec.swatch} fill={spec.swatch} />
    </Pressable>
  );
}
