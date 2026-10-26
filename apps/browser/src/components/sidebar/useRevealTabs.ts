import { useEffect, type RefObject } from "react";
import type { ScrollView, View } from "react-native";
import { watchRevealTargets } from "../../state/sidebar/reveal";
import { measureRow } from "../../state/sidebar/sidebarUi";
import { revealSpot } from "../../state/sidebar/geometry";
import type { SidebarGeometry } from "./pageLayout";

export function useRevealTabs(windowId: string, scroll: RefObject<ScrollView | null>, scrollY: RefObject<number>, geometry: RefObject<SidebarGeometry>) {
  useEffect(() => {
    let switched: string | null = null;
    let opened: string | null = null;
    let frame = 0;
    let reveals = 0;
    const show = (y: number, height: number) => {
      const top = scrollY.current ?? 0;
      const { viewport, room, pad } = geometry.current;
      if (y - top < room) scroll.current?.scrollTo({ y: Math.max(0, y - pad), animated: true });
      else if (y + height - top > viewport - 8) scroll.current?.scrollTo({ y: y + height - viewport + 8, animated: true });
    };
    const reveal = () => {
      frame = 0;
      if (!geometry.current.viewport || !scroll.current) return;
      const mine = ++reveals;
      const tabId = switched ?? opened;
      switched = opened = null;
      if (!tabId) return;
      const spot = revealSpot(windowId, tabId, geometry.current.tilesFixed, geometry.current.newTabAtTop);
      if (!spot) return;
      if ("span" in spot) return show(geometry.current.pad + geometry.current.regions[spot.span.section] + spot.span.top, spot.span.height);
      const view = scroll.current as unknown as View;
      const keys = spot.keys;
      const firstShown = (i: number): Promise<Awaited<ReturnType<typeof measureRow>>> =>
        i >= keys.length ? Promise.resolve(null) : measureRow(windowId, keys[i]!).then((row) => row ?? firstShown(i + 1));
      void firstShown(0).then((row) =>
        view.measureInWindow((_x, y) => row && mine === reveals && show(row.y - y + (scrollY.current ?? 0), row.height)),
      );
    };
    const schedule = () => {
      if ((switched || opened) && !frame) frame = requestAnimationFrame(reveal);
    };
    const unsubscribe = watchRevealTargets(windowId, (nowSwitched, nowOpened) => {
      if (nowSwitched) switched = nowSwitched;
      if (nowOpened) opened = nowOpened;
      schedule();
    });
    geometry.current.laidOut = schedule;
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      geometry.current.laidOut = undefined;
    };
  }, [windowId]);
}
