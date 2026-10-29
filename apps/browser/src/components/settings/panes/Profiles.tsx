import { chooseFromMenu } from "../../../state/app/menuChoice";
import { useState } from "react";
import { showMenu } from "../../../state/app/system";
import { requestDeleteProfile, updateProfile } from "../../../state/profiles/actions";
import { useProfile, useProfilePrivateWindows, useProfileSpaces, useProfiles } from "../../../state/profiles/hooks";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { goToSettingsPane } from "../../../state/settings/settingsWindows";
import { Button, Box, ContextMenuArea, Text, TextField } from "../../ui";
import { ClearDataDialog } from "../../pages/ClearDataDialog";
import { iconMenuItems } from "../../spaces/SpaceIcons";
import { createProfileInSettings } from "../ProfileForm";
import { Group, Row, SectionHeader } from "../Form";

export function ProfilesPane() {
  const profiles = useProfiles();
  const menu = async (id: string) => {
    const choice = await showMenu([{ id: "edit", title: "Edit Profile…" }, { id: "delete", title: "Delete Profile…" }]);
    if (choice === "delete") void requestDeleteProfile(id);
    else if (choice === "edit") goToSettingsPane("profiles", id);
  };
  return <Box gap="l">
    <Text tone="textSecondary">Profiles hold your logins, history, bookmarks, extensions and Top Apps. Several spaces can use one profile.</Text>
    <SectionHeader title="Profiles" anchor="profiles.list" action={<Button title="Create Profile" icon="plus" onPress={() => createProfileInSettings((id) => goToSettingsPane("profiles", id))} />} />
    <Group>{profiles.map((profile) => <ContextMenuArea key={profile.id} onContextMenu={() => void menu(profile.id)}><Row title={profile.name}>
      <Button title="Edit…" onPress={() => goToSettingsPane("profiles", profile.id)} />
      <Button variant="icon" icon="trash" tooltip="Delete Profile…" onPress={() => void requestDeleteProfile(profile.id)} />
    </Row></ContextMenuArea>)}</Group>
  </Box>;
}

export function ProfileDetailsPane({ profileId }: { profileId: string }) {
  const profile = useProfile(profileId);
  const spaces = useProfileSpaces(profileId);
  const privateWindows = useProfilePrivateWindows(profileId);
  const profiles = useProfiles();
  const [name, setName] = useState(profile?.name ?? "");
  if (!profile) return null;
  const commit = () => name.trim() ? updateProfile(profileId, { name: name.trim() }) : setName(profile.name);
  const remove = async () => {
    if (await requestDeleteProfile(profileId)) goToSettingsPane("profiles");
  };
  const icon = async () => {
    const choice = await chooseFromMenu(iconMenuItems(profile.icon));
    if (choice && typeof choice === "object") updateProfile(profileId, { icon: choice.icon });
  };
  return <Box gap="l">
    <SectionHeader title="Profile" />
    <Group>
      <Row title="Name"><TextField value={name} onChangeText={setName} onBlur={commit} onSubmit={commit} style={{ width: 220 }} /></Row>
      <Row title="Icon" description={profile.icon ?? "Initial"}><Button title="Change…" onPress={() => void icon()} /></Row>
      <Row title="Assigned spaces" description={`${spaces.length} ${spaces.length === 1 ? "space uses" : "spaces use"} this profile.`} />
    </Group>
    <SectionHeader title="Browsing data" />
    <Group>
      <Row title="Clear Browsing Data" description="Affects every space using this profile. Saved sidebar rows and folders stay.">
        <Button title="Clear…" onPress={() => showSettingsSheet(<ClearDataDialog profileId={profileId} onClose={closeSettingsSheet} />)} />
      </Row>
      <Row title="Delete Profile" description={spaces.length ? "Assign its spaces to another profile first." : privateWindows ? "Close this profile’s private windows first." : profiles.length <= 1 ? "Keep at least one profile." : "Deletes its browsing data on this Mac."}>
        <Button title="Delete…" kind="destructive" onPress={() => void remove()} />
      </Row>
    </Group>
  </Box>;
}
