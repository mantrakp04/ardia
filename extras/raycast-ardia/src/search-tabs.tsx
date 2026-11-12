import { Action, ActionPanel, closeMainWindow, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { getFavicon, showFailureToast } from "@raycast/utils";
import { useState } from "react";
import { closeTab, focusTab, useProfiles, useTabs, type Tab } from "./ardia";
import { hostOf, tabSections } from "./scripts";

const ALL_PROFILES = "all";

export default function Command() {
  const { isLoading, data, error, revalidate, mutate } = useTabs();
  const { data: profiles = [] } = useProfiles();
  const [profileFilter, setProfileFilter] = useState(ALL_PROFILES);
  const windowCount = new Set(data?.filter((tab) => tab.windowId).map((tab) => tab.windowId)).size;
  const sections = tabSections(data ?? [], profiles, profileFilter === ALL_PROFILES ? undefined : profileFilter);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search tabs…"
      searchBarAccessory={
        profiles.length > 1 ? (
          <List.Dropdown tooltip="Filter by Profile" storeValue defaultValue={ALL_PROFILES} onChange={setProfileFilter}>
            <List.Dropdown.Section>
              <List.Dropdown.Item title="All Profiles" value={ALL_PROFILES} icon={Icon.AppWindowGrid2x2} />
            </List.Dropdown.Section>
            <List.Dropdown.Section>
              {profiles.map((profile) => (
                <List.Dropdown.Item key={profile.id} title={profile.name} value={profile.id} icon={Icon.PersonCircle} />
              ))}
            </List.Dropdown.Section>
          </List.Dropdown>
        ) : undefined
      }
    >
      {error ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="Couldn't read Ardia's tabs"
          description="Is Ardia running, and may Raycast control it (System Settings › Privacy & Security › Automation)?"
        />
      ) : (
        <List.EmptyView icon={Icon.AppWindowList} title="No open tabs" />
      )}
      {sections.map((section) => (
        <List.Section key={section.id} title={section.title}>
          {section.tabs.map((tab) => (
            <List.Item
              key={`${tab.windowId}-${tab.tabId}`}
              title={tab.title || (tab.url ? hostOf(tab.url) : "New Tab")}
              subtitle={tab.url ? hostOf(tab.url) : undefined}
              keywords={tab.url ? [tab.url] : undefined}
              icon={tab.url ? getFavicon(tab.url, { fallback: Icon.Globe }) : Icon.Plus}
              accessories={[
                ...(tab.isPinned ? [{ icon: Icon.Pin, tooltip: "Pinned" }] : []),
                ...(tab.isFocused && tab.windowIndex === 1 ? [{ tag: "Current" }] : []),
                ...(windowCount > 1 && tab.windowIndex > 0 ? [{ text: `Window ${tab.windowIndex}` }] : []),
              ]}
              actions={
                <ActionPanel>
                  <Action
                    title="Switch to Tab"
                    icon={Icon.ArrowRight}
                    onAction={async () => {
                      try {
                        await closeMainWindow();
                        await focusTab(tab);
                      } catch (e) {
                        await showFailureToast(e, { title: "Couldn't switch to the tab" });
                      }
                    }}
                  />
                  {tab.url && (
                    <Action.CopyToClipboard
                      title="Copy URL"
                      content={tab.url}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                  )}
                  <Action
                    title="Close Tab"
                    icon={Icon.XMarkCircle}
                    style={Action.Style.Destructive}
                    shortcut={{ modifiers: ["ctrl"], key: "x" }}
                    onAction={() => void close(tab)}
                  />
                  <Action
                    title="Reload Tabs"
                    icon={Icon.ArrowClockwise}
                    shortcut={Keyboard.Shortcut.Common.Refresh}
                    onAction={revalidate}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );

  async function close(tab: Tab) {
    try {
      await mutate(closeTab(tab), {
        optimisticUpdate: (tabs) => tabs?.filter((t) => !(t.windowId === tab.windowId && t.tabId === tab.tabId)),
      });
      await showToast({ style: Toast.Style.Success, title: "Closed tab" });
    } catch (e) {
      await showFailureToast(e, { title: "Couldn't close the tab" });
    }
  }
}
