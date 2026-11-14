import type { ViewProps } from "react-native";

export type PageNavigationState = {
  url: string | null;
  title: string;
  progress: number;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type PageSecurity = "none" | "secure" | "mixed" | "insecure";

export type PageNetworkFailure = "offline" | "hostNotFound" | "timedOut" | "connectionLost" | "notPrivate" | "other";

export type PageLoadFailure = {
  kind: "crashed" | "network";
  reason: PageNetworkFailure | null;
  title: string;
  message: string;
};

export type PageState = PageNavigationState & {
  faviconUrl: string | null;
  themeColor: string | null;
  backgroundColor: string | null;
  security: PageSecurity;
  failure: PageLoadFailure | null;
  pageZoom: number;
  isDesktopSite: boolean;
  scrollDirection: "up" | "down";
  isScrolledToTop: boolean;
  blockedRequests: number;
  isLive: boolean;
  isPrivate: boolean;
};

export type PageTone = { top: string | null; bottom: string | null };

export type PageToneInsets = { top: number; bottom: number };

export type PageError = { code: string; message: string };

export type SwipeNavigation = "anywhere" | "edges" | "off";

export type PageViewProps = ViewProps & {
  pageId: string;
  initialUrl?: string;
  title?: string;
  isPrivate?: boolean;
  savedState?: string;
  toneInsets?: PageToneInsets;
  swipeNavigation?: SwipeNavigation;
  pullToRefresh?: boolean;
  onPageState?: (state: PageState) => void;
  onPageTone?: (tone: PageTone) => void;
  onPageError?: (error: PageError) => void;
};

export type PageViewHandle = {
  loadUrl(url: string): Promise<void>;
  goBack(): Promise<boolean>;
  goForward(): Promise<boolean>;
  reload(): Promise<void>;
  stopLoading(): Promise<void>;
};

export type PageSetup = {
  url?: string;
  title?: string;
  isPrivate?: boolean;
  savedState?: string;
};

export type FindResult = { query: string; activeIndex: number; total: number; isDone: boolean };

export type VisitKind = "typed" | "link" | "backForward" | "restored" | "redirect" | "sameDocument";

export type SitePermission = "camera" | "microphone" | "cameraAndMicrophone" | "location";

export type ExternalApp = "phone" | "email" | "messages" | "maps" | "store" | "other";

export type PageRequestKind =
  | { kind: "alert"; text: string }
  | { kind: "confirm"; text: string }
  | { kind: "prompt"; text: string; defaultText: string }
  | { kind: "openExternal"; url: string; app: ExternalApp }
  | { kind: "httpAuthentication"; realm: string | null; isProxy: boolean; failedBefore: boolean; isSecure: boolean }
  | { kind: "permission"; permission: SitePermission }
  | { kind: "fileChooser"; acceptTypes: string[]; allowsMultiple: boolean; prefersCapture: boolean; offersPhoto?: boolean; offersVideo?: boolean; capturesDirectly?: boolean };

export type PageRequest = PageRequestKind & {
  id: string;
  host: string;
  title: string;
  message: string | null;
};

export type PageRequestAnswer =
  | { type: "dismiss" }
  | { type: "accept" }
  | { type: "text"; text: string }
  | { type: "credential"; user: string; password: string }
  | { type: "files"; uris: string[] }
  | { type: "pickFiles" }
  | { type: "takePhoto" }
  | { type: "recordVideo" };

export type PressTarget = { kind: "link"; url: string; text: string | null } | { kind: "image"; url: string; linkUrl: string | null };

export type ReadableContent = {
  url: string;
  title: string;
  siteName: string;
  byline: string | null;
  excerpt: string | null;
  leadImage: string | null;
  language: string | null;
  paragraphs: string[];
  html: string;
  wordCount: number;
  isArticle: boolean;
};

export type PageSnapshot = { path: string; uri: string; width: number; height: number; route?: "draw" | "windowCopy"; bytes?: number };

export type PageScrollPosition = { y: number; viewportWidth?: number; viewportHeight: number; contentHeight: number };

export type NightShadeMode = "disabled" | "automatic" | "always";

export type NightShade = { defaultMode: NightShadeMode; siteMode: NightShadeMode | null; mode: NightShadeMode };

export type WebsiteDataKind = "cache" | "cookiesAndSiteData";

export type PageEngineCapabilities = {
  engineName: string;
  isDevelopmentOnly: boolean;
  supportsPrivatePages: boolean;
  pageZoomLevels: number[];
  pageZoomScalesTextOnly: boolean;
  snapshotsIncludeVideo: boolean;
};

export type PageEngineEvent =
  | { name: "page.state"; pageId: string; state: PageState }
  | { name: "page.find"; pageId: string; result: FindResult | null }
  | { name: "page.request"; pageId: string; request: PageRequest | null }
  | { name: "page.fullscreen"; pageId: string; isFullscreen: boolean }
  | { name: "page.visited"; pageId: string; url: string; title: string; kind: VisitKind }
  | { name: "page.popup"; pageId: string; popupId: string; url: string | null; isUserGesture: boolean; isPrivate: boolean }
  | {
      name: "page.download";
      pageId: string;
      downloadId: string | null;
      url: string;
      fileName: string;
      mimeType: string | null;
      contentLength: number | null;
      isPrivate: boolean;
    }
  | { name: "page.longPress"; pageId: string; target: PressTarget; x: number; y: number }
  | { name: "page.closeRequested"; pageId: string }
  | { name: "page.externalAppMissing"; pageId: string; url: string }
  | { name: "page.desktop"; pageId: string; line: string }
  | { name: "pages.privateSessionEnded" };

export type PageEventPayload =
  | ({ name: "state" } & Partial<Omit<PageState, "url" | "title" | "progress" | "isLoading" | "canGoBack" | "canGoForward">> &
      Omit<PageNavigationState, "url"> & { url?: string })
  | { name: "tone"; top?: string; bottom?: string }
  | ({ name: "error" } & PageError);

export type DownloadProgress = {
  id: string;
  fileName: string;
  bytes: number;
  total: number | null;
  fraction: number | null;
  isQueued: boolean;
};

export type DownloadFailure =
  | "network"
  | "server"
  | "insecureRedirect"
  | "tooManyRedirects"
  | "unsupported"
  | "storage"
  | "noSpace"
  | "privateSessionEnded";

export type DownloadEvent =
  | { name: "downloads.progress"; downloads: DownloadProgress[] }
  | { name: "downloads.finished"; fileName: string; uri: string | null; failure: DownloadFailure | null };

export type BlockingCategory = "ads" | "trackers" | "cookieBanners";

export type FilterListStatus = "ready" | "downloading" | "compiling" | "failed" | "offline" | "tooLarge";

export type FilterList = {
  id: string;
  title: string;
  group: string;
  category: BlockingCategory;
  sourceUrl: string | null;
  supportUrl: string | null;
  languages: string[];
  isEnabled: boolean;
  isDefault: boolean;
  isCustom: boolean;
  ruleCount: number;
  skippedCount: number;
  updatedAt: number | null;
  state: FilterListStatus;
  failure: string | null;
};

export type BlockingState = {
  isEnabled: boolean;
  blocksAds: boolean;
  blocksTrackers: boolean;
  hidesCookieBanners: boolean;
  exemptHosts: string[];
  status: "preparing" | "ready" | "failed";
  failure: string | null;
  isUpdating: boolean;
  isOffline: boolean;
  lastUpdated: number | null;
  enabledRuleCount: number;
  buildError: string | null;
  myFilters: string;
  myFiltersRuleCount: number;
  myFiltersSkippedCount: number;
  lists: FilterList[];
};

export type MyFiltersResult = { ruleCount: number; skippedCount: number; isTooLarge: boolean };

export type BlockingEvent = { name: "blocking.state"; state: BlockingState };

export type Subscription = { remove(): void };
