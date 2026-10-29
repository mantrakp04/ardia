import { emitNativeEvent } from "./shims/expo-modules-core";
import { watchLeftEdge } from "./shims/web/motion/leftEdge";
import { unavailableError } from "./hostCapabilities.ts";
import type { BangListReply } from "../../../packages/shell/src/documents";

type ShellMethod = (...args: never[]) => unknown;

const resolved = () => Promise.resolve();

let escapeCapture: ((event: KeyboardEvent) => void) | null = null;

function setDragEscapeCapture(active: boolean) {
  if (escapeCapture) window.removeEventListener("keydown", escapeCapture, true);
  escapeCapture = null;
  if (!active) return Promise.resolve();
  escapeCapture = (event) => {
    if (event.key !== "Escape" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    emitNativeEvent("ArdiaShell", "onAppEvent", { type: "dragEscape" });
  };
  window.addEventListener("keydown", escapeCapture, true);
  return Promise.resolve();
}

const responders = new Map<number, HTMLElement>();
let lastResponder = 0;

function saveKeyResponder(_windowId: string) {
  const focused = document.activeElement;
  if (!document.hasFocus() || !(focused instanceof HTMLElement) || focused === document.body) return Promise.resolve(0);
  responders.set(++lastResponder, focused);
  return Promise.resolve(lastResponder);
}

function restoreKeyResponder(token: number) {
  const element = responders.get(token);
  responders.delete(token);
  if (!element?.isConnected) return Promise.resolve(false);
  element.focus({ preventScroll: true });
  return Promise.resolve(document.activeElement === element);
}

function discardKeyResponder(token: number) {
  responders.delete(token);
  return Promise.resolve();
}

const raisedFrom = new WeakMap<HTMLElement, string>();

function raiseView(tag: unknown, levels: number, raised: boolean) {
  let view = tag instanceof HTMLElement ? tag : null;
  for (let level = 0; view && level <= Math.max(0, levels); level++) {
    const parent: HTMLElement | null = view.parentElement;
    if (!parent) break;
    if (raised) {
      if (!raisedFrom.has(view)) raisedFrom.set(view, view.style.zIndex);
      const above = [...parent.children].filter((child) => child !== view).map((child) => Number.parseInt(getComputedStyle(child).zIndex, 10)).filter(Number.isFinite);
      view.style.zIndex = String(Math.max(0, ...above) + 1);
    } else if (raisedFrom.has(view)) {
      view.style.zIndex = raisedFrom.get(view)!;
      raisedFrom.delete(view);
    }
    view = parent;
  }
  return Promise.resolve();
}

const unavailable = (feature: string) => (..._args: unknown[]): Promise<never> => Promise.reject(unavailableError(feature));

export const fetchBangList: (etag: string | null) => Promise<BangListReply> = unavailable("Bang list fetching");

const LINUX_SHELL_METHODS: Record<string, ShellMethod> = {
  watchLeftEdge: (id: string, on: boolean, hold = 0) => {
    watchLeftEdge(id, on, hold);
    return Promise.resolve();
  },
  setDragEscapeCapture,
  saveKeyResponder,
  restoreKeyResponder,
  discardKeyResponder,
  cancelFocusMove: resolved,
  switcherPointerMoved: () => false,
  animateWindowClose: resolved,
  raiseView,
  dragPreviewBegin: resolved,
  dragPreviewPage: resolved,
  dragPreviewUpdate: resolved,
  dragPreviewPlaceholder: resolved,
  dragPreviewEnd: resolved,
  dragPreviewCancel: resolved,
  fetchBangList,
  startDictation: unavailable("Dictation"),
  pickFiles: unavailable("Choosing files to open"),
  replyToTerminate: resolved,
  readText: () => Promise.resolve(""),
};

export function linuxShellMethod(method: string): ShellMethod | undefined {
  return Object.hasOwn(LINUX_SHELL_METHODS, method) ? LINUX_SHELL_METHODS[method] : undefined;
}
