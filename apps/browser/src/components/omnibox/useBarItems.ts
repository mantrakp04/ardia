import type { SearchScope } from "@ardia/core";
import { useMemo, type RefObject } from "react";
import type { TextInput } from "react-native";
import { offeredScope } from "../../state/omnibox/scopes";
import { useDropdownStart, useOpenTabsStart } from "./dropdownStart";
import { useInlineCompletion } from "./useInlineCompletion";
import { useSuggestions } from "./useSuggestions";

export function useBarItems({
  input,
  typed,
  edited,
  scope,
  suppressCompletion,
  selected,
  dropdown,
  opensTab,
  windowId,
  profileId,
  tabId,
  currentUrl,
}: {
  input: RefObject<TextInput | null>;
  typed: string;
  edited: boolean;
  scope: SearchScope | null;
  suppressCompletion: boolean;
  selected: number;
  dropdown: boolean;
  opensTab: boolean;
  windowId: string;
  profileId: string;
  tabId: string;
  currentUrl: string;
}) {
  const { items: suggested, completion } = useSuggestions({
    text: typed,
    active: edited || !!scope,
    windowId,
    profileId,
    currentTabId: tabId,
    currentUrl: currentUrl || undefined,
    scope,
    preventInline: suppressCompletion,
  });
  const start = useDropdownStart(dropdown && !edited && !scope, tabId, profileId);
  const idle = opensTab && !scope && !typed.trim();
  const openTabs = useOpenTabsStart(idle, windowId, profileId);
  const items = dropdown && !edited && !scope ? start : idle ? openTabs : suggested;
  const inline = useInlineCompletion(input, typed, suppressCompletion || scope ? "" : completion);
  const shownCompletion = inline.shown;
  const value = typed + shownCompletion;
  const selectedIndex = selected < 0 && idle ? -1 : Math.min(Math.max(selected, 0), items.length - 1);
  const current = items[selectedIndex];
  const tabScope = useMemo(
    () => (!scope && edited ? offeredScope(typed, shownCompletion, windowId) : null),
    [scope, edited, typed, shownCompletion, windowId],
  );
  return { items, completion, inline, shownCompletion, value, selectedIndex, current, tabScope };
}
