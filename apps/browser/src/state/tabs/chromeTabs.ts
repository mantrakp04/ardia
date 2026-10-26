import { chromeWindows, devWindowAction } from "../../platform/windows";
import { engineInfo } from "../../platform/app";
import {
  onTabStripTransaction,
  sendTabStripCommand,
  tabStrips,
  type StripState,
  type TabStripCommand,
  type TabStripTransaction,
} from "../../platform/tabs";
import { useBrowser, type BrowserState } from "../browser/store";
import { changedIds } from "../browser/changes";
import { chromeChanged, groupStep, stripActual, stripPlan, type GroupBindings } from "./liveTabs";

let started = false;
const mirror = new Map<number, StripState>();
let lastRev = -1;
let early: TabStripTransaction[] = [];
const seen = new Set<string>();
type Kind = "arrange" | "activate" | "group";
const inflight = new Map<number, { kind: Kind; cmd: number; keys?: string[]; makes?: string; successor?: boolean; moves?: boolean }>();
const groups: GroupBindings = new Map();
const tried = new Map<string, { sig: string; since: number }>();
const changedAt = new Map<number, number>();
const madeInFront = new Map<number, { browser: number; over: string | null }>();

if (__DEV__) {
  (globalThis as { acChromeTabs?: unknown }).acChromeTabs = {
    chromeWindows,
    engineInfo,
    devWindowAction,
    strips: () => [...mirror.values()],
    state: () => ({ lastRev, inflight: Object.fromEntries(inflight), tried: Object.fromEntries(tried), groups: Object.fromEntries(groups) }),
  };
}

export function startChromeTabs() {
  if (started) return;
  started = true;
  onTabStripTransaction((tx) => (lastRev < 0 ? early.push(tx) : receive(tx)));
  void tabStrips().then((snapshot) => {
    for (const strip of snapshot.strips) {
      mirror.set(strip.strip, strip);
      for (const t of strip.tabs) if (t.key) seen.add(t.key);
    }
    lastRev = snapshot.rev;
    const queued = early;
    early = [];
    for (const tx of queued) receive(tx);
    scheduleProject();
  });
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows || s.groups !== prev.groups || placed(s, prev)) scheduleProject();
  });
}

function placed(s: BrowserState, prev: BrowserState) {
  return changedIds(s.tabs, prev.tabs).some((id) => {
    const a = s.tabs[id];
    const b = prev.tabs[id];
    return !a || !b || a.windowId !== b.windowId || a.profileId !== b.profileId || a.pinned !== b.pinned;
  });
}

function receive(tx: TabStripTransaction) {
  if (tx.rev <= lastRev) return;
  lastRev = tx.rev;
  for (const [strip, f] of inflight) {
    if (f.cmd !== tx.cmd) continue;
    inflight.delete(strip);
    const made = f.makes && tx.strips.find((x) => x.strip === strip)?.tabs.find((t) => t.key === f.keys?.[0])?.group;
    if (made && f.makes) groups.set(made, f.makes);
  }
  const start = useBrowser.getState();
  let s = start;
  for (const strip of tx.strips) {
    const before = mirror.get(strip.strip);
    if (strip.closed) {
      mirror.delete(strip.strip);
      madeInFront.delete(strip.strip);
    } else mirror.set(strip.strip, strip);
    if (tx.cmd === null || tx.cmd < 0) changedAt.set(strip.strip, tx.rev);
    if (tx.cmd === null) {
      const waiting = inflight.get(strip.strip);
      const siblings = [...mirror.values()].filter((x) => x.window === strip.window && x.strip !== strip.strip);
      const made = strip.tabs.find((t) => t.active && !t.key && !before?.tabs.some((b) => b.browser === t.browser));
      if (made) madeInFront.set(strip.strip, { browser: made.browser, over: stripPlan(s, strip)?.active ?? null });
      s = chromeChanged(s, before, strip, {
        seen,
        siblings,
        groups,
        pending: {
          arranged: new Set(waiting?.kind === "arrange" ? waiting.keys : []),
          regrouped: new Set(waiting?.kind === "group" && waiting.moves ? waiting.keys : []),
          grouped: new Set(waiting?.kind === "group" ? waiting.keys : []),
          active: waiting?.kind === "activate" && !waiting.successor,
        },
      });
    }
    for (const t of strip.tabs) if (t.key) seen.add(t.key);
  }
  if (seen.size > 2 * Object.keys(s.tabs).length + 64) for (const key of seen) if (!s.tabs[key]) seen.delete(key);
  if (s !== start) useBrowser.setState(s);
  scheduleProject();
}

let projectQueued = false;

function scheduleProject() {
  if (projectQueued || lastRev < 0) return;
  projectQueued = true;
  queueMicrotask(() => {
    projectQueued = false;
    project(useBrowser.getState());
  });
}

function project(s: BrowserState) {
  for (const strip of mirror.values()) {
    if (inflight.has(strip.strip)) continue;
    const plan = stripPlan(s, strip);
    if (!plan) continue;
    const actual = stripActual(strip, plan);
    const order = `${plan.keys.join(",")}|${plan.pinned}`;
    const made = madeInFront.get(strip.strip);
    const unadopted = !!made && plan.active === made.over && strip.tabs.some((t) => t.browser === made.browser && t.active && !t.key);
    if (made && !unadopted) madeInFront.delete(strip.strip);
    const step = groupStep(s, strip, groups);
    const group = () => {
      const { makes, ...rest } = step!;
      const moves = step!.group === null || step!.group === "new" || step!.title === undefined;
      send(strip.strip, "group", JSON.stringify(step), { op: "group", strip: strip.strip, ...rest }, makes, undefined, moves);
    };
    if (plan.active && plan.active !== actual.active && !unadopted) {
      const successor = !!actual.active && !s.tabs[actual.active];
      send(strip.strip, "activate", plan.active, { op: "activate", strip: strip.strip, key: plan.active }, undefined, successor);
    } else if (step?.group === null && !sentAlready(strip.strip, "group", JSON.stringify(step))) {
      group();
    } else if (order !== `${actual.keys.join(",")}|${actual.pinned}`) {
      send(strip.strip, "arrange", order, { op: "arrange", strip: strip.strip, keys: plan.keys, pinned: plan.pinned });
    } else if (step) group();
  }
}

function sentAlready(strip: number, kind: Kind, sig: string) {
  const last = tried.get(`${strip}:${kind}`);
  return last?.sig === sig && last.since === (changedAt.get(strip) ?? 0);
}

function send(strip: number, kind: Kind, sig: string, command: TabStripCommand, makes?: string, successor?: boolean, moves?: boolean) {
  if (sentAlready(strip, kind, sig)) return;
  tried.set(`${strip}:${kind}`, { sig, since: changedAt.get(strip) ?? 0 });
  inflight.set(strip, { kind, cmd: sendTabStripCommand(command), ...(command.op !== "activate" ? { keys: command.keys } : {}), makes, successor, moves });
}
