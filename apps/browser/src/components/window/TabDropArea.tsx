import { fixupUrl } from "@ardia/core";
import { forwardRef, useEffect, useRef, type ReactNode } from "react";
import type { StyleProp, View, ViewStyle } from "react-native";
import { currentWindow } from "../../state/browser/current";
import { openDroppedUrls } from "../../state/drag/windowDrop";
import { installDroppedCrx } from "../../state/extensions/crxDrop";
import type { TabPlacement } from "../../state/pins/organize";
import { FileDropArea, type DroppedItem, type DropUpdate } from "../ui";

export type DropPoint = [number, number];
export type TabDropTarget = {
  windowId: string;
  enter(count: number, at: DropPoint, token: number): unknown;
  move(at: DropPoint, token: number): void;
  leave(token: number): void;
  drop(at: DropPoint, token: number): TabPlacement | null;
};

const MAX_DROPPED_TABS = 50;

export function droppedUrls(items: DroppedItem[]): string[] {
  const urls = items.flatMap((item) => {
    if (item.kind === "file") return /^file:\/\/\/[^/]/i.test(item.url) ? [item.url] : [];
    const raw = item.kind === "url" ? item.url.trim() : item.text.trim();
    const url = item.kind === "url" ? raw : /\s/.test(raw) ? null : fixupUrl(raw);
    return url && /^https?:\/\/[^/\s]/i.test(url) ? [url] : [];
  });
  return urls.slice(0, MAX_DROPPED_TABS);
}

let tokens = 0;

const originOf = (view: View | null): Promise<DropPoint> =>
  new Promise((resolve) => (view ? view.measureInWindow((x, y) => resolve([x, y])) : resolve([0, 0])));

type Props = { target: TabDropTarget; style?: StyleProp<ViewStyle>; children?: ReactNode };

export const TabDropArea = forwardRef<View, Props>(function TabDropArea({ target, style, children }, ref) {
  const view = useRef<View | null>(null);
  const latest = useRef(target);
  latest.current = target;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const origin = useRef<DropPoint>([0, 0]);
  const generation = useRef(++tokens);
  const inside = useRef(false);
  const run = <T,>(step: () => T | Promise<T>): Promise<T | null> => {
    const next = queue.current.then(step).catch(() => null);
    queue.current = next;
    return next;
  };
  const at = (e: DropUpdate): DropPoint => [origin.current[0] + e.x, origin.current[1] + e.y];
  const close = () => {
    const token = generation.current;
    generation.current = ++tokens;
    inside.current = false;
    return token;
  };

  useEffect(
    () => () => {
      if (!inside.current) return;
      const token = close();
      void run(() => latest.current.leave(token));
    },
    [],
  );

  const onDropUpdate = (e: DropUpdate) => {
    if (e.phase === "enter") {
      if (inside.current) {
        const stale = close();
        void run(() => latest.current.leave(stale));
      }
      const token = (generation.current = ++tokens);
      inside.current = true;
      void run(async () => {
        const measured = await originOf(view.current);
        if (token !== generation.current) return;
        origin.current = measured;
        await latest.current.enter(e.count, at(e), token);
      });
    } else if (e.phase === "move") {
      const token = generation.current;
      void run(() => {
        if (token === generation.current) latest.current.move(at(e), token);
      });
    } else if (e.phase === "exit") {
      const token = close();
      void run(() => latest.current.leave(token));
    } else {
      const token = generation.current;
      inside.current = false;
      const windowId = latest.current.windowId;
      const profileId = currentWindow(windowId)?.profileId;
      const urls = installDroppedCrx(windowId, droppedUrls(e.items));
      void run(() => {
        const current = token === generation.current;
        const placement = current ? latest.current.drop(at(e), token) : null;
        if (current) generation.current = ++tokens;
        if (profileId) openDroppedUrls(windowId, profileId, placement, urls);
      });
    }
  };

  return (
    <FileDropArea
      ref={(v) => {
        view.current = v;
        if (typeof ref === "function") ref(v);
        else if (ref) ref.current = v;
      }}
      style={style}
      onDropUpdate={onDropUpdate}
    >
      {children}
    </FileDropArea>
  );
});
