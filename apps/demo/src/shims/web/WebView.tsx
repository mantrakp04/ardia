import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { NavigationState, WebViewHandle, WebViewProps } from "@ardia-real/ardiacore";
import { hostOf, isFrameable } from "../../frameable";
import { faviconFor, PAGE_THEMES, pageTitle } from "../../pages";
import { useBrowser } from "../../../../browser/src/state/browser/store";
import { REFUSED_PAGE_THEME } from "./RefusedPage";
import { RefusedPage } from "./RefusedPage";
import { createFrame, moveFrame, noteFrameSize, parkFrame, takeFrame } from "./framePool";


function readSameOrigin(frame: HTMLIFrameElement): { url: string; title: string } | null {
  try {
    const doc = frame.contentDocument;
    const url = frame.contentWindow?.location.href;
    return doc && url && url !== "about:blank" ? { url, title: doc.title || pageTitle(url) } : null;
  } catch {
    return null;
  }
}

const isBlank = (url: string) => !url || url === "about:blank";

type Page = { url: string; key: number };

export const WebView = forwardRef<WebViewHandle, WebViewProps>(function WebView(props, ref) {
  const latest = useRef(props);
  latest.current = props;
  const [page, setPage] = useState<Page | null>(null);
  const stack = useRef<{ entries: string[]; index: number }>({ entries: [], index: -1 });
  const keys = useRef(0);
  const loaded = useRef<string | null>(null);
  const inner = useRef({ depth: 0, url: null as string | null, title: null as string | null, back: false });

  const report = (pageUrl: string, isLoading: boolean) => {
    const { entries, index } = stack.current;
    const url = inner.current.url ?? pageUrl;
    const dark = useBrowser.getState().ui.appDark;
    const known = isFrameable(url) ? (PAGE_THEMES[url]?.[dark ? "dark" : "light"] ?? null) : REFUSED_PAGE_THEME[dark ? "dark" : "light"];
    const state: NavigationState = {
      url,
      title: inner.current.title ?? pageTitle(url),
      canGoBack: index > 0 || inner.current.depth > 0,
      canGoForward: index < entries.length - 1,
      isLoading,
      themeColor: known?.color ?? null,
      themeColorSource: known?.source ?? null,
    };
    latest.current.onNavigationChange?.(state);
  };

  const show = (url: string) => {
    inner.current = { depth: 0, url: null, title: null, back: false };
    setPage({ url, key: ++keys.current });
    const framed = isFrameable(url);
    report(url, framed);
    latest.current.onProgress?.(framed ? 0.3 : 1);
    const favicon = faviconFor(url);
    if (favicon) latest.current.onFavicon?.(favicon, [favicon]);
  };

  const visit = (url: string) => {
    if (isBlank(url)) return;
    const { entries, index } = stack.current;
    if (entries[index] === url) return report(url, isFrameable(url) && loaded.current !== url);
    stack.current = { entries: [...entries.slice(0, index + 1), url], index: index + 1 };
    show(url);
  };

  const step = (offset: number) => {
    const { entries, index } = stack.current;
    const target = index + offset;
    if (target < 0 || target >= entries.length) return;
    stack.current = { entries, index: target };
    show(entries[target]!);
  };

  useEffect(() => {
    queueMicrotask(() => latest.current.onReady?.());
    if (props.url) visit(props.url);
  }, []);

  const dark = useBrowser((s) => s.ui.appDark);
  useEffect(() => {
    const url = stack.current.entries[stack.current.index];
    if (url) report(url, false);
  }, [dark]);

  useImperativeHandle(ref, () => {
    const done = Promise.resolve();
    const handle: Partial<WebViewHandle> = {
      loadUrl: async (url) => visit(url),
      goBack: async () => {
        if (inner.current.depth <= 0) return step(-1);
        inner.current.depth--;
        inner.current.back = true;
        history.back();
      },
      goForward: async () => step(1),
      goToOffset: async (offset) => step(offset),
      reload: async () => {
        const current = stack.current.entries[stack.current.index];
        if (current) show(current);
      },
      forceReload: async () => handle.reload?.(),
      navigationEntries: async () => stack.current.entries.map((url, i) => ({ url, title: pageTitle(url), current: i === stack.current.index })),
      evaluate: async () => null,
      discard: async () => "unsupported",
      capturePicture: async () => null,
      getSecurityInfo: async () => {
        const url = stack.current.entries[stack.current.index] ?? "";
        return { level: url.startsWith("https://") ? "secure" : "none", url, origin: url ? new URL(url).origin : null };
      },
    };
    return new Proxy(handle, { get: (target, key) => (key in target ? target[key as keyof WebViewHandle] : () => done) }) as WebViewHandle;
  }, []);

  const frameHost = useRef<HTMLDivElement | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const framedUrl = page && isFrameable(page.url) ? page.url : null;
  const unmounting = useRef(false);
  useLayoutEffect(() => () => void (unmounting.current = true), []);

  useLayoutEffect(() => {
    const into = frameHost.current;
    if (!into || !page || !framedUrl) return;
    const reused = page.key === 1 ? takeFrame(framedUrl) : null;
    const next = reused ?? createFrame(framedUrl, pageTitle(framedUrl));
    const onLoad = () => {
      if (loaded.current === framedUrl && frame.current === next) {
        const sameOrigin = readSameOrigin(next);
        const depth = inner.current.back ? inner.current.depth : inner.current.depth + 1;
        const atStart = depth === 0;
        inner.current = { depth, url: atStart ? null : (sameOrigin?.url ?? inner.current.url), title: atStart ? null : (sameOrigin?.title ?? inner.current.title), back: false };
      }
      loaded.current = framedUrl;
      latest.current.onProgress?.(1);
      report(framedUrl, false);
    };
    next.addEventListener("load", onLoad);
    moveFrame(next, into);
    frame.current = next;
    if (reused?.dataset.loaded === framedUrl) onLoad();
    return () => {
      next.removeEventListener("load", onLoad);
      if (frame.current === next) frame.current = null;
      if (unmounting.current) parkFrame(next);
      else next.remove();
    };
  }, [page?.key, framedUrl]);

  useEffect(() => {
    const into = frameHost.current;
    if (!into) return;
    const observer = new ResizeObserver(() => noteFrameSize(into.clientWidth, into.clientHeight));
    observer.observe(into);
    return () => observer.disconnect();
  }, []);

  const visible = props.visible !== false;
  return (
    <View style={[props.style, { overflow: "hidden", backgroundColor: "#FFFFFF" }, !visible && { opacity: 0, pointerEvents: "none" }]}>
      <div ref={frameHost} inert={!visible} style={{ position: "absolute", inset: 0, display: framedUrl ? "block" : "none" }} />
      {page && !framedUrl ? <RefusedPage host={hostOf(page.url) || page.url} /> : null}
    </View>
  );
});
