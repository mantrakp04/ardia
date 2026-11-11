import { hostCall, onEngineTopic } from "./host";

export type PageListener = (name: string, data: unknown) => void;
export type PageRect = { x: number; y: number; width: number; height: number };
export type PageShape = PageRect & { radius: number; holes: number[][] };
export type PageStart = { url?: string; profile?: string; adopt?: string; windowId: string };

type Page = {
  key: string;
  windowId: string;
  started: { url: string; at: number };
  ready: Promise<boolean>;
  listeners: Set<PageListener>;
  mounts: number;
  parked: boolean;
  closed: boolean;
};

type OpenedTab = { adopt?: unknown; url?: unknown; foreground?: unknown; window?: unknown; opener?: unknown; profile?: unknown };
type TabEvent = { key?: unknown; name?: unknown; data?: unknown };

const SAME_LOAD_MS = 2000;

const pages = new Map<string, Page>();
const pressListeners = new Set<(windowId: string) => void>();
let listening = false;

export function onPagePress(listener: (windowId: string) => void): () => void {
  pressListeners.add(listener);
  listen();
  return () => void pressListeners.delete(listener);
}

const shaped = (name: string, data: unknown) => {
  if (name !== "media") return data ?? {};
  const media = (data ?? {}) as { audible?: unknown; playing?: unknown; muted?: unknown };
  return { playing: media.playing === true || media.audible === true, muted: media.muted === true };
};

const quietly = (work: Promise<unknown>) => void work.catch(() => {});

function listen() {
  if (listening) return;
  listening = true;
  onEngineTopic("tab", (event: TabEvent) => {
    if (typeof event.key !== "string" || typeof event.name !== "string") return;
    const page = pages.get(event.key);
    if (!page) return;
    if (event.name === "pagePress") for (const pressed of [...pressListeners]) pressed(page.windowId);
    const data = shaped(event.name, event.data);
    for (const listener of [...page.listeners]) listener(event.name, data);
  });
  onEngineTopic("tab.opened", (opened: OpenedTab) => {
    if (typeof opened.adopt !== "string") return;
    const request = {
      url: typeof opened.url === "string" ? opened.url : "",
      disposition: opened.window === true ? "window" : opened.foreground === true ? "foreground" : "background",
      adoptId: opened.adopt,
      userGesture: true,
      profile: typeof opened.profile === "string" ? opened.profile : undefined,
    };
    const opener = typeof opened.opener === "string" ? pages.get(opened.opener) : undefined;
    const takers = opener?.listeners.size ? [opener] : [...pages.values()].filter((page) => page.listeners.size && !page.closed);
    const taker = takers[0];
    if (!taker) {
      quietly(hostCall("tab.discard", { adopt: opened.adopt }));
      return;
    }
    for (const listener of [...taker.listeners]) listener("openWindow", request);
  });
}

function start(key: string, from: PageStart): Promise<boolean> {
  return hostCall("tab.create", { key, url: from.url ?? "", profile: from.profile ?? "", adopt: from.adopt ?? "" }, from.windowId).then(
    () => true,
    (error: unknown) => {
      console.warn(`[ardia windows] the page for ${key} did not open: ${String((error as Error)?.message ?? error)}`);
      return false;
    },
  );
}

export function mountPage(key: string, from: PageStart, listener: PageListener): () => void {
  listen();
  let page = pages.get(key);
  if (!page || page.closed) {
    page = { key, windowId: from.windowId, started: { url: from.url ?? "", at: Date.now() }, ready: start(key, from), listeners: new Set(), mounts: 0, parked: false, closed: false };
    pages.set(key, page);
  } else if (page.windowId !== from.windowId) {
    page.windowId = from.windowId;
    page.ready = page.ready.then(() => start(key, from));
  }
  const mounted = page;
  mounted.parked = false;
  mounted.mounts += 1;
  mounted.listeners.add(listener);
  void mounted.ready.then((opened) => {
    if (opened && mounted.listeners.has(listener)) listener("ready", {});
  });
  return () => {
    mounted.listeners.delete(listener);
    mounted.mounts -= 1;
    if (mounted.mounts > 0) return;
    if (mounted.parked) {
      quietly(mounted.ready.then(() => hostCall("tab.show", { key, visible: false }, mounted.windowId)));
      return;
    }
    closePage(mounted);
  };
}

function closePage(page: Page) {
  if (page.closed) return;
  page.closed = true;
  if (pages.get(page.key) === page) pages.delete(page.key);
  quietly(page.ready.then(() => hostCall("tab.close", { key: page.key })));
}

export function showPage(key: string, visible: boolean, shape: PageShape | null) {
  const page = pages.get(key);
  if (!page || page.closed) return;
  const args = visible && shape ? { key, visible: true, ...shape } : { key, visible: false };
  quietly(
    page.ready.then((opened) => {
      if (opened && !page.closed) return hostCall("tab.show", args, page.windowId);
    }),
  );
}

export function callPage<Result = unknown>(key: string, method: string, args: Record<string, unknown> = {}): Promise<Result | null> {
  const page = pages.get(key);
  if (!page || page.closed) return Promise.resolve(null);
  if (method === "loadUrl" && args.url === page.started.url && Date.now() - page.started.at < SAME_LOAD_MS) return Promise.resolve(null);
  return page.ready.then((opened) => (opened && !page.closed ? hostCall<Result>("tab.call", { key, method, ...args }) : null));
}

export function parkPage(key: string) {
  const page = pages.get(key);
  if (page) page.parked = true;
}

export function releasePage(key: string) {
  const page = pages.get(key);
  if (!page) return;
  page.parked = false;
  if (page.mounts <= 0) closePage(page);
}

export function discardOffered(adopt: string): Promise<boolean> {
  return hostCall("tab.discard", { adopt }).then(
    () => true,
    () => false,
  );
}
