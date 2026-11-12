import { toAppUrl, toEngineUrl } from "@ardia/core";
import { requireNativeViewManager } from "expo-modules-core";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { findNodeHandle, type NativeSyntheticEvent } from "react-native";
import type { FaviconImage } from "./favicons";
import { ArdiaError, ardiaError } from "@ardia/core";
import { deliverPageEvent, isPageEventProp, pageEventOf, type NativeProps, type PageEvent } from "./pageEvents";
import type { DiscardOutcome, WebViewHandle, WebViewProps } from "./pageTypes";
import type { PageCookie } from "./webkit";

type NativeHandle = Omit<
  WebViewHandle,
  "evaluate" | "loadUrl" | "downloadFavicon" | "resolvePasswordPrompt" | "discard" | "nativeTag" | "requestPictureInPicture" | "takeControlPress"
> & {
  requestPictureInPicture(clickAt: number, control: number): Promise<boolean>;
  takeControlPress(clickAt: number, control: number): Promise<boolean>;
  evaluate(code: string): Promise<string | null>;
  downloadFavicon(url: string): Promise<FaviconImage | null>;
  loadUrl(url: string, userInitiated?: boolean): Promise<void>;
  resolvePasswordPrompt(answer: string, username: string | null, password: string | null): Promise<void>;
  discard(unload: boolean): Promise<DiscardOutcome>;
};

const NativeWebView = requireNativeViewManager<NativeProps>("ArdiaWebView");
let NativeWebKitView: typeof NativeWebView | undefined;
const webKitView = () => (NativeWebKitView ??= requireNativeViewManager<NativeProps>("ArdiaWebKit"));

const VIEW_RETRIES = 3;
const isViewMissing = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === "ERR_ARGUMENT_CAST" &&
  /Unable to find the '\w+' view with tag/.test(String((error as { message?: unknown }).message));

export const WebView = forwardRef<WebViewHandle, WebViewProps>(function WebView(props, ref) {
  const native = useRef<NativeHandle>(null);
  useImperativeHandle(ref, () => {
    const call = async <T,>(fallback: T, fn: (view: NativeHandle) => Promise<T>): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        const view = native.current;
        if (!view) return fallback;
        try {
          return await fn(view);
        } catch (error) {
          if (!isViewMissing(error)) throw ardiaError(error);
          if (attempt >= VIEW_RETRIES || native.current !== view) return fallback;
          await new Promise((resolve) => setTimeout(resolve, 16 * (attempt + 1)));
        }
      }
    };
    return {
      nativeTag: () => findNodeHandle(native.current as Parameters<typeof findNodeHandle>[0]),
      loadUrl: (url, options) =>
        call(undefined, (n) => n.loadUrl(toEngineUrl(url), options?.userInitiated ?? false)),
      goBack: () => call(undefined, (n) => n.goBack()),
      goForward: () => call(undefined, (n) => n.goForward()),
      goToOffset: (offset) => call(undefined, (n) => n.goToOffset(offset)),
      reload: () => call(undefined, (n) => n.reload()),
      forceReload: () => call(undefined, (n) => n.forceReload()),
      stopLoading: () => call(undefined, (n) => n.stopLoading()),
      focus: () => call(undefined, (n) => n.focus()),
      setMuted: (muted) => call(undefined, (n) => n.setMuted(muted)),
      zoomStep: (direction) => call(undefined, (n) => n.zoomStep(direction)),
      find: (text, forward, findNext) => call(undefined, (n) => n.find(text, forward, findNext)),
      stopFinding: (clear) => call(undefined, (n) => n.stopFinding(clear)),
      print: () => call(undefined, (n) => n.print()),
      runPageCommand: (name) => call(undefined, (n) => n.runPageCommand(name)),
      showDevTools: (panel) => call(undefined, (n) => n.showDevTools(panel)),
      executeJavaScript: (code) => call(undefined, (n) => n.executeJavaScript(code)),
      evaluate: async <T,>(code: string) => {
        const json = await call(null, (n) => n.evaluate(code));
        if (json == null) return null;
        try {
          return JSON.parse(json) as T;
        } catch {
          throw new ArdiaError("ERR_BAD_REPLY", "the page's result isn't JSON");
        }
      },
      navigationEntries: async () => (await call([], (n) => n.navigationEntries())).map((e) => ({ ...e, url: toAppUrl(e.url) })),
      capturePicture: (scale) => call(null, (n) => n.capturePicture(scale)),
      downloadImage: (url, maxPixels) => call(null, (n) => n.downloadImage(url, maxPixels)),
      downloadFavicon: (url) => call(null, (n) => n.downloadFavicon(url)),
      mediaCommand: (action, seconds) => call(undefined, (n) => n.mediaCommand(action, seconds)),
      requestPictureInPicture: (press) => call(false, (n) => n.requestPictureInPicture(press.clickAt, press.control)),
      takeControlPress: (press) => call(false, (n) => n.takeControlPress(press.clickAt, press.control)),
      exitPictureInPicture: () => call(undefined, (n) => n.exitPictureInPicture()),
      getSecurityInfo: () => call(null, (n) => n.getSecurityInfo()),
      pageCookies: (urls) => call<PageCookie[]>([], (n) => n.pageCookies(urls)),
      openBlockedPopup: (id, always) => call(undefined, (n) => n.openBlockedPopup(id, always)),
      clearSiteData: () => call({ cookies: false, storage: false }, (n) => n.clearSiteData()),
      resolvePasswordPrompt: (answer, edits) =>
        call(undefined, (n) => n.resolvePasswordPrompt(answer, edits?.username ?? null, edits?.password ?? null)),
      resolveAutofillPrompt: (id, answer) => call(undefined, (n) => n.resolveAutofillPrompt(id, answer)),
      executeExtensionAction: (extensionId) => call(null, (n) => n.executeExtensionAction(extensionId)),
      resolveDisplayMedia: (id, sourceId, audio = false) => call(undefined, (n) => n.resolveDisplayMedia(id, sourceId, audio)),
      mediaCaptureSourceId: () => call(null, (n) => n.mediaCaptureSourceId()),
      notificationAction: (id, action) => call(undefined, (n) => n.notificationAction(id, action)),
      resolveUnresponsive: (terminate) => call(undefined, (n) => n.resolveUnresponsive(terminate)),
      discard: (options) => call<DiscardOutcome>("refused", (n) => n.discard(options?.unload ?? false)),
      setFrozen: (frozen) => call(undefined, (n) => n.setFrozen(frozen)),
    };
  });

  const latest = useRef(props);
  latest.current = props;
  const onPageEvent = useRef((e: NativeSyntheticEvent<PageEvent>) => deliverPageEvent(latest.current, e.nativeEvent)).current;
  const nativeProps: Record<string, unknown> = { onPageEvent };
  const pageEvents: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === "engine") continue;
    if (isPageEventProp(key)) {
      if (typeof value === "function") pageEvents.push(pageEventOf(key));
      continue;
    }
    nativeProps[key] = (key === "url" || key === "shownUrl") && typeof value === "string" ? toEngineUrl(value) : value;
  }
  nativeProps.pageEvents = pageEvents.sort();

  const Native = props.engine === "webkit" ? webKitView() : NativeWebView;
  return (
    <Native
      // @ts-expect-error expo view managers accept a ref to their AsyncFunctions
      ref={native}
      {...(nativeProps as NativeProps)}
    />
  );
});
