import { requireNativeModule } from "../modules";
import type { DropAccepts, DropAreaFrame, DroppedItem, WindowDrop } from "../views/fileDropAreas";
import { expectEqual, expectTrue, type Check } from "./check";

type DevDragPayload = { files?: string[]; urls?: string[]; publicURLs?: string[]; text?: string; fileDrag?: boolean };
type DropTargetReport = { ole: boolean; registered: boolean; windows: number; replaced: number; areas: number; childClasses: string[] };

type FileDropDev = {
  setDropArea(frame: DropAreaFrame): void;
  removeDropArea(windowId: string, area: string): void;
  devDrag(windowId: string, action: "move" | "drop" | "cancel" | "end", x: number, y: number, payload: DevDragPayload | null): Promise<string>;
  devLastFileDrag(): Promise<string[]>;
  devDropTarget(windowId: string): Promise<DropTargetReport | null>;
  devWriteDropFixture(name: string, contents: string): Promise<string>;
  addListener(event: "onWindowDrop", listener: (payload: unknown) => void): { remove(): void };
};

type WindowIds = { windowIds(): Promise<string[]> };

const fileDrop = () => requireNativeModule<FileDropDev>("ArdiaFileDrop");
const windows = () => requireNativeModule<WindowIds>("ArdiaAppWindows");
const settled = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const FRAME = { x: 4, y: 48, width: 200, height: 120 };
const POINT = { x: 104, y: 108 };
const TOP_DEPTH = 10000;

let areaCount = 0;

async function firstWindow() {
  const ids = await windows().windowIds();
  expectTrue(ids.length > 0, "no window is open");
  return ids[0]!;
}

type Area = { accepts: DropAccepts; enabled?: boolean; depth?: number };
type Outcome = { moved: string; dropped: string; events: WindowDrop[]; areas: string[] };

async function drag(windowId: string, layers: Area[], payload: DevDragPayload): Promise<Outcome> {
  const areas = layers.map(() => `self-check-drop-${++areaCount}`);
  const events: WindowDrop[] = [];
  const subscription = fileDrop().addListener("onWindowDrop", (payload) => {
    const event = payload as WindowDrop;
    if (areas.includes(event.area)) events.push(event);
  });
  try {
    layers.forEach((layer, index) =>
      fileDrop().setDropArea({ windowId, area: areas[index]!, depth: layer.depth ?? TOP_DEPTH + index, ...FRAME, accepts: layer.accepts, enabled: layer.enabled !== false }),
    );
    const moved = await fileDrop().devDrag(windowId, "move", POINT.x, POINT.y, payload);
    const dropped = await fileDrop().devDrag(windowId, "drop", POINT.x, POINT.y, null);
    const deadline = Date.now() + 1500;
    if (dropped.endsWith(" performed")) {
      while (Date.now() < deadline && !events.some((event) => event.phase === "drop")) await settled(25);
    }
    return { moved, dropped, events, areas };
  } finally {
    subscription.remove();
    for (const area of areas) fileDrop().removeDropArea(windowId, area);
    await fileDrop().devDrag(windowId, "end", 0, 0, null);
  }
}

async function expectDrop(windowId: string, layers: Area[], payload: DevDragPayload, items: DroppedItem[] | ((items: DroppedItem[]) => string | null), what: string) {
  const outcome = await drag(windowId, layers, payload);
  const target = outcome.areas[outcome.areas.length - 1]!;
  expectEqual(outcome.moved, `area:${target} copy`, `${what}: the drag over the area`);
  expectEqual(outcome.dropped, `area:${target} performed`, `${what}: the drop`);
  expectEqual(outcome.events.map((event) => [event.area, event.phase]), [[target, "enter"], [target, "drop"]], `${what}: the area's events`);
  const enter = outcome.events[0]!;
  expectEqual([enter.x, enter.y, enter.windowX, enter.windowY], [POINT.x - FRAME.x, POINT.y - FRAME.y, POINT.x, POINT.y], `${what}: the enter point`);
  const drop = outcome.events[1]!;
  expectEqual(drop.count, drop.items.length, `${what}: the drop's count`);
  if (typeof items === "function") {
    const problem = items(drop.items);
    if (problem) throw new Error(`${what}: ${problem}: ${JSON.stringify(drop.items)}`);
  } else {
    expectEqual(drop.items, items, `${what}: the dropped items`);
  }
}

async function expectRefused(windowId: string, layers: Area[], payload: DevDragPayload, what: string) {
  const outcome = await drag(windowId, layers, payload);
  const target = outcome.areas[outcome.areas.length - 1]!;
  expectEqual(outcome.moved, `area:${target} none`, `${what}: the drag over the area`);
  expectEqual(outcome.dropped, `area:${target} refused`, `${what}: the drop`);
  await settled(100);
  expectEqual(outcome.events, [], `${what}: events sent to the area`);
}

const oneFile = (suffix: string) => (items: DroppedItem[]) => {
  if (items.length !== 1) return "not one item";
  const [item] = items;
  if (item!.kind !== "file") return "not a file item";
  return item!.url.startsWith("file:///") && item!.url.endsWith(suffix) ? null : `not a file URL ending in ${suffix}`;
};

export const checks: Check[] = [
  {
    name: "file drop: the first window takes OLE drops",
    async run() {
      const windowId = await firstWindow();
      const report = await fileDrop().devDropTarget(windowId);
      expectTrue(report, "devDropTarget did not answer for the first window");
      expectTrue(report.ole, "OLE could not be initialized on the UI thread");
      expectTrue(report.registered, `the window's top-level HWND has no drop target: ${JSON.stringify(report)}`);
      expectEqual(await fileDrop().devDrag("no-such-window", "move", 1, 1, { text: "x" }), "no window", "devDrag on a window that is not open");
      expectEqual(await fileDrop().devLastFileDrag(), [], "devLastFileDrag");
    },
  },
  {
    name: "file drop: links, text and host-like text take the Mac's rules in each accept mode",
    async run() {
      const windowId = await firstWindow();
      await expectDrop(windowId, [{ accepts: "links" }], { urls: ["https://example.com/a"] }, [{ kind: "url", url: "https://example.com/a" }], "a link");
      await expectDrop(windowId, [{ accepts: "links" }], { text: " https://example.com/b " }, [{ kind: "url", url: "https://example.com/b" }], "a link as text");
      await expectDrop(windowId, [{ accepts: "links" }], { text: "example.com" }, [{ kind: "text", text: "example.com" }], "host-like text");
      await expectRefused(windowId, [{ accepts: "links" }], { text: "two words" }, "plain text where only links are taken");
      await expectRefused(windowId, [{ accepts: "links" }], { urls: ["ftp://example.com/file"] }, "a link that is not http");
      await expectDrop(windowId, [{ accepts: "linksAndText" }], { text: "  two \n words " }, [{ kind: "text", text: "two words" }], "plain text where text is taken");
      await expectRefused(windowId, [{ accepts: "extensionPackages" }], { urls: ["https://example.com/a"] }, "a link where only extension packages are taken");
    },
  },
  {
    name: "file drop: files, link files and extension packages",
    async run() {
      const windowId = await firstWindow();
      const page = await fileDrop().devWriteDropFixture("page.txt", "hello");
      const shortcut = await fileDrop().devWriteDropFixture("site.url", "[InternetShortcut]\r\nURL=https://example.org/\r\n");
      const webloc = await fileDrop().devWriteDropFixture(
        "site.webloc",
        '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>URL</key><string>https://example.net/?a=1&amp;b=2</string></dict></plist>',
      );
      const crx = await fileDrop().devWriteDropFixture("ext.crx", "Cr24");
      await expectDrop(windowId, [{ accepts: "links" }], { files: [page] }, oneFile("/page.txt"), "a file");
      await expectDrop(windowId, [{ accepts: "links" }], { files: [shortcut] }, [{ kind: "url", url: "https://example.org/" }], "a .url shortcut");
      await expectDrop(windowId, [{ accepts: "links" }], { files: [webloc] }, [{ kind: "url", url: "https://example.net/?a=1&b=2" }], "a .webloc file");
      await expectRefused(windowId, [{ accepts: "links" }], { files: [`${page}.missing`] }, "a file that does not exist");
      await expectDrop(windowId, [{ accepts: "extensionPackages" }], { files: [crx] }, oneFile("/ext.crx"), "an extension package");
      await expectRefused(windowId, [{ accepts: "extensionPackages" }], { files: [crx, page] }, "an extension package with another file");
    },
  },
  {
    name: "file drop: the innermost enabled area takes the drag, as on the Mac",
    async run() {
      const windowId = await firstWindow();
      await expectRefused(windowId, [{ accepts: "links" }, { accepts: "extensionPackages" }], { urls: ["https://example.com/a"] }, "an inner area that refuses");
      const outcome = await drag(windowId, [{ accepts: "links" }, { accepts: "extensionPackages", enabled: false }], { urls: ["https://example.com/c"] });
      const outer = outcome.areas[0]!;
      expectEqual(outcome.dropped, `area:${outer} performed`, "a disabled inner area lets the outer one take the drop");
      expectEqual(outcome.events.map((event) => event.phase), ["enter", "drop"], "the outer area's events");
    },
  },
];
