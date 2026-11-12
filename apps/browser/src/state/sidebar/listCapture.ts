import type { BrowserState } from "../browser/store";

export type ListSnapshot = { state: BrowserState; list: string[] };
export type Capture = { state: BrowserState | null; list: string[] | null; pending: ListSnapshot | null };

export const newCapture = (): Capture => ({ state: null, list: null, pending: null });

export function capture<T>(into: Capture, s: BrowserState, list: string[], value: T): T {
  if (into.list && into.state && list !== into.list && !into.pending) into.pending = { state: into.state, list: into.list };
  into.list = list;
  into.state = s;
  return value;
}
