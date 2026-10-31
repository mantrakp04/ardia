import type { CommandEvent } from "@ardia/shell";

export const BROWSER_COMMAND_CHANNEL = "ardia-browser-commands";
export const BROWSER_WINDOW_COMMANDS: ReadonlySet<string> = new Set(["showOnboarding", "toolTour", "videoTour", "releaseNotes", "sendFeedback"]);

type Command = CommandEvent["command"];
type RouteMessage =
  | { type: "find"; request: string }
  | { type: "here"; request: string; windowId: string; order: string[] }
  | { type: "run"; request: string; windowId: string; command: Command }
  | { type: "claim"; request: string; windowId: string }
  | { type: "go"; request: string; windowId: string };

export type RouteChannel = {
  postMessage(message: RouteMessage): void;
  addEventListener(type: "message", listener: (event: { data: RouteMessage }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: RouteMessage }) => void): void;
};

type FocusState = {
  ui: { focusOrder: readonly string[] };
  windowOrder: readonly string[];
  windows: Record<string, { kind?: string } | undefined>;
};

export function regularFocusOrder(state: FocusState): string[] {
  const regular = (id: string) => state.windows[id]?.kind === "main";
  return [...new Set([...state.ui.focusOrder, ...state.windowOrder])].filter(regular);
}

export function serveBrowserCommands(options: {
  windowId: string;
  channel: RouteChannel;
  order: () => string[];
  run: (windowId: string, command: Command) => void;
  focus: (windowId: string) => Promise<unknown>;
  claimMs?: number;
}) {
  const { windowId, channel, order, run, focus } = options;
  const claimMs = options.claimMs ?? 1500;
  const claimed = new Map<string, { command: Command; timer: ReturnType<typeof setTimeout> }>();
  const listener = ({ data }: { data: RouteMessage }) => {
    if (data?.type === "find") channel.postMessage({ type: "here", request: data.request, windowId, order: order() });
    if (data?.type === "find" || data?.windowId !== windowId) return;
    if (data.type === "run" && BROWSER_WINDOW_COMMANDS.has(data.command) && !claimed.has(data.request)) {
      claimed.set(data.request, { command: data.command, timer: setTimeout(() => claimed.delete(data.request), claimMs) });
      channel.postMessage({ type: "claim", request: data.request, windowId });
    }
    if (data.type === "go") {
      const pending = claimed.get(data.request);
      if (!pending) return;
      clearTimeout(pending.timer);
      claimed.delete(data.request);
      void focus(windowId).catch(() => {});
      run(windowId, pending.command);
    }
  };
  channel.addEventListener("message", listener);
  return {
    remove: () => {
      channel.removeEventListener("message", listener);
      for (const { timer } of claimed.values()) clearTimeout(timer);
      claimed.clear();
    },
  };
}

export function routeToBrowserWindow(options: {
  channel: RouteChannel;
  command: Command;
  request?: string;
  gatherMs?: number;
  answerMs?: number;
}): Promise<string | null> {
  const { channel, command } = options;
  const request = options.request ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const gatherMs = options.gatherMs ?? 150;
  const answerMs = options.answerMs ?? 1500;
  return new Promise((resolve) => {
    const replies: { windowId: string; order: string[] }[] = [];
    let chosen: string | null = null;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (windowId: string | null) => {
      settled = true;
      clearTimeout(timer);
      channel.removeEventListener("message", listener);
      resolve(windowId);
    };
    const listener = ({ data }: { data: RouteMessage }) => {
      if (settled || data?.request !== request) return;
      if (data.type === "here" && !chosen) replies.push({ windowId: data.windowId, order: Array.isArray(data.order) ? data.order : [] });
      if (data.type === "claim" && data.windowId === chosen) {
        channel.postMessage({ type: "go", request, windowId: chosen });
        finish(chosen);
      }
    };
    channel.addEventListener("message", listener);
    timer = setTimeout(() => {
      const serving = new Set(replies.map((reply) => reply.windowId));
      const order = replies.find((reply) => reply.order.length)?.order ?? [];
      chosen = order.find((id) => serving.has(id)) ?? null;
      if (!chosen) return finish(null);
      timer = setTimeout(() => finish(null), answerMs);
      channel.postMessage({ type: "run", request, windowId: chosen, command });
    }, gatherMs);
    channel.postMessage({ type: "find", request });
  });
}
