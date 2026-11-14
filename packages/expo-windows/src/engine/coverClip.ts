import { createContext, type Ref } from "react";
import type { NativeMethods } from "react-native";
import { setCover, type Box } from "./covers";

export type Measurable = Pick<NativeMethods, "measureInWindow">;

export type CoverClip = { node: () => Measurable | null; watch(listener: () => void): () => void };

export const CoverClips = createContext<readonly CoverClip[]>([]);

export function assignRef<Node>(target: Ref<Node> | undefined, node: Node | null) {
  if (typeof target === "function") target(node);
  else if (target) target.current = node;
}

export function coverClip(node: () => Measurable | null): CoverClip & { moved(): void } {
  const listeners = new Set<() => void>();
  return {
    node,
    watch(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    moved() {
      for (const listener of [...listeners]) listener();
    },
  };
}

export function watchClips(clips: readonly CoverClip[], listener: () => void): () => void {
  const unwatch = clips.map((clip) => clip.watch(listener));
  return () => unwatch.forEach((stop) => stop());
}

export function clipBox(box: Box, clips: readonly Box[]): Box | null {
  let left = box.x;
  let top = box.y;
  let right = box.x + box.width;
  let bottom = box.y + box.height;
  for (const clip of clips) {
    left = Math.max(left, clip.x);
    top = Math.max(top, clip.y);
    right = Math.min(right, clip.x + clip.width);
    bottom = Math.min(bottom, clip.y + clip.height);
  }
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

const boxOf = (node: Measurable) => new Promise<Box>((resolve) => node.measureInWindow((x, y, width, height) => resolve({ x, y, width, height })));

export function coverMeasurer(windowId: string, id: string, radius: number, node: () => Measurable | null, clips: readonly CoverClip[]) {
  let latest = 0;
  let stopped = false;
  return {
    async measure() {
      const own = node();
      if (!own || stopped) return;
      const asked = ++latest;
      const clipNodes = clips.map((clip) => clip.node()).filter((clip): clip is Measurable => !!clip);
      const [box, ...clipBoxes] = await Promise.all([own, ...clipNodes].map(boxOf));
      if (stopped || asked !== latest || node() !== own) return;
      const visible = clipBox(box!, clipBoxes);
      setCover(windowId, id, visible && { ...visible, radius });
    },
    stop() {
      stopped = true;
    },
  };
}
