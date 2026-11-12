import { requireNativeModule } from "../modules";
import { hostPath, pressThroughTitleBand, type HostFiber } from "../windowDragRegion";
import { expectEqual, expectTrue, type Check } from "./check";

type Regions = { rootTag: number; scale: number; nonClient: boolean; kind: string; titleBand: string; maximized: boolean; titleBarHeight: number; caption: number[][]; passthrough: number[][] };

type CaptionRegion = [left: number, top: number, rightInset: number, height: number];

type WindowDragging = {
  windowIds(): Promise<string[]>;
  setCaptionRegions(id: string, regions: CaptionRegion[]): Promise<void>;
  minimizeWindow(id: string): Promise<void>;
  toggleMaximizeWindow(id: string): Promise<void>;
  watchSidebarEdge(id: string, on: boolean, hold: number, right: boolean, whilePressed: boolean): Promise<void>;
  debugDragRegions(id: string): Promise<Regions | null>;
  debugSidebarEdgeWatch(): Promise<EdgeWatch | null>;
};

type EdgeWatch = { running: boolean; windows: string[] };

const windows = () => requireNativeModule<WindowDragging>("ArdiaAppWindows");

const HOST = 5;
const FUNCTION_COMPONENT = 0;
const GUTTER: CaptionRegion = [0, 0, 0, 9];
const SPACER: CaptionRegion = [-136, 0, 111, 45];

const host = (props: Record<string, unknown>, parent: HostFiber | null): HostFiber => ({ tag: HOST, type: "RCTView", return: parent, memoizedProps: props, stateNode: null });
const component = (parent: HostFiber | null): HostFiber => ({ tag: FUNCTION_COMPONENT, type: () => null, return: parent, memoizedProps: {}, stateNode: null });

const overlaps = (a: number[], b: number[]) => a[0]! < b[0]! + b[2]! && b[0]! < a[0]! + a[2]! && a[1]! < b[1]! + b[3]! && b[1]! < a[1]! + a[3]!;
const near = (value: number | undefined, wanted: number) => value !== undefined && Math.abs(value - wanted) <= 2;

async function browserWindow() {
  const ids = await windows().windowIds();
  expectTrue(ids.length > 0, "no window is open");
  const id = ids[0]!;
  const regions = await windows().debugDragRegions(id);
  expectTrue(regions, "debugDragRegions did not answer for the first window");
  expectTrue(regions.nonClient, "the first window has no non-client input source");
  expectEqual(regions.kind, "browser", "the first window's kind");
  return { id, scale: regions.scale };
}

export const checks: Check[] = [
  {
    name: "window drag: the caption regions the UI marks become caption rects, with no pass-through over them, and clearing them leaves none",
    async run() {
      const { id, scale } = await browserWindow();
      try {
        await windows().setCaptionRegions(id, [GUTTER, SPACER]);
        const marked = await windows().debugDragRegions(id);
        expectEqual(marked?.titleBand, "caption", "the title band with caption regions");
        const caption = marked?.caption ?? [];
        const gutter = caption.find((rect) => rect[0] === 0 && rect[1] === 0 && near(rect[3], 9 * scale));
        expectTrue(gutter, `no caption rect is the gutter along the top edge: ${JSON.stringify(caption)}`);
        const spacer = caption.find((rect) => rect[1] === 0 && near(rect[2], 25 * scale) && near(rect[3], 45 * scale));
        expectTrue(spacer, `no caption rect is the spacer beside the window buttons: ${JSON.stringify(caption)}`);
        expectTrue(near(gutter[0]! + gutter[2]! - (spacer[0]! + spacer[2]!), 111 * scale), `the spacer does not end 111 points from the right edge: ${JSON.stringify(caption)}`);
        const covered = (marked?.passthrough ?? []).filter((rect) => caption.some((region) => overlaps(rect, region)));
        expectEqual(covered, [], "pass-through rects that cover a caption region");
        await windows().setCaptionRegions(id, []);
        const cleared = await windows().debugDragRegions(id);
        expectEqual(cleared?.titleBand, "content", "the title band with no caption regions");
      } finally {
        await windows().setCaptionRegions(id, []);
      }
    },
  },
  {
    name: "window drag: caption regions, minimize, maximize and the debug reading answer for a window that is not open, and report nothing for it",
    async run() {
      await windows().setCaptionRegions("no-such-window", [GUTTER]);
      await windows().setCaptionRegions("no-such-window", []);
      await windows().minimizeWindow("no-such-window");
      await windows().toggleMaximizeWindow("no-such-window");
      expectTrue((await windows().debugDragRegions("no-such-window")) === null, "an unknown window reported regions");
      await windows().watchSidebarEdge("no-such-window", false, 0, false, false);
    },
  },
  {
    name: "window drag: a background instance leaves its window as it is when asked to maximize",
    async run() {
      const { id } = await browserWindow();
      await windows().toggleMaximizeWindow(id);
      const after = await windows().debugDragRegions(id);
      expectEqual(after?.maximized, false, "whether the window is maximized after a background toggle");
    },
  },
  {
    name: "window drag: a press on a caption title band reaches the window root's capture handlers, outermost first",
    run() {
      const calls: string[] = [];
      let seen: Record<string, unknown> | null = null;
      const outer = host({ onTouchStartCapture: (event: { nativeEvent: Record<string, unknown> }) => {
        calls.push("outer");
        seen = event.nativeEvent;
      } }, null);
      const inner = host({ onTouchStartCapture: () => calls.push("inner") }, component(outer));
      const band = host({ onStartShouldSetResponder: () => true }, component(inner));
      pressThroughTitleBand(hostPath(band), { rootTag: 1, button: 2, x: 140, y: 12 });
      expectEqual(calls, ["outer", "inner"], "the capture handlers that ran");
      expectEqual(seen && [seen["button"], seen["pageX"], seen["pageY"]], [2, 140, 12], "the forwarded press");
    },
  },
  {
    name: "window drag: the sidebar edge watcher polls only while a window is watched",
    async run() {
      const report = async (what: string) => {
        const state = await windows().debugSidebarEdgeWatch();
        expectTrue(state, "debugSidebarEdgeWatch did not answer");
        expectEqual(state.running, state.windows.length > 0, `whether the edge timer runs ${what} (watched: ${JSON.stringify(state.windows)})`);
        return state.windows;
      };
      const first = "self-check-edge-a";
      const second = "self-check-edge-b";
      await report("before watching");
      try {
        await windows().watchSidebarEdge(first, true, 0, false, false);
        expectTrue((await report("with one watch")).includes(first), "the first watch is not listed");
        await windows().watchSidebarEdge(second, true, 12, true, true);
        await windows().watchSidebarEdge(first, false, 0, false, false);
        const one = await report("after the first watch ends");
        expectTrue(one.includes(second) && !one.includes(first), `after ending the first watch: ${JSON.stringify(one)}`);
        await windows().watchSidebarEdge(second, false, 0, false, false);
        const after = await report("after the last watch ends");
        expectEqual(after.filter((id) => id === first || id === second), [], "watches left after both ended");
      } finally {
        await windows().watchSidebarEdge(first, false, 0, false, false);
        await windows().watchSidebarEdge(second, false, 0, false, false);
      }
    },
  },
];
