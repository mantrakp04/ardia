import { hostCall, onEngineTopic } from "./host";
import { noteLoadAsked, openingPage, shapedPageEvent, type OpeningPage } from "./pageEvents";

export type PageListener = (name: string, data: unknown) => void;
export type PageRect = { x: number; y: number; width: number; height: number };
export type PageShape = PageRect & { radius: number; holes: number[][] };
export type PageStart = { url?: string; profile?: string; adopt?: string; windowId: string };

type Page = {
  key: string;
  windowId: string;
  from: PageStart;
  started: { url: string; at: number };
  opening: OpeningPage;
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

const quietly = (work: Promise<unknown>) => void work.catch(() => {});

function listen() {
  if (listening) return;
  listening = true;
  onEngineTopic("tab", (event: TabEvent) => {
    if (typeof event.key !== "string" || typeof event.name !== "string") return;
    const page = pages.get(event.key);
    if (!page) return;
    if (event.name === "pagePress") for (const pressed of [...pressListeners]) pressed(page.windowId);
    const data = shapedPageEvent(page.opening, event.name, event.data);
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

const offeredByEngine = (adopt: string | undefined) => (adopt?.startsWith("ardiacore:") ? adopt : "");

function start(key: string, from: PageStart): Promise<boolean> {
  const url = from.url ?? "";
  const create = (adopt: string) => hostCall("tab.create", { key, url, profile: from.profile ?? "", adopt }, from.windowId);
  const offered = offeredByEngine(from.adopt);
  return create(offered)
    .catch((error: unknown) => {
      if (!offered || !url) throw error;
      return create("");
    })
    .then(
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
    page = {
      key,
      windowId: from.windowId,
      from,
      started: { url: from.url ?? "", at: Date.now() },
      opening: openingPage(from.url ?? "", !!offeredByEngine(from.adopt)),
      ready: start(key, from),
      listeners: new Set(),
      mounts: 0,
      parked: false,
      closed: false,
    };
    pages.set(key, page);
  } else if (page.windowId !== from.windowId) {
    page.windowId = from.windowId;
    page.from = from;
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

const REOPENING_METHODS = new Set(["loadUrl", "reload", "forceReload"]);

function readyOrReopened(page: Page, url: unknown): Promise<boolean> {
  page.ready = page.ready.then((opened) => {
    if (opened || page.closed) return opened;
    return start(page.key, { ...page.from, adopt: undefined, windowId: page.windowId }).then((again) => {
      const listeners = page.closed ? [] : [...page.listeners];
      if (again) for (const listener of listeners) listener("ready", {});
      else for (const listener of listeners) listener("loadError", { url: typeof url === "string" ? url : page.from.url ?? "", code: 0, text: "the page could not open" });
      return again;
    });
  });
  return page.ready;
}

export function callPage<Result = unknown>(key: string, method: string, args: Record<string, unknown> = {}): Promise<Result | null> {
  const page = pages.get(key);
  if (!page || page.closed) return Promise.resolve(null);
  if (method === "loadUrl" && args.url === page.started.url && Date.now() - page.started.at < SAME_LOAD_MS) return Promise.resolve(null);
  if (method === "loadUrl") noteLoadAsked(page.opening, args.url);
  const ready = REOPENING_METHODS.has(method) ? readyOrReopened(page, args.url) : page.ready;
  return ready.then((opened) => (opened && !page.closed ? hostCall<Result>("tab.call", { key, method, ...args }) : null));
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
