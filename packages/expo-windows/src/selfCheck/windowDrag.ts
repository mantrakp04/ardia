import { requireNativeModule } from "../modules";
import { hostPath, pressThroughTitleBand, type HostFiber } from "../windowDragRegion";
import { expectEqual, expectTrue, type Check } from "./check";

type Regions = { rootTag: number; scale: number; nonClient: boolean; kind: string; titleBand: string; caption: number[][]; passthrough: number[][] };

type WindowDragging = {
  windowIds(): Promise<string[]>;
  setTitleBand(id: string, mode: "caption" | "content"): Promise<void>;
  watchSidebarEdge(id: string, on: boolean, hold: number, right: boolean, whilePressed: boolean): Promise<void>;
  debugDragRegions(id: string): Promise<Regions | null>;
};

const windows = () => requireNativeModule<WindowDragging>("ArdiaAppWindows");

const HOST = 5;
const FUNCTION_COMPONENT = 0;
const TITLE_BAND_POINTS = 32;

const host = (props: Record<string, unknown>, parent: HostFiber | null): HostFiber => ({ tag: HOST, type: "RCTView", return: parent, memoizedProps: props, stateNode: null });
const component = (parent: HostFiber | null): HostFiber => ({ tag: FUNCTION_COMPONENT, type: () => null, return: parent, memoizedProps: {}, stateNode: null });

const reachesBand = (rect: number[], bandHeight: number) => rect[1]! < bandHeight && rect[1]! + rect[3]! > 0 && rect[2]! > 0;

async function browserWindow() {
  const ids = await windows().windowIds();
  expectTrue(ids.length > 0, "no window is open");
  const id = ids[0]!;
  const regions = await windows().debugDragRegions(id);
  expectTrue(regions, "debugDragRegions did not answer for the first window");
  expectTrue(regions.nonClient, "the first window has no non-client input source");
  expectEqual(regions.kind, "browser", "the first window's kind");
  return { id, bandHeight: TITLE_BAND_POINTS * regions.scale };
}

export const checks: Check[] = [
  {
    name: "window drag: a caption title band leaves no pass-through over the band, and content puts it back",
    async run() {
      const { id, bandHeight } = await browserWindow();
      try {
        await windows().setTitleBand(id, "caption");
        const caption = await windows().debugDragRegions(id);
        expectEqual(caption?.titleBand, "caption", "the title band after setTitleBand caption");
        expectEqual(caption?.passthrough.filter((rect) => reachesBand(rect, bandHeight)), [], "pass-through regions over the band in caption mode");
        await windows().setTitleBand(id, "content");
        const content = await windows().debugDragRegions(id);
        expectEqual(content?.titleBand, "content", "the title band after setTitleBand content");
        const over = content?.passthrough.filter((rect) => reachesBand(rect, bandHeight)) ?? [];
        expectTrue(over.length > 0, `no pass-through region covers the band in content mode: ${JSON.stringify(content?.passthrough)}`);
        expectTrue(over.some((rect) => rect[1] === 0 && rect[3]! >= bandHeight - 1), `the content pass-through does not span the band's height: ${JSON.stringify(over)}`);
      } finally {
        await windows().setTitleBand(id, "content");
      }
    },
  },
  {
    name: "window drag: setTitleBand and the debug reading answer for a window that is not open, and report nothing for it",
    async run() {
      await windows().setTitleBand("no-such-window", "caption");
      await windows().setTitleBand("no-such-window", "content");
      expectTrue((await windows().debugDragRegions("no-such-window")) === null, "an unknown window reported regions");
      await windows().watchSidebarEdge("no-such-window", false, 0, false, false);
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
];
