import { requireNativeModule } from "expo-modules-core";
import { normalizeState } from "./normalize";
import type {
  NightShade,
  NightShadeMode,
  PageEngineCapabilities,
  PageEngineEvent,
  PageRequestAnswer,
  PageSetup,
  PageSnapshot,
  PageState,
  ReadableContent,
  Subscription,
  WebsiteDataKind,
} from "./pageTypes";

type PagesNative = {
  addListener(eventName: "onPageEngineEvent", listener: (event: PageEngineEvent) => void): Subscription;
  capabilities(): PageEngineCapabilities;
  launchOptions(): { pageLab: boolean } | null;
  openPage(pageId: string, setup: PageSetup): Promise<void>;
  closePage(pageId: string): Promise<void>;
  pageIds(): Promise<string[]>;
  pageState(pageId: string): Promise<PageState | null>;
  load(pageId: string, url: string): Promise<void>;
  reload(pageId: string): Promise<void>;
  stopLoading(pageId: string): Promise<void>;
  goBack(pageId: string): Promise<boolean>;
  goForward(pageId: string): Promise<boolean>;
  find(pageId: string, text: string): Promise<void>;
  findNext(pageId: string): Promise<void>;
  findPrevious(pageId: string): Promise<void>;
  endFind(pageId: string): Promise<void>;
  setPageZoom(pageId: string, zoom: number): Promise<number>;
  zoomIn(pageId: string): Promise<number>;
  zoomOut(pageId: string): Promise<number>;
  setDesktopSite(pageId: string, enabled: boolean): Promise<void>;
  download(pageId: string, url: string): Promise<void>;
  readableContent(pageId: string): Promise<ReadableContent | null>;
  snapshot(pageId: string, maxWidth?: number, quality?: number): Promise<PageSnapshot | null>;
  deleteSnapshots(pageId: string): Promise<void>;
  saveState(pageId: string): Promise<string | null>;
  answerRequest(pageId: string, requestId: string, answer: PageRequestAnswer): Promise<boolean>;
  openPopup(pageId: string, popupId: string): Promise<boolean>;
  dismissPopup(popupId: string): Promise<boolean>;
  exitFullscreen(pageId: string): Promise<void>;
  endPrivateSession(): Promise<void>;
  nightShade(host?: string | null, isPrivate?: boolean): Promise<NightShade>;
  setNightShade(mode: NightShadeMode | null, host?: string | null, isPrivate?: boolean): Promise<void>;
  opensLinksInApps(host: string): Promise<boolean>;
  setOpensLinksInApps(host: string, opens: boolean): Promise<void>;
  clearWebsiteData(kinds: WebsiteDataKind[]): Promise<void>;
  setInspectable(inspectable: boolean): Promise<void>;
};

let loaded: PagesNative | undefined;
const native = () => (loaded ??= requireNativeModule<PagesNative>("ArdiaPageView"));

export const pages = {
  capabilities: () => native().capabilities(),
  launchOptions: () => native().launchOptions(),
  open: (pageId: string, setup: PageSetup = {}) => native().openPage(pageId, setup),
  close: (pageId: string) => native().closePage(pageId),
  ids: () => native().pageIds(),
  state: async (pageId: string) => {
    const state = await native().pageState(pageId);
    return state ? normalizeState(state, false) : null;
  },
  load: (pageId: string, url: string) => native().load(pageId, url),
  reload: (pageId: string) => native().reload(pageId),
  stopLoading: (pageId: string) => native().stopLoading(pageId),
  goBack: (pageId: string) => native().goBack(pageId),
  goForward: (pageId: string) => native().goForward(pageId),
  find: (pageId: string, text: string) => native().find(pageId, text),
  findNext: (pageId: string) => native().findNext(pageId),
  findPrevious: (pageId: string) => native().findPrevious(pageId),
  endFind: (pageId: string) => native().endFind(pageId),
  setPageZoom: (pageId: string, zoom: number) => native().setPageZoom(pageId, zoom),
  zoomIn: (pageId: string) => native().zoomIn(pageId),
  zoomOut: (pageId: string) => native().zoomOut(pageId),
  setDesktopSite: (pageId: string, enabled: boolean) => native().setDesktopSite(pageId, enabled),
  download: (pageId: string, url: string) => native().download(pageId, url),
  readableContent: (pageId: string) => native().readableContent(pageId),
  snapshot: (pageId: string, options: { maxWidth?: number; quality?: number } = {}) =>
    native().snapshot(pageId, options.maxWidth, options.quality),
  deleteSnapshots: (pageId: string) => native().deleteSnapshots(pageId),
  saveState: (pageId: string) => native().saveState(pageId),
  answerRequest: (pageId: string, requestId: string, answer: PageRequestAnswer) => native().answerRequest(pageId, requestId, answer),
  openPopup: (pageId: string, popupId: string) => native().openPopup(pageId, popupId),
  dismissPopup: (popupId: string) => native().dismissPopup(popupId),
  exitFullscreen: (pageId: string) => native().exitFullscreen(pageId),
  endPrivateSession: () => native().endPrivateSession(),
  nightShade: (host?: string | null, isPrivate = false) => native().nightShade(host ?? null, isPrivate),
  setNightShade: (mode: NightShadeMode | null, host?: string | null, isPrivate = false) => native().setNightShade(mode, host ?? null, isPrivate),
  opensLinksInApps: (host: string) => native().opensLinksInApps(host),
  setOpensLinksInApps: (host: string, opens: boolean) => native().setOpensLinksInApps(host, opens),
  clearWebsiteData: (kinds: WebsiteDataKind[]) => native().clearWebsiteData(kinds),
  setInspectable: (inspectable: boolean) => native().setInspectable(inspectable),
  addListener: (listener: (event: PageEngineEvent) => void): Subscription =>
    native().addListener("onPageEngineEvent", (event) =>
      listener(event.name === "page.state" ? { ...event, state: normalizeState(event.state, false) } : event),
    ),
};
