import type { ArdiaHost } from "./host";
import { invokeHost } from "./host.ts";

export type PrivateWindowEntry = { id: string; title: string };

const WINDOW_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function privateWindowEntries(reply: unknown, own: string): PrivateWindowEntry[] {
  if (!Array.isArray(reply)) return [];
  const ids = new Map<string, number | null>();
  for (const entry of reply) {
    const { id, ordinal } = entry && typeof entry === "object" ? entry as { id?: unknown; ordinal?: unknown } : {};
    if (typeof id === "string" && WINDOW_ID.test(id) && id !== own && !ids.has(id))
      ids.set(id, Number.isSafeInteger(ordinal) && (ordinal as number) > 0 ? ordinal as number : null);
  }
  const label = (ordinal: number) => ordinal > 1 ? `Private Window ${ordinal}` : "Private Window";
  return [...ids].map(([id, ordinal], index) => ({ id, title: label(ordinal ?? index + 1) }));
}

export function watchHostPrivateWindows(host: ArdiaHost, onChange: (windows: PrivateWindowEntry[]) => void) {
  let generation = 0;
  let stopped = false;
  const refresh = () => {
    const current = ++generation;
    const settle = (windows: PrivateWindowEntry[]) => {
      if (!stopped && current === generation) onChange(windows);
    };
    void invokeHost("ArdiaShell.privateWindows", { args: [] }, host).then(
      (reply) => settle(privateWindowEntries(reply, host.bootstrap.windowId)),
      () => settle([]),
    );
  };
  const unsubscribe = host.onEvent((module, event) => {
    if (module === "ArdiaShell" && event === "privateWindows") refresh();
  });
  refresh();
  return {
    focus: (id: string) => invokeHost("ArdiaShell.focusWindow", { args: [id] }, host),
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}
