import { create } from "zustand";
import {
  broadcastOnControlSocket,
  onControlClose,
  onControlRequest,
  onControlWritten,
  replyOnControlSocket,
  startControlSocket,
  stopControlSocket,
  type ControlRequest,
  type ControlSocketStatus,
} from "../../platform/automation";
import { systemInfo } from "../../platform/app";
import { useBrowser } from "../browser/store";
import { NoCommandWindowError, runCommand } from "../commands/commands";
import { noteCliCaller, noteSocketRun, noteSocketServing } from "../app/cliControl";
import { parseCliCaller, type CliCaller } from "../app/cliCaller";
import { errorText } from "../../lib/errors";
import { minimizedUrl } from "../../lib/urlParts";
import { automationWindows, type AutomationWindow } from "./automationWindows";
import { cliTabTargets } from "../../platform/cli";
import { TAB_IDLE_EVENTS, USER_IDLE_EVENTS, type AutomationEventName } from "./eventNames";
import { commands, failure, hello, parseRequest, parseSubscription, planRun, type RequestId, type Subscription } from "./automationMethods";
import { feedNeeds, stopFeed, updateFeed } from "./automationFeed";
import { answerDecision, dropResponder, serveHooks, stopResponders } from "./decideSocket";
import { launchToReplay, recordLaunch, runLaunchActions } from "./lifecycleEvents";
import { startDecideHooks } from "./decideHooks";
import { offscreenMethod } from "./offscreen";
import { applyMethod, workspaceMethod } from "./workspaceMethods";

export const useControlSocket = create<{ status: ControlSocketStatus | null }>()(() => ({ status: null }));

let generation: number | null = null;
let applied = false;
let chain: Promise<void> = Promise.resolve();
let listening = false;
const subscriptions = new Map<number, Subscription>();
const launchSent = new Set<number>();
const unwrittenRuns = new Set<number>();
const callers = new Map<number, CliCaller>();
let nextTicket = 0;

const controlOn = () => useBrowser.getState().settings.cliControl;

function send(connection: number, id: RequestId, body: Body, ticket = 0) {
  replyOnControlSocket(connection, JSON.stringify({ id, ...body }), ticket);
}

function runWritten(tickets: readonly number[]) {
  for (const ticket of tickets) if (unwrittenRuns.delete(ticket)) noteSocketRun(-1);
}

const minimized = (data: Record<string, unknown>) => (typeof data.url === "string" ? { ...data, url: minimizedUrl(data.url) } : data);

export function eventTargets(subs: ReadonlyMap<number, Subscription>, name: AutomationEventName, data: Record<string, unknown>) {
  const full: number[] = [];
  const plain: number[] = [];
  for (const [connection, sub] of subs) {
    if (!sub.events.has(name)) continue;
    if (TAB_IDLE_EVENTS.has(name) && !sub.tabIdle.has(data.idle as number)) continue;
    if (USER_IDLE_EVENTS.has(name) && !sub.userIdle.has(data.idle as number)) continue;
    (sub.fullUrls ? full : plain).push(connection);
  }
  return { full, plain };
}

function deliver(name: AutomationEventName, data: Record<string, unknown>, time = Date.now(), only?: number) {
  const { full, plain } = eventTargets(only === undefined ? subscriptions : new Map([[only, subscriptions.get(only)!]]), name, data);
  if (full.length) broadcastOnControlSocket(full, JSON.stringify({ event: name, time, data }));
  if (plain.length) broadcastOnControlSocket(plain, JSON.stringify({ event: name, time, data: minimized(data) }));
}

function broadcast(name: AutomationEventName, data: Record<string, unknown>) {
  if (generation === null) return;
  deliver(name, data);
}

function refreshFeed() {
  if (subscriptions.size) updateFeed(feedNeeds(subscriptions.values()), broadcast);
  else stopFeed();
}

function replayLaunch(connection: number) {
  const sub = subscriptions.get(connection);
  if (!sub?.events.has("app.launched") || launchSent.has(connection)) return;
  const launch = launchToReplay();
  if (!launch) return;
  launchSent.add(connection);
  setTimeout(() => {
    if (subscriptions.get(connection)?.events.has("app.launched")) deliver("app.launched", launch.data, launch.time, connection);
  }, 0);
}

type Body = { result: unknown } | { error: unknown };

export function handleControlRequest({ connection, generation: tagged, line }: ControlRequest) {
  const request = parseRequest(line);
  if ("error" in request) return send(connection, request.id, { error: request.error });
  const { id, method, params } = request;
  if (tagged !== generation || !controlOn()) return send(connection, id, failure("failed", "Control is off."));
  const ticket = method === "run" ? ++nextTicket : 0;
  const caller = callers.get(connection);
  if (ticket && caller) noteCliCaller(caller);
  if (ticket) {
    unwrittenRuns.add(ticket);
    noteSocketRun(1);
  }
  let body: Body | Promise<Body>;
  try {
    body = answer(connection, method, params);
  } catch (error) {
    body = failure("failed", errorText(error));
  }
  const reply = (settled: Body) => {
    try {
      send(connection, id, settled, ticket);
    } catch (error) {
      runWritten([ticket]);
      throw error;
    }
  };
  if (body instanceof Promise) void body.then(reply, (error) => reply(failure("failed", errorText(error))));
  else reply(body);
}

export async function windowsWithTargets(windows: AutomationWindow[]): Promise<AutomationWindow[]> {
  const ids = windows.flatMap((w) => w.tabs.map((t) => t.id));
  const targets = ids.length ? await cliTabTargets(ids).catch(() => null) : {};
  if (!targets) return windows;
  return windows.map((w) => ({
    ...w,
    tabs: w.tabs.map((t) => ({ ...t, targetId: targets[t.id]?.targetId ?? null, pageGeneration: targets[t.id]?.pageGeneration ?? 0 })),
  }));
}

function subscribe(connection: number, params: Record<string, unknown>): Body {
  const sub = parseSubscription(params);
  if ("error" in sub) return sub;
  const served = serveHooks(connection, sub.hooks);
  if ("error" in served) return failure("bad_request", served.error);
  if (sub.events.size) subscriptions.set(connection, sub);
  else subscriptions.delete(connection);
  refreshFeed();
  replayLaunch(connection);
  return { result: { ok: true, served: served.served, ...(sub.hooks === undefined || sub.hooks === null ? {} : { revisions: served.revisions }) } };
}

function answer(connection: number, method: string, params: Record<string, unknown>): Body | Promise<Body> {
  switch (method) {
    case "hello": {
      const caller = parseCliCaller(params.caller);
      if (caller) callers.set(connection, caller);
      return { result: hello(systemInfo().appVersion) };
    }
    case "caller": {
      const caller = callers.get(connection);
      if (caller) noteCliCaller(caller);
      return { result: { ok: !!caller } };
    }
    case "commands":
      return { result: commands() };
    case "windows":
      return windowsWithTargets(automationWindows(useBrowser.getState())).then((result) => ({ result }));
    case "workspace":
      return workspaceMethod(params);
    case "offscreen":
      return offscreenMethod(params);
    case "apply": {
      const serving = generation;
      return applyMethod(params, () => generation === serving && controlOn());
    }
    case "subscribe":
      return subscribe(connection, params);
    case "answer": {
      const answered = answerDecision(connection, params);
      return "error" in answered ? failure("bad_request", answered.error) : { result: answered };
    }
    case "run": {
      const plan = planRun(useBrowser.getState(), params);
      if ("error" in plan) return plan;
      try {
        runCommand({ command: plan.command, arg: plan.arg, windowId: plan.windowId }, { strictWindow: plan.windowId !== null, tabId: plan.tabId });
      } catch (error) {
        if (error instanceof NoCommandWindowError) return failure("no_window", error.message);
        throw error;
      }
      return { result: { ok: true } };
    }
  }
  return failure("unknown_method", `There's no method ${method}.`);
}

function handleClose({ connection }: { connection: number }) {
  launchSent.delete(connection);
  callers.delete(connection);
  dropResponder(connection);
  if (subscriptions.delete(connection)) refreshFeed();
}

function listen() {
  if (listening) return;
  listening = true;
  onControlRequest((request) => {
    try {
      handleControlRequest(request);
    } catch (error) {
      console.warn("[automation] a request failed", error);
    }
  });
  onControlClose(handleClose);
  onControlWritten(({ tickets }) => runWritten(tickets));
}

async function start() {
  listen();
  const status = await startControlSocket();
  useControlSocket.setState({ status });
  generation = status.state === "on" ? status.generation : null;
  noteSocketServing(generation !== null && controlOn());
  if (status.state !== "on") console.warn(`[automation] the control socket is off: ${status.reason ?? "unknown"}`);
}

async function stop() {
  generation = null;
  noteSocketServing(false);
  subscriptions.clear();
  launchSent.clear();
  callers.clear();
  stopResponders();
  stopFeed();
  await stopControlSocket();
  useControlSocket.setState({ status: null });
}

function sync() {
  const on = controlOn();
  if (on === applied) return;
  applied = on;
  if (!on) {
    generation = null;
    noteSocketServing(false);
    stopResponders();
    runWritten([...unwrittenRuns]);
  }
  chain = chain
    .then(() => (on ? start() : stop()))
    .catch((error: unknown) => {
      useControlSocket.setState({ status: { state: "off", generation: 0, path: "", reason: errorText(error) } });
      console.warn("[automation] the control socket failed", error);
    });
}

let started = false;

export function startAutomation() {
  if (started) return;
  started = true;
  startDecideHooks();
  recordLaunch();
  runLaunchActions();
  sync();
  useBrowser.subscribe((s, prev) => {
    if (s.settings !== prev.settings) sync();
  });
}
