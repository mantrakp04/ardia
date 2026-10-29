import { onExtensionActionChanged, watchExtensionActions } from "../../platform/extensions";
import { AppState } from "react-native";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { usePages } from "../tabs/pageState";
import { extensionProfile, useExtensions, windowExtensions } from "./store";
import { syncSidePanel, wantedSidePanels } from "./sidePanels";
import { refreshExtensionsAfterChange } from "./actions";
import { refreshActionStates } from "./actionStates";
import { focusedWindowOf } from "../windows/ui";

const ACTION_POLL_MS = 1500;
const ACTION_EVENT_COALESCE_MS = 150;

function refreshActionsAndPanels() {
  void refreshActionStates();
  for (const [windowId] of wantedSidePanels()) void syncSidePanel(windowId);
}

let actionPoll: ReturnType<typeof setInterval> | null = null;
function pollActionStates() {
  actionPoll ??= setInterval(() => {
    if (AppState.currentState === "active") refreshActionsAndPanels();
  }, ACTION_POLL_MS);
}

const loadedProfiles = new Set<string>();

export function watchActionsOf(profile: string): boolean {
  if (loadedProfiles.has(profile)) return false;
  loadedProfiles.add(profile);
  void watchExtensionActions(profile)
    .then(
      () => true,
      () => false,
    )
    .then((watching) => watching || pollActionStates());
  return true;
}

const dirtyActions = new Set<string>();
const dirtyLists = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const windowsOf = (s: BrowserState, profile: string) => s.windowOrder.filter((windowId) => extensionProfile(s, windowId) === profile);

function showsAction(profile: string, extensionId: string) {
  const s = useBrowser.getState();
  const popup = useExtensions.getState().popup;
  const windows = windowsOf(s, profile);
  if (wantedSidePanels().some(([windowId, id]) => id === extensionId && windows.includes(windowId))) return true;
  return windows.some((windowId) => windowExtensions(s, windowId).some((x) => x.id === extensionId && (x.pinned || popup?.extensionId === x.id)));
}

function flushActionChanges() {
  flushTimer = null;
  if (AppState.currentState !== "active") return;
  for (const profile of dirtyLists) if (loadedProfiles.has(profile)) void refreshExtensionsAfterChange(profile);
  dirtyLists.clear();
  if (dirtyActions.size) {
    const profiles = [...dirtyActions];
    dirtyActions.clear();
    void refreshActionStates(profiles);
    const s = useBrowser.getState();
    for (const [windowId] of wantedSidePanels()) if (profiles.includes(extensionProfile(s, windowId))) void syncSidePanel(windowId);
  }
}

function flushSoon() {
  if (AppState.currentState !== "active" || (!dirtyActions.size && !dirtyLists.size)) return;
  flushTimer ??= setTimeout(flushActionChanges, ACTION_EVENT_COALESCE_MS);
}

export function startActionStates() {
  onExtensionActionChanged(({ profile, id, kind }) => {
    if (kind === "registry") dirtyLists.add(profile);
    else if (showsAction(profile, id)) dirtyActions.add(profile);
    else return;
    flushSoon();
  });
  AppState.addEventListener("change", (state) => state === "active" && flushSoon());
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows || focusedWindowOf(s) !== focusedWindowOf(prev)) return void refreshActionStates();
    if (s.tabs === prev.tabs) return;
    if (s.windowOrder.some((id) => { const active = activeTabId(s, id); return !!active && s.tabs[active] !== prev.tabs[active]; })) void refreshActionStates();
  });
  useExtensions.subscribe((e, prev) => {
    if (e.lists !== prev.lists || e.popup !== prev.popup) void refreshActionStates();
  });
  usePages.subscribe((p, prev) => {
    if (p.ready === prev.ready) return;
    void refreshActionStates();
    const actions = useExtensions.getState().actions;
    const gone = Object.keys(actions).filter((id) => !p.ready[id]);
    if (!gone.length) return;
    const next = { ...actions };
    for (const id of gone) delete next[id];
    useExtensions.setState({ actions: next });
  });
}
