import { toAppUrl } from "@ardia/core";
import type { NativeSyntheticEvent } from "react-native";
import type { ExternalAppRequest } from "./permissions";
import type {
  ActivateRequest,
  AutofillPrompt,
  BlockedPopup,
  ContentBlockedState,
  CrashInfo,
  DisplayMediaRequest,
  DownloadNavigation,
  FindResult,
  LoadError,
  MediaAccess,
  MediaState,
  NavigationState,
  NowPlaying,
  OpenWindowRequest,
  PageCommand,
  PageSelection,
  PasswordPrompt,
  PictureInPictureState,
  ProtectedMediaRequest,
  ScrollState,
  SecurityInfo,
  WebNotification,
  WebViewProps,
  ZoomState,
} from "./pageTypes";

type NativeEvents = {
  onNavigationChange: NavigationState;
  onProgress: { progress: number };
  onFavicon: { url: string; urls: string[] };
  onMedia: MediaState;
  onNowPlaying: { state: NowPlaying | null };
  onMediaAccess: MediaAccess;
  onOpenWindow: OpenWindowRequest;
  onPopupBlocked: BlockedPopup;
  onFindResult: FindResult;
  onFullscreen: { fullscreen: boolean };
  onStatus: { text: string };
  onCrashed: CrashInfo;
  onUnresponsive: object;
  onResponsive: object;
  onLoadError: LoadError;
  onSecurity: SecurityInfo;
  onZoom: ZoomState;
  onContentBlocked: ContentBlockedState;
  onDownloadNavigation: DownloadNavigation;
  onNotification: WebNotification;
  onNotificationClose: { id: string };
  onPictureInPicture: PictureInPictureState;
  onActivateRequest: ActivateRequest;
  onDisplayMediaRequest: DisplayMediaRequest;
  onWindowClose: object;
  onCommand: PageCommand;
  onPageFocus: object;
  onPagePress: object;
  onSelection: { selection: PageSelection | null };
  onScroll: { state: ScrollState };
  onProtectedMedia: ProtectedMediaRequest;
  onReady: object;
  onDiscarded: { url: string };
  onPasswordPrompt: PasswordPrompt;
  onAutofillPrompt: AutofillPrompt | { id: number; closed: true };
  onExternalApp: ExternalAppRequest;
  onPreferredSize: { width: number; height: number };
};
export type Handlers = keyof NativeEvents;
export type PageEvent = { name: string; data: unknown };
export type NativeProps = Omit<WebViewProps, Handlers> & { pageEvents: string[]; onPageEvent: (e: NativeSyntheticEvent<PageEvent>) => void };

const PAGE_EVENTS = {
  onNavigationChange: "navigation",
  onProgress: "progress",
  onFavicon: "favicon",
  onMedia: "media",
  onNowPlaying: "nowPlaying",
  onMediaAccess: "mediaAccess",
  onOpenWindow: "openWindow",
  onPopupBlocked: "popupBlocked",
  onFindResult: "find",
  onFullscreen: "fullscreen",
  onStatus: "status",
  onCrashed: "crashed",
  onUnresponsive: "unresponsive",
  onResponsive: "responsive",
  onLoadError: "loadError",
  onSecurity: "security",
  onZoom: "zoom",
  onContentBlocked: "contentBlocked",
  onDownloadNavigation: "downloadNavigation",
  onNotification: "notification",
  onNotificationClose: "notificationClose",
  onPictureInPicture: "pictureInPicture",
  onActivateRequest: "activateRequest",
  onDisplayMediaRequest: "displayMediaRequest",
  onWindowClose: "windowClose",
  onCommand: "command",
  onPageFocus: "focus",
  onPagePress: "pagePress",
  onSelection: "selection",
  onScroll: "scroll",
  onProtectedMedia: "protectedMedia",
  onReady: "ready",
  onDiscarded: "discarded",
  onPasswordPrompt: "passwordPrompt",
  onAutofillPrompt: "autofillPrompt",
  onExternalApp: "externalApp",
  onPreferredSize: "preferredSize",
} as const satisfies Record<Handlers, string>;
export type PageEventName = (typeof PAGE_EVENTS)[Handlers];
export const pageEventOf = (handler: Handlers): PageEventName => PAGE_EVENTS[handler];
const HANDLER_OF_PAGE_EVENT = new Map<string, Handlers>(Object.entries(PAGE_EVENTS).map(([handler, name]) => [name, handler as Handlers]));

const unwrap: { [K in Handlers]: (e: NativeEvents[K]) => Parameters<NonNullable<WebViewProps[K]>> } = {
  onNavigationChange: (e) => [{ ...e, url: toAppUrl(e.url) }],
  onProgress: (e) => [e.progress],
  onFavicon: (e) => [e.url, e.urls],
  onMedia: (e) => [e],
  onNowPlaying: (e) => [e.state],
  onMediaAccess: (e) => [e],
  onOpenWindow: (e) => [{ ...e, url: toAppUrl(e.url) }],
  onPopupBlocked: (e) => [{ ...e, url: toAppUrl(e.url) }],
  onFindResult: (e) => [e],
  onFullscreen: (e) => [e.fullscreen],
  onStatus: (e) => [e.text],
  onCrashed: (e) => [e],
  onUnresponsive: () => [],
  onResponsive: () => [],
  onLoadError: (e) => [{ ...e, url: toAppUrl(e.url) }],
  onSecurity: (e) => [e],
  onZoom: (e) => [e],
  onContentBlocked: (e) => [e],
  onDownloadNavigation: (e) => [{ ...e, url: toAppUrl(e.url), committedUrl: toAppUrl(e.committedUrl) }],
  onNotification: (e) => [e],
  onNotificationClose: (e) => [e.id],
  onPictureInPicture: (e) => [e],
  onActivateRequest: (e) => [e],
  onDisplayMediaRequest: (e) => [e],
  onWindowClose: () => [],
  onCommand: (e) => [e],
  onPageFocus: () => [],
  onPagePress: () => [],
  onSelection: (e) => [e.selection],
  onScroll: (e) => [e.state],
  onProtectedMedia: (e) => [e],
  onReady: () => [],
  onDiscarded: (e) => [toAppUrl(e.url)],
  onPasswordPrompt: (e) => [e],
  onAutofillPrompt: (e) => ("closed" in e ? [null, e.id] : [e, e.id]),
  onExternalApp: (e) => [e],
  onPreferredSize: (e) => [e],
};

export const isPageEventProp = (key: string): key is Handlers => key in unwrap;

export function deliverPageEvent(props: WebViewProps, { name, data }: PageEvent) {
  const handler = HANDLER_OF_PAGE_EVENT.get(name);
  const listener = handler && (props[handler] as ((...args: unknown[]) => void) | undefined);
  if (listener) listener(...(unwrap[handler] as (data: unknown) => unknown[])(data));
}
