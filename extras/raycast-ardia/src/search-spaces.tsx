import { Action, ActionPanel, closeMainWindow, Icon, Keyboard, List } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { newWindow, showSpace, useSpaces } from "./ardia";

export default function Command() {
  const { isLoading, data, error, revalidate } = useSpaces();

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search spaces…">
      {error ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="Couldn't read Ardia's spaces"
          description="Is Ardia running, and may Raycast control it (System Settings › Privacy & Security › Automation)?"
        />
      ) : (
        <List.EmptyView icon={Icon.PersonCircle} title="No spaces" />
      )}
      {data?.map((space) => (
        <List.Item
          key={space.id}
          title={space.name}
          icon={Icon.PersonCircle}
          accessories={[
            ...(space.isCurrent ? [{ tag: "Current" }] : []),
            { text: `${space.tabCount} ${space.tabCount === 1 ? "tab" : "tabs"}` },
          ]}
          actions={
            <ActionPanel>
              <Action
                title="Switch to Space"
                icon={Icon.ArrowRight}
                onAction={() => void run(() => showSpace(space), "Couldn't switch to the space")}
              />
              <Action
                title="Open in New Window"
                icon={Icon.AppWindow}
                shortcut={{ modifiers: ["cmd"], key: "return" }}
                onAction={() => void run(() => newWindow({ spaceId: space.id }), "Couldn't open a new window")}
              />
              <Action
                title="Reload Spaces"
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

async function run(action: () => Promise<void>, failure: string) {
  try {
    await closeMainWindow();
    await action();
  } catch (e) {
    await showFailureToast(e, { title: failure });
  }
}
