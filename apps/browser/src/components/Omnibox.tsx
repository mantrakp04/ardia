import { displayUrl, asksForBackspace, keywordBySpace, resolveInput, searchUrl, scopedSearchUrl, siteSearchKey, type SearchScope, type Suggestion } from "@ardia/core";
import { ContextMenuArea, Symbol, copyText, pickFiles, showMenu, startDictation } from "@ardia/shell";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { findNodeHandle, Pressable, Text, TextInput, View } from "react-native";
import { useTheme } from "../lib/theme";
import { journeyBarCommitted, journeyBarFocused, journeyKeystroke, journeyNavigate, journeySuggestions } from "../telemetry/journeys";
import { sampleOmniboxLatency, trackSuggestionChosen } from "../telemetry/track";
import { useBrowser } from "../store/browser";
import { useWindowId, useWindowProfileId } from "../store/hooks";
import { activeTabId, viewTabIds } from "../store/model";
import { defaultSearchEngine } from "../store/settings";
import { runBarAction } from "./omnibox/actions";
import { runBarExtension } from "./omnibox/extensions";
import { createBangSubmitter, mayBeBang } from "./omnibox/bangs";
import { traceOmnibox, useOmniboxDriver } from "./omnibox/devDriver";
import { claimFocusTag, commandBarFocus, heroBarFocus } from "../lib/focusClaims";
import { registerHeroBar, savedNtpQuery, saveNtpQuery, type BarDismissal, type BarSnapshot } from "./omnibox/barState";
import { dispositionFor, openFromBar, switchFromBar, type Disposition } from "./omnibox/open";
import { openFromNewTabBar } from "./omnibox/newTabBar";
import type { NewTabTarget } from "../store/types";
import { clipboardPasteAction, pasteMenuItem, pasteTarget, readClipboard } from "./omnibox/paste";
import { ScopeChip } from "./omnibox/ScopeChip";
import { SuggestionIcon, SuggestionList, isRemovable, type RowActions } from "./omnibox/SuggestionRow";
import { useDropdownStart, useOpenTabsStart } from "./omnibox/dropdownStart";
import { useInlineCompletion } from "./omnibox/useInlineCompletion";
import { keywordScope, offeredScope, useSuggestions } from "./omnibox/useSuggestions";
import { setPopover } from "./layout/pageState";
import { IconButton, useHover } from "./primitives";

type Variant = "panel" | "hero" | "sidebar";

export const PANEL_TEXT_LEFT = 48;
const PANEL_ICON_LEFT = 21;
const FIELD_TEXT_INSET = 2.5;
type Selection = { start: number; end: number };

const BASE_KEYS = [
  { key: "Escape" },
  { key: "ArrowUp" },
  { key: "ArrowDown" },
  { key: "PageUp" },
  { key: "PageDown" },
  { key: "Tab" },
  { key: "Tab", shiftKey: true },
  { key: "n", ctrlKey: true },
  { key: "p", ctrlKey: true },
  { key: "Enter", metaKey: true },
  { key: "Enter", altKey: true },
  { key: "Enter", shiftKey: true },
  { key: "Enter", ctrlKey: true },
  { key: "Enter", ctrlKey: true, shiftKey: true },
];
const SCOPE_KEYS = [...BASE_KEYS, { key: "Backspace" }];
const REMOVE_KEYS = [...BASE_KEYS, { key: "Delete", shiftKey: true }];

export function Omnibox({
  variant,
  tabId,
  initialText = "",
  onCancel,
  onDone = onCancel,
  opensTab,
}: {
  variant: Variant;
  tabId: string;
  initialText?: string;
  opensTab?: NewTabTarget;
  onCancel?(): void;
  onDone?(reason?: BarDismissal): void;
}) {
  const theme = useTheme();
  const windowId = useWindowId();
  const profileId = useWindowProfileId();
  const engine = useBrowser((s) => defaultSearchEngine(s.settings));
  const currentUrl = useBrowser((s) => (opensTab ? "" : (s.tabs[tabId]?.url ?? "")));
  const hero = variant === "hero";
  const dropdown = variant === "sidebar";

  const [restored] = useState(() => (hero ? savedNtpQuery(tabId) : null));
  const [typed, setTyped] = useState(restored?.typed ?? initialText);
  const [edited, setEdited] = useState(restored?.edited ?? false);
  const [suppressCompletion, setSuppressCompletion] = useState(true);
  const noneSelected = opensTab ? -1 : 0;
  const [selected, setSelected] = useState(restored?.selected ?? noneSelected);
  const [scope, setScope] = useState<SearchScope | null>(restored?.scope ?? null);
  const scopeFrom = useRef(restored?.scopeFrom ?? "");
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(
    restored?.selection ?? (initialText ? { start: 0, end: initialText.length } : null),
  );
  const selection = useRef<Selection>(restored?.selection ?? { start: 0, end: typed.length });
  const selectionBefore = useRef<Selection>(selection.current);
  const selectionAt = useRef(0);
  const noteSelection = (next: Selection) => {
    const now = selection.current;
    if (now.start !== next.start || now.end !== next.end) {
      selectionBefore.current = now;
      selectionAt.current = Date.now();
    }
    selection.current = next;
  };
  const input = useRef<TextInput>(null);
  const [bangEnter] = useState(createBangSubmitter);
  useEffect(() => () => bangEnter.cancel(), [bangEnter]);
  useEffect(() => bangEnter.cancel(), [bangEnter, typed, selected, scope]);
  const root = useRef<View>(null);

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
  const idle = !!opensTab && !scope && !typed.trim();
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

  const snapshot = useRef<BarSnapshot | null>(null);
  snapshot.current = { typed, edited, selection: selection.current, selected, scope, scopeFrom: scopeFrom.current };
  const fieldText = useRef(value);
  fieldText.current = value;
  const editing = useRef(false);
  const focusEcho = useRef(false);
  const panelOpen = useBrowser((s) => hero && !!s.windowUi[windowId]?.panel.open);
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
      setPendingSelection({ start: 0, end: fieldText.current.length });
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
    noteSelection(pendingSelection);
    setPendingSelection(null);
    if (editing.current) claimFocusTag(windowId, hero ? heroBarFocus(tabId) : commandBarFocus, () => findNodeHandle(input.current));
  }, [pendingSelection]);

  const reset = () => {
    bangEnter.cancel();
    setTyped("");
    setEdited(false);
    setScope(null);
    setSelected(noneSelected);
    setSuppressCompletion(true);
    selection.current = { start: 0, end: 0 };
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
        setTyped(s.value);
        setSuppressCompletion(true);
        setPendingSelection({ start: 0, end: s.value.length });
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

  const enterScope = (next: SearchScope, from: string) => {
    scopeFrom.current = from;
    setScope(next);
    setTyped("");
    setEdited(true);
    setSelected(0);
    setSuppressCompletion(true);
  };

  const leaveScope = (restore: string | null) => {
    setScope(null);
    if (restore !== null) {
      setTyped(restore);
      setEdited(true);
      setPendingSelection({ start: restore.length, end: restore.length });
    }
    setSelected(0);
    setSuppressCompletion(true);
  };

  const move = (delta: 1 | -1) =>
    setSelected(() => {
      const n = items.length;
      if (!n) return 0;
      if (selectedIndex < 0) return delta > 0 ? 0 : n - 1;
      return (selectedIndex + delta + n) % n;
    });

  const onKeyDown = (e: { nativeEvent: { key: string; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean } }) => {
    const { key, metaKey, altKey, shiftKey, ctrlKey } = e.nativeEvent;
    bangEnter.cancel();
    if (key === "Escape") {
      if (scope) return leaveScope(null);
      if (!hero) return onDone?.("escape");
      if (shownCompletion) return setSuppressCompletion(true);
      return reset();
    }
    if (key === "ArrowDown" || (ctrlKey && key === "n")) return move(1);
    if (key === "ArrowUp" || (ctrlKey && key === "p")) return move(-1);
    if (key === "PageUp") return setSelected(0);
    if (key === "PageDown") return setSelected(Math.max(0, items.length - 1));
    if (key === "Delete" && shiftKey) return isRemovable(current) ? rowActions.remove(current.url) : undefined;
    if ((key === "Tab" && !ctrlKey) || key === "Backspace") {
      const action = siteSearchKey(key, { shiftKey, altKey, metaKey, ctrlKey }, { typed, completion: shownCompletion, scope, offered: tabScope, scopeFrom: scopeFrom.current });
      if (action?.kind === "enter") return enterScope(action.scope, action.from);
      if (action?.kind === "leave") return leaveScope(action.text);
      if (action?.kind === "accept") {
        setTyped(action.text);
        setSuppressCompletion(true);
        setPendingSelection({ start: action.text.length, end: action.text.length });
        return;
      }
      if (key === "Tab") return move(shiftKey ? -1 : 1);
    }
    if (key === "Enter") {
      if (metaKey && shiftKey) return forceSearch();
      if (ctrlKey && !/[\s./:]/.test(typed.trim()) && typed.trim())
        return go(`https://www.${typed.trim()}.com`, shiftKey ? "newWindow" : "current");
      if (metaKey || altKey || shiftKey) return choose(current, dispositionFor({ metaKey, altKey, shiftKey }), true);
    }
  };

  const onContextMenu = async () => {
    const paste = await clipboardPasteAction();
    const { start, end } = selection.current;
    const hasSelection = end > start;
    const choice = await showMenu([
      ...pasteMenuItem(paste),
      ...(paste ? [{ separator: true as const }] : []),
      { id: "cut", title: "Cut", enabled: hasSelection },
      { id: "copy", title: "Copy", enabled: hasSelection },
      { id: "paste", title: "Paste", enabled: !!paste },
      { separator: true },
      { id: "selectAll", title: "Select All", enabled: !!value },
    ]);
    if (choice === "pasteAndGo" && paste) return go(pasteTarget(paste));
    if (choice === "copy" || choice === "cut") copyText(value.slice(start, end));
    if (choice === "cut" || choice === "paste") {
      const insert = choice === "paste" ? (await readClipboard()).replace(/\s*\n\s*/g, " ") : "";
      const next = value.slice(0, start) + insert + value.slice(end);
      setTyped(next);
      setEdited(true);
      setSuppressCompletion(true);
      setSelected(0);
      setPendingSelection({ start: start + insert.length, end: start + insert.length });
    }
    if (choice === "selectAll") setPendingSelection({ start: 0, end: value.length });
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
    const fresh = Date.now() - selectionAt.current < 100;
    const change = inline.read(next, { before: fresh ? selectionBefore.current : selection.current, after: selection.current });
    if (change.echo) {
      if (!change.stale) noteSelection({ start: change.inline.typed.length, end: next.length });
      return;
    }
    bangEnter.cancel();
    focusEcho.current = false;
    keyAt.current = Date.now();
    journeyKeystroke(tabId);
    const bySpace = scope ? null : keywordBySpace(typed, next);
    const keyword = bySpace ? keywordScope(bySpace.keyword, windowId) : null;
    if (bySpace && keyword) return enterScope(keyword, bySpace.from);
    setEdited(true);
    setTyped(change.typed);
    setSuppressCompletion(change.suppress);
    setSelected(opensTab && !change.typed.trim() ? -1 : 0);
  };

  useOmniboxDriver(`${windowId}:${variant}`, {
    type: (text) => {
      noteSelection({ start: text.length, end: text.length });
      onChangeText(text);
    },
    clear: reset,
    key: (key, mods) => onKeyDown({ nativeEvent: { key, ...mods } }),
    select: (start, end) => noteSelection({ start, end }),
    submit: () => choose(current, "current", true),
    measure: () => new Promise((resolve) => root.current?.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }))),
    state: () => ({ typed, value, selection: selection.current, completion: shownCompletion, suggested: completion, preventInline: suppressCompletion, selectionBefore: selectionBefore.current, selected: selectedIndex, scope, scopeFrom: scopeFrom.current, tabScope, items }),
  });

  const leadingIcon =
    current && (typed || scope) && current.kind !== "search" ? (
      <SuggestionIcon suggestion={current} color={theme.textPrimary} />
    ) : (
      <Symbol name="magnifyingglass" size={15} weight="medium" color={hero ? theme.textSecondary : theme.textPrimary} style={{ width: 18, height: 18 }} />
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
    <TextInput
      ref={input}
      onLayout={focusOnce}
      value={value}
      onSelectionChange={(e) => {
        const next = e.nativeEvent.selection;
        if (focusEcho.current) {
          const atEnd = next.start === value.length && next.end === value.length;
          if (atEnd || (next.start === 0 && next.end === value.length)) {
            if (atEnd) focusEcho.current = false;
            return;
          }
          focusEcho.current = false;
        }
        noteSelection(next);
        if (inline.accepts(next)) {
          setTyped(value);
          setSuppressCompletion(true);
          setSelected(0);
        }
      }}
      onChangeText={onChangeText}
      placeholder={scope ? `Search ${scope.name}` : "Search or enter address"}
      placeholderTextColor={theme.placeholder}
      selectionColor={theme.selection}
      enableFocusRing={false}
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
      keyDownEvents={asksForBackspace(scope) ? SCOPE_KEYS : isRemovable(current) ? REMOVE_KEYS : BASE_KEYS}
      onKeyDown={onKeyDown}
      style={{
        flex: 1,
        fontSize: hero ? 17 : dropdown ? 14 : 13,
        color: theme.textPrimary,
        paddingVertical: 0,
        marginTop: variant === "panel" ? -3 : 0,
      }}
    />
  );

  const latest = useRef({ choose, profileId, go, current, onCancel, tabId });
  latest.current = { choose, profileId, go, current, onCancel, tabId };
  const [barActions] = useState(() => ({
    go: (url: string) => latest.current.go(url),
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
    remove: (url) => useBrowser.getState().removeHistory(latest.current.profileId, [url]),
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

  const bottomRow = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: hero ? 13 : 14,
        paddingRight: hero ? 15 : 13,
        height: hero ? 43 : 52,
        marginBottom: hero ? 8 : 0,
      }}
    >
      <AddChip tabId={tabId} onGo={barActions.go} />
      <View style={{ flex: 1 }} />
      <IconButton icon="mic" size={14} color={theme.textTertiary} tooltip="Dictate" onPress={barActions.dictate} />
      <GoButton label={destinationLabel(current)} enabled={!hero || !!typed.trim()} onPress={barActions.choose} />
    </View>
  );

  if (dropdown) {
    return (
      <View ref={root}>
        <ContextMenuArea captureDescendants onContextMenu={() => void onContextMenu()}>
          <View style={{ flexDirection: "row", alignItems: "center", height: 44, paddingLeft: 13, paddingRight: 9, gap: 9 }}>
            <View style={{ width: 18, alignItems: "center" }}>{leadingIcon}</View>
            {scope && <ScopeChip scope={scope} large={false} />}
            {field}
            {currentUrl ? (
              <IconButton
                icon="info.circle"
                size={15}
                box={26}
                radius={13}
                color={theme.textSecondary}
                tooltip="Site Controls"
                onPress={barActions.siteControls}
              />
            ) : null}
          </View>
        </ContextMenuArea>
        {suggestionList}
      </View>
    );
  }

  return (
    <View ref={root}>
      <ContextMenuArea captureDescendants onContextMenu={() => void onContextMenu()}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            height: hero ? 60 : 55,
            paddingLeft: hero ? 18 : PANEL_ICON_LEFT,
            paddingRight: 18,
            gap: hero ? 8 : PANEL_TEXT_LEFT - FIELD_TEXT_INSET - PANEL_ICON_LEFT - 18,
          }}
        >
          <View style={{ width: 18, alignItems: "center" }}>{leadingIcon}</View>
          {scope && <ScopeChip scope={scope} large={hero} />}
          {field}
        </View>
      </ContextMenuArea>
      {listAway ? null : suggestionList}
      {bottomRow}
    </View>
  );
}

function destinationLabel(s: Suggestion | undefined): string {
  if (s?.kind === "search") return s.engine;
  if (s?.kind === "calc") return "Copy";
  return "Go";
}

const AddChip = memo(function AddChip({ tabId, onGo }: { tabId: string; onGo(url: string): void }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const { hovered, hoverProps } = useHover();
  const open = async () => {
    const s = useBrowser.getState();
    const active = activeTabId(s, windowId);
    const others = viewTabIds(s, windowId)
      .map((id) => s.tabs[id]!)
      .filter((t) => t.id !== active && t.url)
      .slice(0, 12);
    const choice = await showMenu([
      ...others.map((t) => ({ id: `tab:${t.id}`, title: t.title || displayUrl(t.url) })),
      ...(others.length ? [{ separator: true as const }] : []),
      { id: "files", title: "Open File…", symbol: "doc" },
    ]);
    if (choice?.startsWith("tab:")) switchFromBar(choice.slice(4), "", tabId, "current");
    if (choice === "files") {
      const [file] = await pickFiles();
      if (file) onGo(file);
    }
  };
  return (
    <View {...hoverProps}>
    <Pressable onPress={open}>
      <View
        style={{
          height: 32,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.chipBorder,
          backgroundColor: hovered ? theme.rowHover : undefined,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 9,
          paddingRight: 12,
          gap: 5,
        }}
      >
        <Symbol name="arrow.up.right" size={10} weight="medium" color={theme.chipText} style={{ width: 14, height: 14 }} />
        <Text style={{ fontSize: 13, color: theme.chipText }}>Open a tab or file</Text>
      </View>
    </Pressable>
    </View>
  );
});

const GoButton = memo(function GoButton({ label, enabled, onPress }: { label: string; enabled: boolean; onPress(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const text = enabled ? theme.goButtonText : theme.textTertiary;
  return (
    <View {...hoverProps} style={{ marginLeft: 8 }}>
    <Pressable onPress={onPress} disabled={!enabled} accessibilityRole="button" accessibilityLabel={label}>
      <View
        style={{
          minWidth: 99,
          height: 32,
          paddingHorizontal: 16,
          borderRadius: 16,
          backgroundColor: enabled ? theme.goButton : theme.goButtonIdle,
          opacity: enabled && hovered ? 0.9 : 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: text }}>{label}</Text>
        <Symbol name="return" size={11} weight="medium" color={enabled ? text + "99" : text} style={{ width: 14, height: 14 }} />
      </View>
    </Pressable>
    </View>
  );
});
