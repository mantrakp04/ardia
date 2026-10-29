import { useState } from "react";
import { createProfile } from "../../state/profiles/actions";
import { closeSettingsSheet, showSettingsSheet } from "../../state/settings/sheet";
import { Box, Button, Sheet, Text, TextField } from "../ui";

export function createProfileInSettings(onCreated?: (id: string) => void) {
  showSettingsSheet(<ProfileForm onDone={(id) => { closeSettingsSheet(); if (id) onCreated?.(id); }} />);
}

function ProfileForm({ onDone }: { onDone: (id: string | null) => void }) {
  const [name, setName] = useState("");
  const submit = () => { if (name.trim()) onDone(createProfile({ name })); };
  return <Sheet width={360} onClose={() => onDone(null)}>
    <Box gap="l">
      <Text size="heading" weight="semibold">Create Profile</Text>
      <Text tone="textSecondary">A profile keeps its own logins, history, bookmarks, extensions and Top Apps. Assign it to spaces in Settings.</Text>
      <TextField value={name} onChangeText={setName} placeholder="Profile name" autoFocus onSubmit={submit} />
      <Box row gap="m" style={{ justifyContent: "flex-end" }}>
        <Button title="Cancel" onPress={() => onDone(null)} />
        <Button title="Create Profile" kind="primary" disabled={!name.trim()} onPress={submit} />
      </Box>
    </Box>
  </Sheet>;
}
