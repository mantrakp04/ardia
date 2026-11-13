import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { View } from "react-native";
import type { DropUpdate, DroppedItem, FileDropAreaProps } from "@ardia/shell";
import { requireNativeModule } from "../modules";
import type { FileDropModule } from "../nativeModuleTypes";

export type { DropUpdate, DroppedItem };
export type DropAccepts = NonNullable<FileDropAreaProps["accepts"]>;
export type DropPhase = DropUpdate["phase"];
export type WindowDrop = DropUpdate & { windowId: string; area: string; windowX: number; windowY: number };
export type WindowDrag = { windowId: string; phase: "enter" | "exit" };
export type DropAreaFrame = { windowId: string; area: string; depth: number; x: number; y: number; width: number; height: number; accepts: DropAccepts; enabled: boolean };


type Fiber = { return: Fiber | null; memoizedProps?: unknown };
type AreaEntry = { windowId: string; measure: () => void; deliver: (update: DropUpdate) => void };

const MOST_ANCESTORS = 4096;
const ACCEPTS: readonly DropAccepts[] = ["links", "linksAndText", "extensionPackages"];

const fileDrop = () => requireNativeModule<Pick<FileDropModule, "setDropArea" | "removeDropArea" | "addListener">>("ArdiaFileDrop");

const areas = new Map<string, AreaEntry>();
const windowIdsByRoot = new Map<number, string>();
let listening = false;
let nextArea = 0;

export const acceptsOf = (value: unknown): DropAccepts => (ACCEPTS.includes(value as DropAccepts) ? (value as DropAccepts) : "links");

function windowDropped(payload: unknown) {
  const drop = payload as Partial<WindowDrop> | null;
  if (!drop || typeof drop.area !== "string" || !drop.phase) return;
  areas.get(drop.area)?.deliver({ phase: drop.phase, x: drop.x ?? 0, y: drop.y ?? 0, count: drop.count ?? 0, items: drop.items ?? [] });
}

function windowDragged(payload: unknown) {
  const drag = payload as Partial<WindowDrag> | null;
  if (drag?.phase !== "enter") return;
  for (const area of areas.values()) if (!drag.windowId || !area.windowId || area.windowId === drag.windowId) area.measure();
}

function listen() {
  if (listening) return;
  listening = true;
  fileDrop().addListener("onWindowDrop", windowDropped);
  fileDrop().addListener("onWindowDrag", windowDragged);
}

export function windowIdOf(view: View | null, rootTag: number): string {
  const cached = windowIdsByRoot.get(rootTag);
  if (cached) return cached;
  let fiber = (view as unknown as { __internalInstanceHandle?: Fiber | null } | null)?.__internalInstanceHandle ?? null;
  let found = "";
  for (let steps = 0; fiber && steps < MOST_ANCESTORS; steps++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    const id = props && typeof props === "object" ? (props as { windowId?: unknown }).windowId : undefined;
    if (typeof id === "string" && id) found = id;
  }
  if (found) windowIdsByRoot.set(rootTag, found);
  return found;
}

export function useFileDropArea(view: RefObject<View | null>, rootTag: number, depth: number, accepts: DropAccepts, enabled: boolean, onDropUpdate: (update: DropUpdate) => void) {
  const area = useMemo(() => `drop-${++nextArea}`, []);
  const latest = useRef({ depth, accepts, enabled, onDropUpdate });
  latest.current = { depth, accepts, enabled, onDropUpdate };
  const registeredIn = useRef("");

  const measure = useCallback(() => {
    const node = view.current;
    if (!node || !areas.has(area)) return;
    node.measureInWindow((x, y, width, height) => {
      const entry = areas.get(area);
      if (!entry) return;
      const windowId = windowIdOf(view.current, rootTag);
      entry.windowId = windowId;
      registeredIn.current = windowId;
      const current = latest.current;
      fileDrop().setDropArea({ windowId, area, depth: current.depth, x, y, width, height, accepts: current.accepts, enabled: current.enabled });
    });
  }, [area, rootTag, view]);

  useEffect(() => {
    listen();
    areas.set(area, { windowId: "", measure, deliver: (update) => latest.current.onDropUpdate(update) });
    measure();
    return () => {
      areas.delete(area);
      fileDrop().removeDropArea(registeredIn.current, area);
    };
  }, [area, measure]);

  useEffect(() => measure(), [measure, depth, accepts, enabled]);

  return measure;
}
