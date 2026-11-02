import { displayUrl, asksForBackspace, keywordBySpace, resolveInput, searchUrl, scopedSearchUrl, type Suggestion } from "@ardia/core";
import { Symbol, useTheme } from "../ui";
import { copyText, pickFiles } from "../../state/app/system";
import { chooseFromMenu } from "../../state/app/menuChoice";
import { startDictation } from "../../state/omnibox/textInput";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { findNodeHandle, type TextInput, type View } from "react-native";
import { journeyBarCommitted, journeyBarFocused, journeyKeystroke, journeyNavigate, journeySuggestions } from "../../state/telemetry/journeys";
import { sampleOmniboxLatency, trackSuggestionChosen } from "../../state/telemetry/track";
import { useSettings, useTab, useWindow, useWindowId, useWindowProfileId } from "../../state/browser/hooks";
import { removeHistory } from "../../state/history/actions";
import { useWindowUiOf } from "../../state/windows/hooks";
import { defaultSearchEngine } from "../../state/settings/settings";
import { runBarAction, runBarExtension } from "../../state/omnibox/runBar";
import { createBangSubmitter, mayBeBang } from "../../state/omnibox/bangs";
import { traceOmnibox, useOmniboxDriver } from "./devDriver";
import { claimFocusTag, commandBarFocus, heroBarFocus } from "../../state/focus/focusClaims";
import { registerHeroBar, saveNtpQuery, type BarDismissal, type BarSnapshot } from "../../state/omnibox/barState";
import { openFromBar, otherOpenTabs, switchFromBar, type Disposition } from "../../state/omnibox/openFromBar";
import { openFromNewTabBar } from "../../state/omnibox/newTabBar";
import type { NewTabTarget } from "../../state/browser/types";
import { showFieldMenu } from "../../state/omnibox/paste";
import { SuggestionIcon, SuggestionList, isRemovable, type RowActions } from "./SuggestionRow";
import { keywordScope } from "../../state/omnibox/scopes";
import { setPopover } from "../../state/tabs/pageState";
import { AddChip } from "./AddChip";
import { INCOGNITO_ICON } from "../ntp/IncognitoHeading";
import { BarField } from "./BarField";
import { destinationLabel } from "./GoButton";
import { BottomRow, DropdownFrame, PanelFrame } from "./OmniboxFrame";
import { barKeyDown, barKeyDownEvents, type BarKeyEvent } from "./omniboxKeys";
import { ADD_CHIP, BAR } from "./tokens";
import { useBarItems } from "./useBarItems";
import { useBarText } from "./useBarText";

export { PANEL_TEXT_LEFT } from "./tokens";

type Variant = "panel" | "hero" | "sidebar";

export function Omnibox({
  variant,
  tabId,
  initialText = "",
  onCancel,
  onDone = onCancel,
  opensTab,
  floating = false,
  fieldRowHeight = BAR.panel.height,
}: {
  variant: Variant;
  floating?: boolean;
  fieldRowHeight?: number;
  tabId: string;
  initialText?: string;
  opensTab?: NewTabTarget;
  onCancel?(): void;
  onDone?(reason?: BarDismissal): void;
}) {
  const theme = useTheme();
  const windowId = useWindowId();
  const incognito = useWindow(windowId, (w) => w?.kind === "private");
  const profileId = useWindowProfileId();
  const engine = useSettings((st) => defaultSearchEngine(st));
  const currentUrl = useTab(tabId, (t) => (opensTab ? "" : (t?.url ?? "")));
  const hero = variant === "hero";
  const dropdown = variant === "sidebar";

  const noneSelected = opensTab ? -1 : 0;
  const bar = useBarText(hero, tabId, initialText, noneSelected);
  const { typed, edited, suppressCompletion, selected, scope, scopeFrom, pendingSelection, dispatch, selection } = bar;
  const input = useRef<TextInput>(null);
  const [bangEnter] = useState(createBangSubmitter);
  useEffect(() => () => bangEnter.cancel(), [bangEnter]);
  useEffect(() => bangEnter.cancel(), [bangEnter, typed, selected, scope]);
  const root = useRef<View>(null);

  const { items, completion, inline, shownCompletion, value, selectedIndex, current, tabScope } = useBarItems({
    input,
    typed,
    edited,
    scope,
    suppressCompletion,
    selected,
    dropdown,
    opensTab: !!opensTab,
    windowId,
    profileId,
    tabId,
    currentUrl,
  });

  const snapshot = useRef<BarSnapshot | null>(null);
  snapshot.current = { typed, edited, selection: selection.current, selected, scope, scopeFrom };
  const fieldText = useRef(value);
  fieldText.current = value;
  const editing = useRef(false);
  const focusEcho = useRef(false);
  const panelOpen = useWindowUiOf(windowId, (ui) => hero && !!ui?.panel.open);
  const [listAway, setListAway] = useState(false);
  if (panelOpen && !listAway) setListAway(true);
  const focusField = () => {
    if (!editing.current && fieldText.current) focusEcho.current = true;
    input.current?.focus();
  };
  useEffect(() => {
    if (!hero) return;
    const focus = () => {
      focusField();
      dispatch({ kind: "select", selection: { start: 0, end: fieldText.current.length } });
    };
    const unregister = registerHeroBar(windowId, tabId, focus);
    return () => {
      unregister();
      saveNtpQuery(tabId, snapshot.current);
    };
  }, [hero, windowId, tabId]);

  useLayoutEffect(() => {
    if (!pendingSelection) return;
    input.current?.setSelection(pendingSelection.start, pendingSelection.end);
    selection.note(pendingSelection);
    dispatch({ kind: "selectionApplied" });
    if (editing.current) claimFocusTag(windowId, hero ? heroBarFocus(tabId) : commandBarFocus, () => findNodeHandle(input.current));
  }, [pendingSelection]);

  const reset = () => {
    bangEnter.cancel();
    dispatch({ kind: "reset", selected: noneSelected });
    selection.collapse();
  };

  const dismiss = () => {
    bangEnter.cancel();
    return hero ? reset() : onDone?.();
  };

  const go = (url: string, disposition: Disposition = "current") => {
    bangEnter.cancel();
    if (!url) return;
    if (opensTab && disposition !== "newWindow") return openFromNewTabBar(windowId, opensTab, url);
    if (disposition === "current") journeyNavigate(tabId);
    openFromBar(url, tabId, disposition);
    if (disposition !== "current") dismiss();
  };

  const choose = (s: Suggestion | undefined, disposition: Disposition = "current", byEnter = false) => {
    bangEnter.cancel();
    if (s || !scope) trackSuggestionChosen(s);
    const typedSearch = !s || (byEnter && selectedIndex === 0 && s.kind === "search" && !s.bang && !s.suggested);
    if (!scope && typedSearch) {
      const text = edited ? value : initialText || value;
      if (mayBeBang(text)) {
        const fallback = s?.kind === "search" ? s.url : resolveInput(text, engine.url);
        bangEnter.submit(text, (url) => go(url ?? fallback, disposition));
        return;
      }
    }
    if (!s) {
      if (scope) return;
      const text = edited ? value : initialText || value;
      return go(resolveInput(text, engine.url), disposition);
    }
    switch (s.kind) {
      case "page":
        if (s.tabId && !(opensTab && disposition === "newTab")) {
          switchFromBar(s.tabId, s.url, tabId, disposition);
          if (hero && disposition === "current") reset();
          return;
        }
        return go(s.url, disposition);
      case "search":
      case "create":
        return go(s.url, disposition);
      case "calc":
        if (disposition !== "current") return go(s.url, disposition);
        copyText(s.value);
        dispatch({ kind: "calculated", text: s.value });
        return;
      case "action":
        dismiss();
        return runBarAction(s.id, windowId);
      case "extension":
        dismiss();
        return runBarExtension(s, windowId);
    }
  };

  const forceSearch = () => {
    const text = typed.trim();
    if (!text) return;
    go(scope ? scopedSearchUrl(scope, text, engine) : searchUrl(engine, text));
  };

  const onKeyDown = (e: BarKeyEvent) =>
    barKeyDown(e, { bar, hero, shownCompletion, items, selectedIndex, current, tabScope, onDone, reset, forceSearch, go, choose, cancelBang: () => bangEnter.cancel(), removeRow: (url) => rowActions.remove(url) });

  const onContextMenu = async () => {
    const pick = await showFieldMenu(value, selection);
    if (pick?.kind === "go") return go(pick.url);
    if (pick?.kind === "edit") dispatch({ kind: "edited", text: pick.text, caret: pick.caret });
    if (pick?.kind === "selectAll") dispatch({ kind: "select", selection: { start: 0, end: value.length } });
    focusField();
  };

  useLayoutEffect(() => journeyBarCommitted(tabId), []);
  useLayoutEffect(() => {
    if (items.length) journeySuggestions(tabId);
  }, [items]);

  const heardAt = useRef(0);
  const keyAt = useRef(0);
  useLayoutEffect(() => {
    if (__DEV__) traceOmnibox({ bar: `${windowId}:${variant}`, typed, heard: heardAt.current, committed: Date.now() });
    if (keyAt.current) {
      sampleOmniboxLatency(Date.now() - keyAt.current);
      keyAt.current = 0;
    }
  });

  const onChangeText = (next: string) => {
    if (__DEV__) heardAt.current = Date.now();
    const change = inline.read(next, { before: selection.beforeEdit(), after: selection.current });
    if (change.echo) {
      if (!change.stale) selection.note({ start: change.inline.typed.length, end: next.length });
      return;
    }
    bangEnter.cancel();
    focusEcho.current = false;
    keyAt.current = Date.now();
    journeyKeystroke(tabId);
    const bySpace = scope ? null : keywordBySpace(typed, next);
    const keyword = bySpace ? keywordScope(bySpace.keyword, windowId) : null;
    if (bySpace && keyword) return dispatch({ kind: "enteredScope", scope: keyword, from: bySpace.from });
    dispatch({ kind: "typed", text: change.typed, suppress: change.suppress, selected: opensTab && !change.typed.trim() ? -1 : 0 });
  };

  useOmniboxDriver(`${windowId}:${variant}`, {
    type: (text) => {
      selection.note({ start: text.length, end: text.length });
      onChangeText(text);
    },
    clear: reset,
    key: (key, mods) => onKeyDown({ nativeEvent: { key, ...mods } }),
    select: (start, end) => selection.note({ start, end }),
    submit: () => choose(current, "current", true),
    measure: () => new Promise((resolve) => root.current?.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }))),
    state: () => ({ typed, value, selection: selection.current, completion: shownCompletion, suggested: completion, preventInline: suppressCompletion, selectionBefore: selection.before, selected: selectedIndex, scope, scopeFrom, tabScope, items }),
  });

  const leadingIcon =
    current && (typed || scope) && current.kind !== "search" ? (
      <SuggestionIcon suggestion={current} color={theme.textPrimary} />
    ) : (
      <Symbol name={incognito ? INCOGNITO_ICON : "magnifyingglass"} size={BAR.leadingIcon} weight="medium" color={hero ? theme.textSecondary : theme.textPrimary} style={{ width: BAR.iconSlot, height: BAR.iconSlot }} />
    );

  const focused = useRef(false);
  const focusOnce = () => {
    if (focused.current) return;
    focused.current = true;
    focusField();
    const { start, end } = selection.current;
    input.current?.setSelection(start, end);
    claimFocusTag(windowId, hero ? heroBarFocus(tabId) : commandBarFocus, () => findNodeHandle(input.current));
    journeyBarFocused(tabId);
  };

  const field = (
    <BarField
      inputRef={input}
      variant={variant}
      floating={floating}
      scope={scope}
      incognito={incognito}
      onLayout={focusOnce}
      value={value}
      focusEcho={focusEcho}
      onSelection={(next) => {
        selection.note(next);
        if (inline.accepts(next)) dispatch({ kind: "caretAccepted", text: value });
      }}
      onChangeText={onChangeText}
      onSubmitEditing={() => choose(current, "current", true)}
      onFocus={() => {
        editing.current = true;
        setListAway(false);
      }}
      onBlur={() => {
        editing.current = false;
        focusEcho.current = false;
        onCancel?.();
      }}
      keyDownEvents={barKeyDownEvents(asksForBackspace(scope), isRemovable(current))}
      onKeyDown={onKeyDown}
    />
  );

  const latest = useRef({ choose, profileId, go, current, onCancel, tabId, windowId });
  latest.current = { choose, profileId, go, current, onCancel, tabId, windowId };
  const [barActions] = useState(() => ({
    go: (url: string) => latest.current.go(url),
    openTabOrFile: () => void openTabOrFile(latest.current.windowId, latest.current.tabId, (url) => latest.current.go(url)),
    choose: () => latest.current.choose(latest.current.current, "current", true),
    dictate: () => {
      focusField();
      startDictation();
    },
    siteControls: () => {
      latest.current.onCancel?.();
      setPopover(latest.current.tabId, "siteControls");
    },
  }));
  const [rowActions] = useState<RowActions>(() => ({
    choose: (s) => latest.current.choose(s),
    remove: (url) => removeHistory(latest.current.profileId, [url]),
  }));
  const suggestionList = (
    <SuggestionList
      items={items}
      selectedIndex={selectedIndex}
      trailing={tabScope ? `Search ${tabScope.name}  ⇥` : null}
      dropdown={dropdown}
      actions={rowActions}
    />
  );

  const onBarContextMenu = () => void onContextMenu();
  if (dropdown)
    return (
      <DropdownFrame
        rootRef={root}
        onContextMenu={onBarContextMenu}
        leadingIcon={leadingIcon}
        scope={scope}
        field={field}
        list={suggestionList}
        onSiteControls={currentUrl ? barActions.siteControls : null}
      />
    );
  return (
    <PanelFrame
      rootRef={root}
      onContextMenu={onBarContextMenu}
      leadingIcon={leadingIcon}
      scope={scope}
      field={field}
      list={listAway ? null : suggestionList}
      hero={hero}
      rowHeight={fieldRowHeight}
      bottom={
        <BottomRow
          hero={hero}
          addChip={<AddChip onPress={barActions.openTabOrFile} />}
          onDictate={barActions.dictate}
          label={destinationLabel(current)}
          enabled={!hero || !!typed.trim()}
          onGo={barActions.choose}
        />
      }
    />
  );
}

async function openTabOrFile(windowId: string, tabId: string, onGo: (url: string) => void) {
  const others = otherOpenTabs(windowId, ADD_CHIP.otherTabs);
  const choice = await chooseFromMenu<{ tab: string }, "files">([
    ...others.map((t) => ({ value: { tab: t.id }, title: t.title || displayUrl(t.url) })),
    ...(others.length ? [{ separator: true as const }] : []),
    { id: "files", title: "Open File…", symbol: "doc" },
  ]);
  if (choice && typeof choice === "object") switchFromBar(choice.tab, "", tabId, "current");
  if (choice === "files") {
    const [file] = await pickFiles();
    if (file) onGo(file);
  }
}
