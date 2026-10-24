import { Action, ActionPanel, closeMainWindow, Icon, Keyboard, List } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { focusProfile, newWindow, useProfiles } from "./ardia";

export default function Command() {
  const { isLoading, data, error, revalidate } = useProfiles();

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search profiles…">
      {error ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="Couldn't read Ardia's profiles"
          description="Is Ardia running, and may Raycast control it (System Settings › Privacy & Security › Automation)?"
        />
      ) : (
        <List.EmptyView icon={Icon.PersonCircle} title="No profiles" />
      )}
      {data?.map((profile) => (
        <List.Item
          key={profile.id}
          title={profile.name}
          icon={Icon.PersonCircle}
          accessories={[
            ...(profile.isCurrent ? [{ tag: "Current" }] : []),
            { text: `${profile.tabCount} ${profile.tabCount === 1 ? "tab" : "tabs"}` },
          ]}
          actions={
            <ActionPanel>
              <Action
                title="Switch to Profile"
                icon={Icon.ArrowRight}
                onAction={async () => {
                  try {
                    await closeMainWindow();
                    await focusProfile(profile);
                  } catch (e) {
                    await showFailureToast(e, { title: "Couldn't switch to the profile" });
                  }
                }}
              />
              <Action
                title="Open in New Window"
                icon={Icon.AppWindow}
                shortcut={{ modifiers: ["cmd"], key: "return" }}
                onAction={async () => {
                  try {
                    await closeMainWindow();
                    await newWindow({ profileId: profile.id });
                  } catch (e) {
                    await showFailureToast(e, { title: "Couldn't open a new window" });
                  }
                }}
              />
              <Action
                title="Reload Profiles"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={revalidate}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
