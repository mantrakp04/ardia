import { createElement, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useRef, type ComponentType } from "react";
import { PixelRatio, View, type LayoutChangeEvent } from "react-native";
import { noteMissing } from "../missing";
import { callPage, mountPage, showPage, type PageRect } from "./pages";
import { WindowIdContext } from "./windowId";

type PageEvent = { nativeEvent: { name: string; data: unknown } };

type Props = {
  url?: string;
  profile?: string;
  adoptId?: string;
  tabId?: string;
  visible?: boolean;
  pageEvents?: string[];
  onPageEvent?: (event: PageEvent) => void;
  style?: unknown;
};

type Measured = { measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void };

const ENGINE_METHODS = new Set(["loadUrl", "goBack", "goForward", "goToOffset", "reload", "forceReload", "stopLoading", "focus", "setMuted"]);
const ARGUMENTS: Record<string, string[]> = { loadUrl: ["url", "userInitiated"], goToOffset: ["offset"], setMuted: ["muted"] };
const ANSWERS: Record<string, unknown> = {
  navigationEntries: [],
  pageCookies: [],
  discard: "refused",
  clearSiteData: { cookies: false, storage: false },
  requestPictureInPicture: false,
  takeControlPress: false,
};
const SETTLE_MS = [0, 50, 200, 500];

let unnamed = 0;

const samePlace = (a: PageRect | null, b: PageRect | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export const EngineWebView = forwardRef<unknown, Props>(function EngineWebView(props, ref) {
  const windowId = useContext(WindowIdContext);
  const key = useRef(props.tabId || `page-${++unnamed}`).current;
  const view = useRef<Measured | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const visible = props.visible !== false;
  const shown = useRef<{ visible: boolean; rect: PageRect | null }>({ visible: false, rect: null });

  const place = useCallback(() => {
    const wanted = latest.current.visible !== false;
    if (!wanted) {
      if (shown.current.visible) {
        shown.current = { visible: false, rect: null };
        showPage(key, false, null);
      }
      return;
    }
    view.current?.measureInWindow((x, y, width, height) => {
      if (latest.current.visible === false || !(width > 0) || !(height > 0)) return;
      const scale = PixelRatio.get();
      const rect = { x: Math.round(x * scale), y: Math.round(y * scale), width: Math.round(width * scale), height: Math.round(height * scale) };
      if (shown.current.visible && samePlace(shown.current.rect, rect)) return;
      shown.current = { visible: true, rect };
      showPage(key, true, rect);
    });
  }, [key]);

  useEffect(() => {
    const first = latest.current;
    const unmount = mountPage(key, { url: first.url, profile: first.profile, adopt: first.adoptId, windowId }, (name, data) => {
      if (name === "ready") place();
      const now = latest.current;
      if (now.pageEvents && !now.pageEvents.includes(name)) return;
      now.onPageEvent?.({ nativeEvent: { name, data } });
    });
    return () => {
      shown.current = { visible: false, rect: null };
      unmount();
    };
  }, [key, windowId, place]);

  useEffect(() => {
    const timers = SETTLE_MS.map((delay) => setTimeout(place, delay));
    return () => timers.forEach(clearTimeout);
  });

  useImperativeHandle(
    ref,
    () =>
      new Proxy(
        {},
        {
          get(_target, method) {
            if (typeof method !== "string" || method === "then" || method === "$$typeof") return undefined;
            if (ENGINE_METHODS.has(method)) {
              return (...values: unknown[]) => {
                const names = ARGUMENTS[method] ?? [];
                return callPage(key, method, Object.fromEntries(names.map((name, index) => [name, values[index] ?? null])));
              };
            }
            return async () => {
              noteMissing(`<ArdiaWebView>.${method}`);
              return Object.hasOwn(ANSWERS, method) ? ANSWERS[method] : null;
            };
          },
        },
      ),
    [key],
  );

  const onLayout = useCallback((_event: LayoutChangeEvent) => place(), [place]);

  return createElement(View as ComponentType<Record<string, unknown>>, {
    ref: view,
    style: props.style,
    onLayout,
    collapsable: false,
    pointerEvents: visible ? "auto" : "none",
  });
});
