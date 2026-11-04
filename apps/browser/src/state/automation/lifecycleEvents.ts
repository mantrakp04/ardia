import { AppState } from "react-native";
import { onAppEvent } from "../../platform/app";
import { onSystemSleep, onSystemWake, onUserIdle } from "../../platform/systemSignals";
import { useBrowser } from "../browser/store";
import { runCommand } from "../commands/commands";
import { sessionRestoredAtLaunch } from "../session/persist";
import { focusedWindowOf } from "../windows/ui";
import { isApproved } from "./approvals";
import { parseLaunchAction } from "./launchActions";
import { eligibleKind, lastFocusedEligibleWindow } from "./automationWindows";
import { LAUNCH_REPLAY_MS } from "./eventNames";
import { launchActionApproval } from "./hookPolicy";
import { offerLaunchActions } from "./hookRules";
import type { EventSend } from "./storeEvents";

export type LaunchRecord = { time: number; monotonic: number; data: Record<string, unknown> };

let launch: LaunchRecord | null = null;
let launchActionsRan = false;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const launchIdNow = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

export function recordLaunch(): LaunchRecord {
  if (launch) return launch;
  const s = useBrowser.getState();
  const windows = s.windowOrder.filter((id) => eligibleKind(s, id));
  const focused = focusedWindowOf(s);
  launch = {
    time: Date.now(),
    monotonic: now(),
    data: { launchId: launchIdNow(), restored: sessionRestoredAtLaunch(), focusedWindowId: focused && eligibleKind(s, focused) ? focused : null, windows },
  };
  return launch;
}

export function launchToReplay(): LaunchRecord | null {
  if (!launch || now() - launch.monotonic > LAUNCH_REPLAY_MS) return null;
  return launch;
}

export function runLaunchActions() {
  if (launchActionsRan) return;
  launchActionsRan = true;
  const entries = useBrowser.getState().settings.launchActions;
  offerLaunchActions(entries);
  for (const entry of entries) {
    const approval = launchActionApproval(entry);
    if (approval && !isApproved(approval.key)) continue;
    const action = parseLaunchAction(entry);
    if (typeof action === "string") continue;
    const windowId = lastFocusedEligibleWindow(useBrowser.getState());
    try {
      runCommand({ command: action.command as never, arg: action.arg, windowId }, {});
    } catch (error) {
      console.warn(`[automation] launch action ${entry} failed`, error);
    }
  }
}

function signal(stops: (() => void)[], start: () => () => void) {
  try {
    stops.push(start());
  } catch (error) {
    console.warn("[automation] a system signal isn't available", error);
  }
}

export function startLifecycleEvents(send: EventSend, wants: ReadonlySet<string>): () => void {
  const stops: (() => void)[] = [];
  if (wants.has("app.quitting")) {
    const sub = onAppEvent((e) => {
      if (e.type === "willQuit") send("app.quitting", {});
    });
    stops.push(() => sub.remove());
  }
  if (wants.has("app.activated") || wants.has("app.deactivated")) {
    let last = AppState.currentState;
    const sub = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      if (active === (last === "active")) return;
      last = state;
      const name = active ? "app.activated" : "app.deactivated";
      if (wants.has(name)) send(name, {});
    });
    stops.push(() => sub.remove());
  }
  if (wants.has("system.sleep")) signal(stops, () => onSystemSleep(() => send("system.sleep", {})));
  if (wants.has("system.wake")) signal(stops, () => onSystemWake(() => send("system.wake", {})));
  return () => stops.forEach((stop) => stop());
}

export function startUserIdleEvents(send: EventSend, wants: ReadonlySet<string>, thresholds: ReadonlySet<number>): () => void {
  if (!wants.has("user.idle") && !wants.has("user.active")) return () => {};
  const stops: (() => void)[] = [];
  for (const threshold of thresholds) {
    signal(stops, () =>
      onUserIdle(threshold, (idle) => {
        const name = idle ? "user.idle" : "user.active";
        if (wants.has(name)) send(name, { idle: threshold });
      }),
    );
  }
  return () => stops.forEach((stop) => stop());
}
