import type { ControlPress, DisplayMediaRequest, MediaCommand, NowPlaying, PictureInPictureState } from "@ardia/ardiacore";
import { useEffect, useState } from "react";
import type { AccessibilityActionEvent, GestureResponderEvent } from "react-native";
import { create } from "zustand";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import type { BrowserState } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { peekTabId } from "../../store/peek";
import { splitOf } from "../../store/splits";

export type Session = NowPlaying & {
  playedAt: number;
};

type Store = {
  sessions: Record<string, Session>;
  dismissed: Record<string, true>;
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

export const useMedia = create<Store>()(() => ({ sessions: {}, dismissed: {}, pip: {}, pipOpen: {}, displayRequests: {}, tabShares: {} }));

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
  void webviews.get(tabId)?.mediaCommand(action, seconds);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export const hasTrackControls = (session: Session) => session.actions.includes("nexttrack") || session.actions.includes("previoustrack");

export const SKIP_SECONDS = 15;

export function isTabShown(s: BrowserState, tabId: string, profileId?: string): boolean {
  const windowId = s.tabs[tabId]?.windowId;
  if (!windowId) return false;
  const active = activeTabId(s, windowId, profileId);
  if (!active) return false;
  return active === tabId || peekTabId(s, windowId) === tabId || !!splitOf(s, active)?.tabIds.includes(tabId);
}

export function playerTabFor(m: Pick<Store, "sessions" | "dismissed">, tabIds: string[], current?: string): string | undefined {
  const eligible = (id: string) => {
    const session = m.sessions[id];
    return !!session && session.controllable && !m.dismissed[id] && !!session.playedAt && session.playbackState !== "none";
  };
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
  const keys = ["sessions", "dismissed", "pip", "pipOpen", "displayRequests", "tabShares"] as const;
  const gone = [...new Set(keys.flatMap((k) => Object.keys(m[k])))].filter((id) => !s.tabs[id]);
  if (!gone.length) return;
  const next = Object.fromEntries(keys.map((k) => [k, { ...m[k] }])) as Pick<Store, (typeof keys)[number]>;
  for (const id of gone) for (const k of keys) delete next[k][id];
  useMedia.setState(next);
});

if (typeof __DEV__ !== "undefined" && __DEV__) {
  (globalThis as { acMedia?: unknown }).acMedia = { useMedia, mediaCommand, setNowPlaying, togglePictureInPicture, inPictureInPicture, playerTabFor };
}
