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
import { noteSocketRun, noteSocketServing } from "../app/cliControl";
import { errorText } from "../../lib/errors";
import { automationWindows } from "./automationWindows";
import { startEventFeed, stopEventFeed, type AutomationEventName } from "./automationEvents";
import { commands, failure, hello, parseRequest, parseSubscription, planRun, type RequestId, type Subscription } from "./automationMethods";

export const useControlSocket = create<{ status: ControlSocketStatus | null }>()(() => ({ status: null }));

let generation: number | null = null;
let applied = false;
let chain: Promise<void> = Promise.resolve();
let listening = false;
const subscriptions = new Map<number, Subscription>();
const unwrittenRuns = new Set<number>();
let nextTicket = 0;

const controlOn = () => useBrowser.getState().settings.cliControl;

function send(connection: number, id: RequestId, body: Body, ticket = 0) {
  replyOnControlSocket(connection, JSON.stringify({ id, ...body }), ticket);
}

function runWritten(tickets: readonly number[]) {
  for (const ticket of tickets) if (unwrittenRuns.delete(ticket)) noteSocketRun(-1);
}

function broadcast(name: AutomationEventName, data: Record<string, unknown>) {
  const targets: number[] = [];
  for (const [connection, events] of subscriptions) if (events.has(name)) targets.push(connection);
  if (targets.length) broadcastOnControlSocket(targets, JSON.stringify({ event: name, time: Date.now(), data }));
}

function updateFeed() {
  if (subscriptions.size) startEventFeed(broadcast);
  else stopEventFeed();
}

type Body = { result: unknown } | { error: unknown };

export function handleControlRequest({ connection, generation: tagged, line }: ControlRequest) {
  const request = parseRequest(line);
  if ("error" in request) return send(connection, request.id, { error: request.error });
  const { id, method, params } = request;
  if (tagged !== generation || !controlOn()) return send(connection, id, failure("failed", "Control is off."));
  const ticket = method === "run" ? ++nextTicket : 0;
  if (ticket) {
    unwrittenRuns.add(ticket);
    noteSocketRun(1);
  }
  let body: Body;
  try {
    body = answer(connection, method, params);
  } catch (error) {
    body = failure("failed", errorText(error));
  }
  try {
    send(connection, id, body, ticket);
  } catch (error) {
    runWritten([ticket]);
    throw error;
  }
}

function answer(connection: number, method: string, params: Record<string, unknown>): Body {
  switch (method) {
    case "hello":
      return { result: hello(systemInfo().appVersion) };
    case "commands":
      return { result: commands() };
    case "windows":
      return { result: automationWindows(useBrowser.getState()) };
    case "subscribe": {
      const events = parseSubscription(params);
      if ("error" in events) return events;
      if (events.size) subscriptions.set(connection, events);
      else subscriptions.delete(connection);
      updateFeed();
      return { result: { ok: true } };
    }
    case "run": {
      const plan = planRun(useBrowser.getState(), params);
      if ("error" in plan) return plan;
      try {
        runCommand({ command: plan.command, arg: plan.arg, windowId: plan.windowId }, { strictWindow: plan.windowId !== null });
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
  if (subscriptions.delete(connection)) updateFeed();
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
  stopEventFeed();
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
  sync();
  useBrowser.subscribe((s, prev) => {
    if (s.settings !== prev.settings) sync();
  });
}
