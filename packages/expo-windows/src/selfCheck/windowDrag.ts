import { requireNativeModule } from "../modules";
import { captionAt, hostPath, inTitleBand, makeDragHandlers, type DragOptions, type HostFiber } from "../windowDragRegion";
import { expectEqual, expectTrue, type Check } from "./check";

type Regions = { rootTag: number; scale: number; nonClient: boolean; caption: number[][]; passthrough: number[][] };

type WindowDragging = {
  windowIds(): Promise<string[]>;
  setDragCaption(rootTag: number, point: [number, number] | null, menu: boolean): Promise<void>;
  watchSidebarEdge(id: string, on: boolean, hold: number, right: boolean, whilePressed: boolean): Promise<void>;
  debugArmDragCaption(id: string, x: number, y: number): Promise<Regions | null>;
  debugClearDragCaption(id: string): Promise<boolean>;
  debugDragRegions(id: string): Promise<Regions | null>;
};

const windows = () => requireNativeModule<WindowDragging>("ArdiaAppWindows");

const HOST = 5;
const FUNCTION_COMPONENT = 0;

const host = (type: string, props: Record<string, unknown>, parent: HostFiber | null): HostFiber => ({ tag: HOST, type, return: parent, memoizedProps: props, stateNode: null });
const component = (parent: HostFiber | null): HostFiber => ({ tag: FUNCTION_COMPONENT, type: () => null, return: parent, memoizedProps: {}, stateNode: null });
const region = (options: Partial<DragOptions> = {}) => makeDragHandlers(0, { current: { titleBarDoubleClick: true, ...options } });
const pressable = () => ({ onStartShouldSetResponder: () => true, onResponderGrant: () => {}, accessible: true });

const windowRoot = () => host("RCTView", {}, null);
const settled = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const CAPTION_OUTLIVES_MS = 900;

const pixelOf = (points: number, scale: number) => Math.floor(points * scale + 0.001);
const covers = (rect: number[], x: number, y: number) => x >= rect[0]! && x < rect[0]! + rect[2]! && y >= rect[1]! && y < rect[1]! + rect[3]!;

async function firstWindow() {
  const ids = await windows().windowIds();
  expectTrue(ids.length > 0, "no window is open");
  return ids[0]!;
}

export const checks: Check[] = [
  {
    name: "window drag: a drag area's plain child is a caption",
    run() {
      const area = host("RCTView", region(), component(windowRoot()));
      const label = host("RCTText", {}, component(area));
      expectEqual(captionAt(hostPath(label), 300, 200), { menu: false }, "a label inside a drag area");
      expectEqual(captionAt(hostPath(area), 300, 200), { menu: false }, "the drag area itself");
    },
  },
  {
    name: "window drag: a button drawn over a drag area keeps its press",
    run() {
      const toolbar = host("RCTView", {}, windowRoot());
      host("RCTView", region(), toolbar);
      const overlay = host("RCTView", { pointerEvents: "box-none" }, toolbar);
      const button = host("RCTView", pressable(), component(overlay));
      const icon = host("ArdiaVectorIcon", {}, button);
      expectTrue(captionAt(hostPath(icon), 20, 52) === null, "the toolbar's sidebar button became a caption");
      const area = host("RCTView", region(), windowRoot());
      const inner = host("RCTView", pressable(), area);
      expectTrue(captionAt(hostPath(host("RCTText", {}, inner)), 20, 52) === null, "a button inside a drag area became a caption");
      expectTrue(captionAt(hostPath(host("RCTScrollView", {}, area)), 20, 52) === null, "a scroll view inside a drag area became a caption");
    },
  },
  {
    name: "window drag: areas that take the press themselves stay with the UI",
    run() {
      const parent = windowRoot();
      expectTrue(captionAt(hostPath(host("RCTView", region({ clickable: true }), parent)), 10, 10) === null, "a clickable area became a caption");
      expectTrue(captionAt(hostPath(host("RCTView", region({ onRegionDoubleClick: () => {} }), parent)), 10, 10) === null, "an area with its own double click became a caption");
      expectTrue(captionAt(hostPath(host("RCTView", region({ titleBarDoubleClick: false }), parent)), 10, 10) === null, "an area without the title bar double click became a caption");
      const capturing = host("RCTView", { onStartShouldSetResponderCapture: () => true }, null);
      expectTrue(captionAt(hostPath(host("RCTView", region(), capturing)), 10, 10) === null, "an area under a capturing responder became a caption");
    },
  },
  {
    name: "window drag: the title band is a caption only in its top 32 points",
    run() {
      const band = host("RCTView", region({ claims: inTitleBand }), host("RCTView", {}, null));
      const backdrop = host("RCTView", {}, component(band));
      expectEqual(captionAt(hostPath(backdrop), 600, 16), { menu: false }, "a press in the title band");
      expectTrue(captionAt(hostPath(backdrop), 600, 200) === null, "a press below the title band became a caption");
    },
  },
  {
    name: "window drag: a context menu around a drag area keeps its right click",
    run() {
      const menu = host("RCTView", { onPointerDown: () => {}, onPointerDownCapture: () => {} }, windowRoot());
      const area = host("RCTView", region(), menu);
      expectEqual(captionAt(hostPath(area), 40, 400), { menu: true }, "a drag area inside a context menu area");
    },
  },
  {
    name: "window drag: a caption is exactly the pixel under the pointer and is cut out of the title band",
    async run() {
      const id = await firstWindow();
      const armed = await windows().debugArmDragCaption(id, 300.25, 16.5);
      expectTrue(armed, "the caption debug calls did not answer for the first window");
      expectTrue(armed.nonClient, "the window has no non-client input source");
      expectTrue(armed.rootTag > 0, `the window reported root tag ${armed.rootTag}`);
      const pixel = [pixelOf(300.25, armed.scale), pixelOf(16.5, armed.scale), 1, 1];
      expectEqual(armed.caption, [pixel], "the installed caption regions");
      const overlap = armed.passthrough.filter((rect) => covers(rect, pixel[0]!, pixel[1]!));
      expectEqual(overlap, [], "pass-through regions over the caption pixel");
      await windows().debugClearDragCaption(id);
      const cleared = await windows().debugDragRegions(id);
      expectEqual(cleared?.caption, [], "caption regions after clearing");
    },
  },
  {
    name: "window drag: a caption the pointer is not on is cleared by itself",
    async run() {
      const id = await firstWindow();
      const armed = await windows().debugArmDragCaption(id, 120, 12);
      expectTrue(armed && armed.caption.length === 1, `arming installed ${JSON.stringify(armed?.caption)}`);
      await settled(CAPTION_OUTLIVES_MS);
      const later = await windows().debugDragRegions(id);
      expectEqual(later?.caption, [], `caption regions ${CAPTION_OUTLIVES_MS} ms later`);
    },
  },
  {
    name: "window drag: the native calls answer in a background launch without arming anything",
    async run() {
      const id = await firstWindow();
      const before = await windows().debugDragRegions(id);
      expectTrue(before, "the caption debug calls did not answer");
      await windows().setDragCaption(before.rootTag, [200, 10], false);
      const after = await windows().debugDragRegions(id);
      expectEqual(after?.caption, [], "caption regions after a background setDragCaption");
      await windows().watchSidebarEdge("no-such-window", false, 0, false, false);
    },
  },
];
