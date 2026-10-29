import type { CommandEvent, MenuItem } from "@ardia-real/shell";
import type { ArdiaHost } from "./host";
import { hostSupports, invokeHost } from "./host.ts";
import { privateWindowEntries } from "./hostPrivateWindows.ts";

export type WindowMenuWindow = { id: string; title: string; current?: boolean };
type WindowMenuState = { windowOrder: readonly string[]; windows: Record<string, { kind?: string } | undefined> };

export function windowMenuWindows<S extends WindowMenuState>(
  state: S,
  windowId: string,
  title: (state: S, id: string) => string,
  utility: (id: string) => boolean,
): WindowMenuWindow[] {
  return state.windowOrder
    .filter((id) => {
      const w = state.windows[id];
      if (!w || utility(id)) return false;
      return id === windowId || w.kind === "main";
    })
    .map((id) => (id === windowId ? { id, title: title(state, id), current: true } : { id, title: title(state, id) }));
}

export function mergeableWindows(state: WindowMenuState, utility: (id: string) => boolean) {
  return state.windowOrder.filter((id) => {
    const w = state.windows[id];
    return w?.kind === "main" && !utility(id);
  }).length >= 2;
}

export function windowMenuItems(input: { windowId: string; windows: WindowMenuWindow[]; privateWindows: unknown; taskManager: boolean; canMerge: boolean }): MenuItem[] {
  const listed = new Set(input.windows.map((w) => w.id));
  const privateWindows = privateWindowEntries(input.privateWindows, input.windowId).filter((w) => !listed.has(w.id));
  return [
    { id: "minimize", title: "Minimize" },
    { id: "maximize", title: "Maximize" },
    { separator: true },
    { id: "command:downloads", title: "Downloads" },
    ...(input.taskManager ? [{ id: "command:taskManager", title: "Task Manager" }] : []),
    { id: "command:mergeAllWindows", title: "Merge All Windows", enabled: input.canMerge },
    { separator: true },
    ...input.windows.map((w) => ({ id: `focus:${w.id}`, title: w.title, ...(w.current ? { checked: true } : {}) })),
    ...privateWindows.map((w) => ({ id: `focus:${w.id}`, title: w.title })),
  ];
}

export type WindowMenuDeps<S extends WindowMenuState> = {
  state: () => S;
  title: (state: S, id: string) => string;
  utility: (id: string) => boolean;
  show: (items: MenuItem[]) => Promise<string | null>;
  command: (event: CommandEvent) => void;
};

export function createWindowMenu<S extends WindowMenuState>(host: ArdiaHost, deps: WindowMenuDeps<S>) {
  const own = host.bootstrap.windowId;
  const call = (method: string, id: string) => invokeHost(`ArdiaShell.${method}`, { args: [id] }, host);
  return {
    async open(windowId: string) {
      if (windowId !== own || deps.utility(windowId)) return false;
      const privateWindows = await invokeHost("ArdiaShell.privateWindows", { args: [] }, host).catch(() => []);
      const state = deps.state();
      const items = windowMenuItems({
        windowId,
        windows: windowMenuWindows(state, windowId, deps.title, deps.utility),
        canMerge: mergeableWindows(state, deps.utility),
        privateWindows,
        taskManager: hostSupports("engine.openTaskManager", host),
      });
      const choice = await deps.show(items);
      const chosen = items.find((item) => "id" in item && item.id === choice && item.enabled !== false);
      if (!chosen || !("id" in chosen)) return true;
      if (chosen.id === "minimize") await call("minimizeWindow", windowId);
      else if (chosen.id === "maximize") await call("toggleMaximizeWindow", windowId);
      else if (chosen.id.startsWith("focus:")) await call("focusWindow", chosen.id.slice("focus:".length));
      else if (chosen.id.startsWith("command:")) deps.command({ command: chosen.id.slice("command:".length) as CommandEvent["command"], arg: null, windowId });
      return true;
    },
  };
}
