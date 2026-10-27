import type { ViewProps } from "react-native";
import type { ExternalAppRequest } from "./externalApps";
import type { FaviconImage } from "./favicons";
import type { PageCookie, PageEngine } from "./webkit";

export type NavigationState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  themeColor: string | null;
  themeColorSource: "meta" | "header" | "background" | null;
  initialDocumentAccessed?: boolean;
  committedInitial?: boolean;
  committedUrl?: string;
};

export type MediaState = { playing: boolean; muted: boolean };

export type NowPlaying = {
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  playbackState: "playing" | "paused" | "none";
  position: number;
  duration: number | null;
  playbackRate: number;
  timestamp: number;
  hasVideo: boolean;
  actions: string[];
  controllable: boolean;
};
export type MediaCommand = "play" | "pause" | "toggle" | "next" | "previous" | "seekBy" | "seekTo" | "stop";
export type MediaAccess = { camera: boolean; microphone: boolean; screen: boolean };

export type OpenDisposition = "foreground" | "background" | "window" | "popup" | "incognito" | "current" | "split" | "peek";

export type OpenWindowRequest = {
  url: string;
  disposition: OpenDisposition;
  adoptId?: string;
  userGesture?: boolean;
  postBody?: boolean;
  profile?: string;
  point?: { x: number; y: number };
};

export type BlockedPopup = { id: string; url: string; origin: string };

export type FindResult = { count: number; active: number; final: boolean };
export type PageCommand = {
  command: "search" | "ask" | "copyLinkToHighlight" | "escape";
  text: string;
  modifiers?: { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean };
};
export type LoadError = { url: string; code: number; text: string };
export type NavigationEntry = { url: string; title: string; current: boolean };
export type CrashInfo = { status: number; reason: "abnormal" | "killed" | "crashed" | "oom" | "launchFailed" | "integrity" | "unknown"; code: number };

export type CertificatePrincipal = { commonName: string; displayName: string; organizations: string[]; country: string };
export type Certificate = {
  subject: CertificatePrincipal;
  issuer: CertificatePrincipal;
  validFrom: number;
  validUntil: number;
  serialNumber?: string;
  sha256?: string;
  chainLength: number;
};
export type SecurityInfo = {
  level: "secure" | "mixed" | "insecure" | "certificateError" | "local" | "none";
  url: string;
  origin: string | null;
  protocol?: string;
  certificate?: Certificate;
  certificateErrors?: string[];
  mixedContent?: "ran" | "displayed" | null;
  isEV?: boolean;
};

export type DownloadNavigation = { url: string; committedUrl: string; skipped: boolean };

export type WebNotification = {
  id: string;
  title: string;
  body: string;
  icon: string | null;
  tag: string;
  silent: boolean;
  requireInteraction: boolean;
  origin: string;
  tabId: string | null;
  isMainFrame: boolean;
};

export type PictureInPictureState = { kind: "video" | "document"; active: boolean };
export type ControlPress = { clickAt: number; control: number };
export type ActivateRequest = { reason: "pictureInPicture" };
export type DisplayMediaSource = {
  id: string;
  kind: "screen" | "window";
  name: string;
  app?: string;
  pid?: number;
  width: number;
  height: number;
};
export type DisplayMediaAudio = { tab: boolean; screen: boolean; window: "application" | "system" | null };
export type DisplayMediaRequest = { id: string; origin: string; frameOrigin?: string; audio: DisplayMediaAudio | null; sources: DisplayMediaSource[] };

export type ZoomState = { zoom: number; host: string; isDefault: boolean; pinchScale: number };
export type ContentBlockedState = { count: number; url: string };

export type PasswordPrompt = {
  state: "save" | "update" | "saved";
  origin: string;
  username: string;
  passwordLength: number;
  federation: string;
  usernames: string[];
};
export type PasswordPromptAnswer = "save" | "update" | "never" | "nope" | "dismiss";
export type AutofillPrompt = {
  id: number;
  kind: "saveAddress" | "updateAddress" | "saveCard";
  origin: string;
  title: string;
  message: string;
  accept: string;
  decline: string;
  footer: string;
  lines: string[];
  changes?: { field: "name" | "address" | "email" | "phone" | "other"; from: string; to: string }[];
  newLabel?: string;
  oldLabel?: string;
};
export type AutofillPromptAnswer = "accept" | "decline" | "dismiss";
export type ExtensionActionResult = "none" | "popup" | "sidePanel";

export type WebViewProps = ViewProps & {
  engine?: PageEngine;
  url?: string;
  profile?: string;
  adoptId?: string;
  tabId?: string;
  temporary?: boolean;
  temporarySource?: string;
  standalone?: boolean;
  extensionHost?: "popup" | "sidePanel";
  visible?: boolean;
  warm?: boolean;
  neighbour?: boolean;
  pageBackgroundColor?: string;
  contentsBackgroundColor?: string;
  pageColor?: string;
  shownUrl?: string;
  autoPictureInPicture?: boolean;
  onNavigationChange?: (state: NavigationState) => void;
  onProgress?: (progress: number) => void;
  onFavicon?: (url: string, candidates: string[]) => void;
  onMedia?: (state: MediaState) => void;
  onNowPlaying?: (state: NowPlaying | null) => void;
  onMediaAccess?: (access: MediaAccess) => void;
  onOpenWindow?: (request: OpenWindowRequest) => void;
  onPopupBlocked?: (popup: BlockedPopup) => void;
  onFindResult?: (result: FindResult) => void;
  onFullscreen?: (fullscreen: boolean) => void;
  onStatus?: (text: string) => void;
  onCrashed?: (info: CrashInfo) => void;
  onUnresponsive?: () => void;
  onResponsive?: () => void;
  onLoadError?: (error: LoadError) => void;
  onSecurity?: (info: SecurityInfo) => void;
  onZoom?: (zoom: ZoomState) => void;
  onContentBlocked?: (state: ContentBlockedState) => void;
  onDownloadNavigation?: (navigation: DownloadNavigation) => void;
  onNotification?: (notification: WebNotification) => void;
  onNotificationClose?: (id: string) => void;
  onPictureInPicture?: (state: PictureInPictureState) => void;
  onActivateRequest?: (request: ActivateRequest) => void;
  onDisplayMediaRequest?: (request: DisplayMediaRequest) => void;
  onWindowClose?: () => void;
  onCommand?: (command: PageCommand) => void;
  onPageFocus?: () => void;
  onPagePress?: () => void;
  onPageMessage?: (kind: string, data: unknown) => void;
  onReady?: () => void;
  onDiscarded?: (url: string) => void;
  onPasswordPrompt?: (prompt: PasswordPrompt) => void;
  onAutofillPrompt?: (prompt: AutofillPrompt | null, id: number) => void;
  onExternalApp?: (request: ExternalAppRequest) => void;
  onPreferredSize?: (size: { width: number; height: number }) => void;
};

export type WebViewHandle = {
  nativeTag(): number | null;
  loadUrl(url: string, options?: { userInitiated?: boolean }): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  goToOffset(offset: number): Promise<void>;
  reload(): Promise<void>;
  forceReload(): Promise<void>;
  stopLoading(): Promise<void>;
  focus(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  zoomStep(direction: 1 | -1 | 0): Promise<void>;
  find(text: string, forward: boolean, findNext: boolean): Promise<void>;
  stopFinding(clearSelection: boolean): Promise<void>;
  print(): Promise<void>;
  runPageCommand(name: "savePage" | "systemPrint" | "caretBrowsing"): Promise<void>;
  showDevTools(panel?: string): Promise<void>;
  executeJavaScript(code: string): Promise<void>;
  evaluate<T = unknown>(code: string): Promise<T | null>;
  navigationEntries(): Promise<NavigationEntry[]>;
  capturePicture(scale: number): Promise<{ data: string; frame: [number, number, number, number] } | null>;
  downloadFavicon(url: string): Promise<FaviconImage | null>;
  downloadImage(url: string, maxPixels: number): Promise<FaviconImage | null>;

  mediaCommand(action: MediaCommand, seconds?: number): Promise<void>;
  requestPictureInPicture(press: ControlPress): Promise<boolean>;
  takeControlPress(press: ControlPress): Promise<boolean>;
  exitPictureInPicture(): Promise<void>;

  getSecurityInfo(): Promise<SecurityInfo | null>;
  pageCookies(urls: string[]): Promise<PageCookie[]>;
  openBlockedPopup(id: string, always?: boolean): Promise<void>;
  clearSiteData(): Promise<{ cookies: number | false; storage: boolean }>;

  resolvePasswordPrompt(answer: PasswordPromptAnswer, edits?: { username?: string; password?: string }): Promise<void>;
  resolveAutofillPrompt(id: number, answer: AutofillPromptAnswer): Promise<void>;
  executeExtensionAction(extensionId: string): Promise<ExtensionActionResult | null>;

  resolveDisplayMedia(id: string, sourceId: string | null, audio?: boolean): Promise<void>;
  mediaCaptureSourceId(): Promise<string | null>;
  notificationAction(id: string, action: "click" | "close"): Promise<void>;

  resolveUnresponsive(terminate: boolean): Promise<void>;
  discard(options?: { unload?: boolean }): Promise<DiscardOutcome>;
  setFrozen(frozen: boolean): Promise<void>;
};

export type DiscardOutcome = "discarded" | "already" | "refused" | "unsupported";
