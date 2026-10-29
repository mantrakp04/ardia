import type { ControlPress, DisplayMediaRequest, MediaCommand, NowPlaying, PictureInPictureState } from "../../platform/media";
import { useEffect, useState } from "react";
import type { AccessibilityActionEvent, GestureResponderEvent } from "react-native";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import type { BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { peekTabId } from "../peek/peek";
import { splitOf, splitTabIdsOf } from "../splits/splits";
import { hostOf } from "@ardia/core";
import { isSleeping } from "../tabs/sleepingTabs";

export type Session = NowPlaying & {
  playedAt: number;
};

type Store = {
  sessions: Record<string, Session>;
  dismissed: Record<string, true>;
  leftPaused: Record<string, true>;
  pip: Record<string, "manual">;
  pipOpen: Record<string, PictureInPictureState["kind"]>;
  displayRequests: Record<string, DisplayMediaRequest>;
  tabShares: Record<string, TabShare>;
};

export type TabShare = {
  capturedTabId: string;
  origin: string;
  dismissed: Record<string, true>;
};

const noMedia = (): Store => ({ sessions: {}, dismissed: {}, leftPaused: {}, pip: {}, pipOpen: {}, displayRequests: {}, tabShares: {} });
const PER_TAB = Object.keys(noMedia()) as (keyof Store)[];

export const useMedia = create<Store>()(noMedia);

export function setPictureInPictureState(tabId: string, { kind, active }: PictureInPictureState) {
  useMedia.setState((s) => {
    if (active ? s.pipOpen[tabId] === kind : !s.pipOpen[tabId]) return s;
    const pipOpen = { ...s.pipOpen };
    if (active) pipOpen[tabId] = kind;
    else delete pipOpen[tabId];
    const pip = { ...s.pip };
    if (!active) delete pip[tabId];
    return { pipOpen, pip };
  });
}

export function setNowPlaying(tabId: string, state: NowPlaying | null) {
  useMedia.setState((s) => {
    const sessions = { ...s.sessions };
    const dismissed = { ...s.dismissed };
    if (!state) {
      if (!sessions[tabId]) return s;
      delete sessions[tabId];
      return { sessions };
    }
    const before = sessions[tabId];
    const started = isControllablyPlaying(state) && !(before && isControllablyPlaying(before));
    sessions[tabId] = { ...state, playedAt: started ? Date.now() : (before?.playedAt ?? 0) };
    if (started) delete dismissed[tabId];
    return { sessions, dismissed };
  });
}

const isControllablyPlaying = (state: NowPlaying) => state.controllable && state.playbackState === "playing";

export const useSession = (tabId: string | undefined): Session | undefined => useMedia((s) => (tabId ? s.sessions[tabId] : undefined));

export const isPlaying = (session: Session | undefined) => session?.playbackState === "playing";

export function positionOf(session: Session, now = Date.now()): number {
  const elapsed = isPlaying(session) ? ((now - session.timestamp) / 1000) * (session.playbackRate || 1) : 0;
  const position = session.position + elapsed;
  return session.duration ? Math.min(Math.max(0, position), session.duration) : Math.max(0, position);
}

export function useTicker(active: boolean, ms = 500) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function mediaCommand(tabId: string, action: MediaCommand, seconds?: number) {
  if (!isSleeping(tabId)) return void webviews.get(tabId)?.mediaCommand(action, seconds);
  if (action === "play" || action === "toggle") wakeToPlay(tabId);
}

const WAKE_TO_PLAY_MS = 20_000;
const LOADED_WITHOUT_SESSION_MS = 1500;
const RESUME_SEEK_MIN_SECONDS = 5;
const waking = new Set<string>();

function wakeToPlay(tabId: string) {
  const handle = webviews.get(tabId);
  if (!handle || waking.has(tabId)) return;
  const before = useMedia.getState().sessions[tabId];
  waking.add(tabId);
  let sawLoading = false;
  let loaded: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe: (() => void)[] = [];
  const finish = () => {
    for (const stop of unsubscribe) stop();
    clearTimeout(deadline);
    clearTimeout(loaded);
    waking.delete(tabId);
  };
  const resume = (after: NowPlaying | null) => {
    finish();
    for (const [action, seconds] of resumeCommands(before, after)) void webviews.get(tabId)?.mediaCommand(action, seconds);
  };
  const deadline = setTimeout(finish, WAKE_TO_PLAY_MS);
  unsubscribe.push(
    useMedia.subscribe((m) => {
      const after = m.sessions[tabId];
      if (after && after !== before && after.playbackState !== "none") resume(after);
    }),
    useBrowser.subscribe((s) => {
      if (loaded || isSleeping(tabId)) return;
      if (s.live[tabId]?.isLoading) sawLoading = true;
      else if (sawLoading) loaded = setTimeout(() => resume(null), LOADED_WITHOUT_SESSION_MS);
    }),
  );
  void handle.reload().catch(finish);
}

export function resumeCommands(before: Session | undefined, after: NowPlaying | null): [MediaCommand, number?][] {
  if (after?.playbackState === "playing") return [];
  const at = before ? positionOf(before) : 0;
  const sameMedia = !after || (!!before?.title && before.title === after.title);
  const moved = !after || Math.abs(after.position - at) > RESUME_SEEK_MIN_SECONDS;
  return sameMedia && at > RESUME_SEEK_MIN_SECONDS && moved ? [["seekTo", at], ["play"]] : [["play"]];
}

export const hasTrackControls = (session: Session) => session.actions.includes("nexttrack") || session.actions.includes("previoustrack");

export const SKIP_SECONDS = 15;

export function skipBy(tabId: string, session: Session, seconds: number) {
  const now = Date.now();
  const position = Math.max(0, Math.min(session.duration ?? Infinity, positionOf(session, now) + seconds));
  setNowPlaying(tabId, { ...session, position, timestamp: now });
  mediaCommand(tabId, "seekBy", seconds);
}

export function seekTo(tabId: string, session: Session, seconds: number) {
  setNowPlaying(tabId, { ...session, position: seconds, timestamp: Date.now() });
  mediaCommand(tabId, "seekTo", seconds);
}

export function skipOrTrack(tabId: string, session: Session, direction: "back" | "ahead") {
  if (hasTrackControls(session)) mediaCommand(tabId, direction === "back" ? "previous" : "next");
  else skipBy(tabId, session, direction === "back" ? -SKIP_SECONDS : SKIP_SECONDS);
}

export const transportIcons = (session: Session) =>
  hasTrackControls(session)
    ? { back: "backward.end.fill", ahead: "forward.end.fill", backTip: "Play Previous Track", aheadTip: "Play Next Track" }
    : { back: `gobackward.${SKIP_SECONDS}`, ahead: `goforward.${SKIP_SECONDS}`, backTip: `Skip back ${SKIP_SECONDS} seconds`, aheadTip: `Skip ahead ${SKIP_SECONDS} seconds` };

export function isTabShown(s: BrowserState, tabId: string, spaceId?: string): boolean {
  const windowId = s.tabs[tabId]?.windowId;
  if (!windowId) return false;
  const active = activeTabId(s, windowId, spaceId);
  if (!active) return false;
  return active === tabId || peekTabId(s, windowId) === tabId || !!splitTabIdsOf(splitOf(s, active))?.includes(tabId);
}

export function hasPlayer(m: Pick<Store, "sessions" | "dismissed">, tabId: string): boolean {
  const session = m.sessions[tabId];
  return !!session && session.controllable && !m.dismissed[tabId] && !!session.playedAt && session.playbackState !== "none";
}

function isHiddenPlayerTab(s: BrowserState, tabId: string): boolean {
  const tab = s.tabs[tabId];
  return !!tab && !!s.windows[tab.windowId] && s.settings.sidebarMediaControls && !isTabShown(s, tabId, tab.spaceId);
}

let hiddenBefore = new Set<string>();

function noteLeftPaused() {
  const m = useMedia.getState();
  const sessionIds = Object.keys(m.sessions);
  if (!hiddenBefore.size && !sessionIds.length) return;
  const s = useBrowser.getState();
  const hidden = new Set(sessionIds.filter((id) => isHiddenPlayerTab(s, id)));
  const left = [...hidden].filter((id) => !isPlaying(m.sessions[id]) && (m.leftPaused[id] || !hiddenBefore.has(id)));
  hiddenBefore = hidden;
  if (left.length !== Object.keys(m.leftPaused).length || left.some((id) => !m.leftPaused[id])) useMedia.setState({ leftPaused: Object.fromEntries(left.map((id) => [id, true as const])) });
}

useBrowser.subscribe(noteLeftPaused);
useMedia.subscribe((m, prev) => {
  if (m.sessions !== prev.sessions) noteLeftPaused();
});

export function playerTabFor(m: Pick<Store, "sessions" | "dismissed">, tabIds: string[], current?: string): string | undefined {
  const eligible = (id: string) => hasPlayer(m, id);
  if (current && tabIds.includes(current) && eligible(current)) return current;
  let best: Session | undefined;
  let bestId: string | undefined;
  const rank = (x: Session) => (isPlaying(x) ? 1 : 0);
  for (const id of tabIds) {
    if (!eligible(id)) continue;
    const session = m.sessions[id]!;
    if (!best || rank(session) > rank(best) || (rank(session) === rank(best) && session.playedAt > best.playedAt)) {
      best = session;
      bestId = id;
    }
  }
  return bestId;
}

const PIP_STATE = 'post("result", JSON.stringify(!!document.pictureInPictureElement || !!window.documentPictureInPicture?.window))';

async function inPictureInPicture(tabId: string): Promise<boolean> {
  return (await webviews.get(tabId)?.evaluate<boolean>(PIP_STATE)) === true;
}

export function exitPictureInPicture(tabId: string) {
  const view = webviews.get(tabId);
  if (!view) return;
  if (useMedia.getState().pipOpen[tabId] === "document") void view.executeJavaScript("window.documentPictureInPicture?.window?.close()");
  else void view.exitPictureInPicture();
  setPip(tabId, null);
}

async function togglePictureInPicture(tabId: string, press: ControlPress): Promise<boolean> {
  const view = webviews.get(tabId);
  if (!view) return false;
  if (useMedia.getState().pipOpen[tabId] || (await inPictureInPicture(tabId))) {
    if (!press.clickAt && !(await view.takeControlPress(press))) return false;
    exitPictureInPicture(tabId);
    return false;
  }
  const ok = await view.requestPictureInPicture(press);
  if (ok) setPip(tabId, "manual");
  return ok;
}

function setPip(tabId: string, kind: Store["pip"][string] | null) {
  useMedia.setState((s) => {
    if ((s.pip[tabId] ?? null) === kind) return s;
    const pip = { ...s.pip };
    if (kind) pip[tabId] = kind;
    else delete pip[tabId];
    return { pip };
  });
}

function controlPress(press: GestureResponderEvent | AccessibilityActionEvent): ControlPress {
  const native = press.nativeEvent as { key?: unknown; target?: unknown; timestamp?: unknown; actionName?: unknown; actionTarget?: unknown };
  if (native.actionName === "activate") return { clickAt: 0, control: typeof native.actionTarget === "number" ? native.actionTarget : 0 };
  if (native.key === " " || native.key === "Enter") return { clickAt: 0, control: typeof native.target === "number" ? native.target : 0 };
  return { clickAt: typeof native.timestamp === "number" ? native.timestamp : 0, control: 0 };
}

export function usePictureInPicture(tabId: string): [boolean, (press: GestureResponderEvent | AccessibilityActionEvent) => void] {
  const on = useMedia((s) => !!s.pipOpen[tabId]);
  return [on, (press) => void togglePictureInPicture(tabId, controlPress(press))];
}

useBrowser.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return;
  const m = useMedia.getState();
  const gone = [...new Set(PER_TAB.flatMap((k) => Object.keys(m[k])))].filter((id) => !s.tabs[id]);
  if (!gone.length) return;
  const next = Object.fromEntries(PER_TAB.map((k) => [k, { ...m[k] }])) as Store;
  for (const id of gone) for (const k of PER_TAB) delete next[k][id];
  useMedia.setState(next);
});

if (typeof __DEV__ !== "undefined" && __DEV__) {
  (globalThis as { acMedia?: unknown }).acMedia = { useMedia, mediaCommand, setNowPlaying, togglePictureInPicture, inPictureInPicture, playerTabFor };
}

export const dismissPlayer = (tabId: string) => useMedia.setState((m) => ({ dismissed: { ...m.dismissed, [tabId]: true } }));

const NO_HIDDEN: string[] = [];

export const useHiddenPlayerTabs = (windowId: string, spaceId: string, sessions: string[]) =>
  useBrowser(
    useShallow((s) => {
      const w = s.windows[windowId];
      if (!sessions.length || !w) return NO_HIDDEN;
      const ids = sessions.filter((id) => s.tabs[id]?.windowId === windowId && s.tabs[id]!.spaceId === spaceId && isHiddenPlayerTab(s, id));
      return ids.length > 1 ? ids.sort((a, b) => w.tabIds.indexOf(a) - w.tabIds.indexOf(b)) : ids;
    }),
  );

export const usePinnedWithMediaControls = (tabId: string | undefined) => useBrowser((s) => !!tabId && !!s.tabs[tabId]?.pin && s.settings.sidebarMediaControls);
