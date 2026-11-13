import { createElement, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useRef, type ComponentType } from "react";
import { View, type LayoutChangeEvent, type NativeMethods, type NativeSyntheticEvent } from "react-native";
import type { NativeProps, PageEvent } from "@ardia/ardiacore";
import type { AppWindowsModule } from "../nativeModuleTypes";
import { followMotion } from "../animation/motion";
import { noteMissing } from "../missing";
import { requireNativeModule } from "../modules";
import { coversIn, hiddenByFullScreen, onCoversChange, pageRadiusIn, setFullScreenPage } from "./covers";
import { callPage, mountPage, showPage, type PageRect, type PageShape } from "./pages";
import { CoverAncestry } from "./usePageCover";
import { WindowIdContext } from "./windowId";

type PageEventsOnWindows = { onPageEvent?: (event: Pick<NativeSyntheticEvent<PageEvent>, "nativeEvent">) => void };

type Props = Pick<NativeProps, "url" | "profile" | "adoptId" | "tabId" | "visible" | "style"> & Partial<Pick<NativeProps, "pageEvents">> & PageEventsOnWindows;


const ARGUMENTS: Record<string, string[]> = {
  loadUrl: ["url", "userInitiated"],
  goBack: [],
  goForward: [],
  goToOffset: ["offset"],
  reload: [],
  forceReload: [],
  stopLoading: [],
  focus: [],
  setMuted: ["muted"],
  find: ["text", "forward", "findNext"],
  stopFinding: ["clear"],
  zoomStep: ["direction"],
  executeJavaScript: ["code"],
  evaluate: ["code"],
  navigationEntries: [],
  showDevTools: ["panel"],
  print: [],
  runPageCommand: ["name"],
  getSecurityInfo: [],
  mediaCommand: ["action", "seconds"],
  clearSiteData: [],
  pageCookies: ["urls"],
  openBlockedPopup: ["id", "always"],
  discard: ["unload"],
  setFrozen: ["frozen"],
  resolveUnresponsive: ["terminate"],
};
const UNWRAPPED: Record<string, (reply: Record<string, unknown> | null) => unknown> = {
  evaluate: (reply) => reply?.result ?? null,
  navigationEntries: (reply) => reply?.entries ?? [],
  pageCookies: (reply) => reply?.cookies ?? [],
  discard: (reply) => reply?.outcome ?? "refused",
  getSecurityInfo: (reply) => (!reply || reply.info === null ? null : reply),
  clearSiteData: (reply) => reply ?? { cookies: false, storage: false },
};
const ANSWERS: Record<string, unknown> = {
  requestPictureInPicture: false,
  takeControlPress: false,
};
const SETTLE_MS = [0, 50, 200, 500];


const setWindowFullScreen = (windowId: string, on: boolean) =>
  Promise.resolve(requireNativeModule<Pick<AppWindowsModule, "setPageFullScreen">>("ArdiaAppWindows").setPageFullScreen(windowId, on)).then(
    () => {},
    () => {},
  );

let unnamed = 0;

const overlaps = (a: PageRect, b: PageRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export const EngineWebView = forwardRef<unknown, Props>(function EngineWebView(props, ref) {
  const windowId = useContext(WindowIdContext);
  const above = useRef(useContext(CoverAncestry));
  above.current = useContext(CoverAncestry);
  const key = useRef(props.tabId || `page-${++unnamed}`).current;
  const view = useRef<Pick<NativeMethods, "measureInWindow"> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const visible = props.visible !== false;
  const shown = useRef<{ visible: boolean; placed: string }>({ visible: false, placed: "" });
  const fullScreen = useRef(false);

  const place = useCallback(() => {
    const wanted = latest.current.visible !== false && !hiddenByFullScreen(windowId, key);
    if (!wanted) {
      if (shown.current.visible) {
        shown.current = { visible: false, placed: "" };
        showPage(key, false, null);
      }
      return;
    }
    view.current?.measureInWindow((x, y, width, height) => {
      if (latest.current.visible === false || hiddenByFullScreen(windowId, key) || !(width > 0) || !(height > 0)) return;
      const page = { x, y, width, height };
      const shape: PageShape = fullScreen.current
        ? { ...page, radius: 0, holes: [] }
        : {
            ...page,
            radius: pageRadiusIn(windowId),
            holes: coversIn(windowId, above.current)
              .filter((cover) => overlaps(cover, page))
              .map((hole) => [hole.x, hole.y, hole.width, hole.height, hole.radius]),
          };
      const placed = JSON.stringify(shape);
      if (shown.current.visible && shown.current.placed === placed) return;
      shown.current = { visible: true, placed };
      showPage(key, true, shape);
    });
  }, [key, windowId]);

  useEffect(() => onCoversChange((changed) => changed === windowId && place()), [windowId, place]);

  useEffect(() => followMotion(place), [place]);

  useEffect(() => {
    const first = latest.current;
    const unmount = mountPage(key, { url: first.url, profile: first.profile, adopt: first.adoptId, windowId }, (name, data) => {
      if (name === "ready") place();
      if (name === "fullscreen") {
        const on = !!(data as { fullscreen?: unknown } | null)?.fullscreen;
        if (on !== fullScreen.current) {
          fullScreen.current = on;
          setFullScreenPage(windowId, key, on && latest.current.visible !== false);
          void setWindowFullScreen(windowId, on).then(() => {
            if (on && fullScreen.current) void callPage(key, "focus");
          });
          place();
        }
      }
      const now = latest.current;
      if (now.pageEvents && !now.pageEvents.includes(name)) return;
      now.onPageEvent?.({ nativeEvent: { name, data } });
    });
    return () => {
      shown.current = { visible: false, placed: "" };
      if (fullScreen.current) {
        fullScreen.current = false;
        setFullScreenPage(windowId, key, false);
        void setWindowFullScreen(windowId, false);
      }
      unmount();
    };
  }, [key, windowId, place]);

  useEffect(() => {
    if (fullScreen.current) setFullScreenPage(windowId, key, visible);
  }, [windowId, key, visible]);

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
            const names = ARGUMENTS[method];
            if (names) {
              const unwrap = UNWRAPPED[method];
              return async (...values: unknown[]) => {
                const reply = await callPage<Record<string, unknown>>(key, method, Object.fromEntries(names.map((name, index) => [name, values[index] ?? null])));
                return unwrap ? unwrap(reply) : undefined;
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
