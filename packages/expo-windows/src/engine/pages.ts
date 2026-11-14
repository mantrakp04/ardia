import { hostCall, onEngineTopic } from "./host";
import { takerOfOpenedTab } from "./openedTabs";
import { noteLoadAsked, openingPage, shapedPageEvent, type OpeningPage } from "./pageEvents";
import { privateSessionOpened } from "./privateWindows";
import type { ExternalAppRequest } from "@ardia/ardiacore";

export type PageListener = (name: string, data: unknown) => void;
export type PageRect = { x: number; y: number; width: number; height: number };
export type PageShape = PageRect & { radius: number; holes: number[][] };
export type PageStart = { url?: string; profile?: string; adopt?: string; windowId: string };

type ShowArgs = { key: string; visible: boolean } & Partial<PageShape>;

type Page = {
  key: string;
  windowId: string;
  from: PageStart;
  profile: string;
  started: { url: string; at: number };
  opening: OpeningPage;
  ready: Promise<boolean>;
  listeners: Set<PageListener>;
  told: Set<PageListener>;
  show: ShowArgs | null;
  showSent: ShowArgs | null;
  mounts: number;
  parked: boolean;
  closed: boolean;
  focusAsked: number;
};

type OpenedTab = { adopt?: unknown; url?: unknown; foreground?: unknown; window?: unknown; opener?: unknown; profile?: unknown; fromClick?: unknown; point?: unknown };
type Point = { x: number; y: number };
type TabEvent = { key?: unknown; name?: unknown; data?: unknown };

const SAME_LOAD_MS = 2000;
const FOCUS_WAITS_FOR_SHOW_MS = 1500;

const pages = new Map<string, Page>();
const closings = new Map<string, Promise<void>>();
const pressListeners = new Set<(windowId: string) => void>();
let listening = false;
let lastAskedToFocus: Page | null = null;
type ExternalAppAnswers = {
  ask: (profile: string, page: string, data: unknown) => Promise<ExternalAppRequest | null>;
  forget: (id: string) => void;
  forgetPage: (page: string) => void;
};

let externalAppAnswers: ExternalAppAnswers | null = null;

export function answerExternalAppsWith(answers: ExternalAppAnswers) {
  externalAppAnswers = answers;
}

export function externalAppStillAsked(key: string, id: string): Promise<boolean> {
  return callPage<unknown>(key, "externalAppAlive", { id }).then((alive) => alive === true);
}

function askExternalApp(page: Page, data: unknown) {
  const answers = externalAppAnswers;
  if (!answers) return;
  quietly(
    answers.ask(page.profile, page.key, data).then((request) => {
      if (!request) return;
      if (page.closed) return answers.forget(request.id);
      for (const listener of [...page.listeners]) listener("externalApp", request);
    }),
  );
}


export function onPagePress(listener: (windowId: string) => void): () => void {
  pressListeners.add(listener);
  listen();
  return () => void pressListeners.delete(listener);
}

const quietly = (work: Promise<unknown>) => void work.catch(() => {});

const isPoint = (value: unknown): value is Point =>
  typeof value === "object" && value !== null && Number.isFinite((value as Point).x) && Number.isFinite((value as Point).y);

function inWindow(page: Page | undefined, point: unknown): Point | undefined {
  const shown = page?.show;
  if (!shown?.visible || typeof shown.x !== "number" || typeof shown.y !== "number" || !isPoint(point)) return undefined;
  return { x: shown.x + point.x, y: shown.y + point.y };
}

function placedPoint(page: Page, name: string, data: unknown): unknown {
  if (name !== "openWindow" || typeof data !== "object" || data === null || !("point" in data)) return data;
  return { ...data, point: inWindow(page, (data as { point?: unknown }).point) };
}

function listen() {
  if (listening) return;
  listening = true;
  onEngineTopic("tab", (event: TabEvent) => {
    if (typeof event.key !== "string" || typeof event.name !== "string") return;
    const page = pages.get(event.key);
    if (!page) return;
    if (event.name === "pagePress") for (const pressed of [...pressListeners]) pressed(page.windowId);
    if (event.name === "externalApp") return askExternalApp(page, event.data);
    const data = placedPoint(page, event.name, shapedPageEvent(page.opening, event.name, event.data));
    for (const listener of [...page.listeners]) listener(event.name, data);
  });
  onEngineTopic("tab.opened", (opened: OpenedTab) => {
    if (typeof opened.adopt !== "string") return;
    const opener = typeof opened.opener === "string" ? pages.get(opened.opener) : undefined;
    const fromClick = opened.fromClick === true;
    const request = {
      url: typeof opened.url === "string" ? opened.url : "",
      disposition: opened.window === true ? "window" : opened.foreground === true ? "foreground" : "background",
      adoptId: opened.adopt,
      userGesture: true,
      profile: typeof opened.profile === "string" ? opened.profile : undefined,
      fromClick,
      point: fromClick ? inWindow(opener, opened.point) : undefined,
    };
    const listening = [...pages.values()].filter((page) => page.listeners.size && !page.closed);
    const taker = opener?.listeners.size ? opener : takerOfOpenedTab(listening, request.profile);
    if (!taker) {
      if (listening.length) console.warn("[ardia windows] a tab opened by a page was closed: no page of its profile is showing");
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
  const closing = closings.get(key);
  return (closing ? closing.then(() => create(offered)) : create(offered))
    .catch((error: unknown) => {
      if (!offered || !url) throw error;
      return create("");
    })
    .then(
      () => {
        privateSessionOpened(from.profile ?? "");
        return true;
      },
      (error: unknown) => {
        console.warn(`[ardia windows] the page for ${key} did not open: ${String((error as Error)?.message ?? error)}`);
        return false;
      },
    );
}

function begin(page: Page, from: PageStart): Promise<boolean> {
  page.told.clear();
  page.showSent = null;
  return start(page.key, from);
}

function tellReady(page: Page, listener: PageListener) {
  if (page.closed || !page.listeners.has(listener) || page.told.has(listener)) return;
  page.told.add(listener);
  listener("ready", {});
}

function sendShow(page: Page): Promise<unknown> | undefined {
  const args = page.show;
  if (!args || args === page.showSent || page.closed) return undefined;
  page.showSent = args;
  return hostCall("tab.show", args, page.windowId);
}

const focusWaits = (page: Page) => lastAskedToFocus === page && page.focusAsked > 0 && Date.now() - page.focusAsked < FOCUS_WAITS_FOR_SHOW_MS;

function askShow(page: Page, args: ShowArgs) {
  page.show = args;
  quietly(
    page.ready.then((opened) => {
      if (!opened || page.show !== args) return;
      const sent = sendShow(page);
      if (!args.visible || !focusWaits(page)) return sent;
      page.focusAsked = 0;
      return Promise.resolve(sent).then(() => (page.closed ? undefined : hostCall("tab.call", { key: page.key, method: "focus" })));
    }),
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
      profile: from.profile ?? "",
      started: { url: from.url ?? "", at: Date.now() },
      opening: openingPage(from.url ?? "", !!offeredByEngine(from.adopt)),
      ready: Promise.resolve(false),
      listeners: new Set(),
      told: new Set(),
      show: null,
      showSent: null,
      mounts: 0,
      parked: false,
      closed: false,
      focusAsked: 0,
    };
    page.ready = begin(page, from);
    pages.set(key, page);
  } else if (page.windowId !== from.windowId) {
    page.windowId = from.windowId;
    page.from = from;
    page.profile = from.profile ?? "";
    page.show = null;
    const moving = page;
    page.ready = page.ready.then(() => begin(moving, from));
  }
  const mounted = page;
  mounted.parked = false;
  mounted.mounts += 1;
  mounted.listeners.add(listener);
  void mounted.ready.then((opened) => {
    if (opened) tellReady(mounted, listener);
  });
  return () => {
    mounted.listeners.delete(listener);
    mounted.mounts -= 1;
    if (mounted.mounts > 0) return;
    if (mounted.parked) {
      askShow(mounted, { key, visible: false });
      return;
    }
    closePage(mounted);
  };
}

function closePage(page: Page) {
  if (page.closed) return;
  page.closed = true;
  if (lastAskedToFocus === page) lastAskedToFocus = null;
  externalAppAnswers?.forgetPage(page.key);
  if (pages.get(page.key) === page) pages.delete(page.key);
  const closing: Promise<void> = page.ready
    .then(() => hostCall("tab.close", { key: page.key }))
    .then(
      () => {},
      () => {},
    )
    .then(() => {
      if (closings.get(page.key) === closing) closings.delete(page.key);
    });
  closings.set(page.key, closing);
}

export function showPage(key: string, visible: boolean, shape: PageShape | null) {
  const page = pages.get(key);
  if (!page || page.closed) return;
  askShow(page, visible && shape ? { key, visible: true, ...shape } : { key, visible: false });
}

const REOPENING_METHODS = new Set(["loadUrl", "reload", "forceReload"]);

function readyOrReopened(page: Page, url: unknown): Promise<boolean> {
  page.ready = page.ready.then((opened) => {
    if (opened || page.closed) return opened;
    return begin(page, { ...page.from, adopt: undefined, windowId: page.windowId }).then((again) => {
      if (page.closed) return again;
      if (again) {
        quietly(sendShow(page) ?? Promise.resolve());
        for (const listener of [...page.listeners]) tellReady(page, listener);
      } else for (const listener of [...page.listeners]) listener("loadError", { url: typeof url === "string" ? url : page.from.url ?? "", code: 0, text: "the page could not open" });
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
  if (method === "focus") {
    lastAskedToFocus = page;
    page.focusAsked = page.show?.visible ? 0 : Date.now();
    if (page.focusAsked) return Promise.resolve(null);
  }
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
