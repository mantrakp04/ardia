import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import { toAppUrl } from "@ardia/core";
import type { NavigationState, WebViewHandle, WebViewProps } from "@ardia-real/ardiacore";
import { ardiaHost, reportHostError } from "../../host";
import { HostExtensionView, type CornerRadii, type ExtensionViewEvent, type NativeFrame, type PopupPlacement } from "../../hostExtensionView";
import { PopupSizeWaiters, extensionViewEvaluate } from "../../hostExtensionScripts";
import { refreshTabViewports } from "../../hostViewport";
import { inputRegions } from "../../shellAbove";
import { watchPageBelowShell } from "./HostWebView";

export type HostExtensionWebViewProps = WebViewProps & {
  placement?: Omit<PopupPlacement, "visible" | "decorated" | "decoratedScale">;
  onNativeFrame?: (frame: NativeFrame) => void;
  decorationVisible?: () => boolean;
};

const DECORATION_WAIT_FRAMES = 60;

const CORNERS = [["upperLeft", "TopLeft"], ["upperRight", "TopRight"], ["lowerRight", "BottomRight"], ["lowerLeft", "BottomLeft"]] as const;

export function clipRadii(node: HTMLElement): CornerRadii {
  const radii: CornerRadii = { upperLeft: 0, upperRight: 0, lowerRight: 0, lowerLeft: 0 };
  const box = node.getBoundingClientRect();
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const outer = parent.getBoundingClientRect();
    const insets = { upperLeft: [box.left - outer.left, box.top - outer.top], upperRight: [outer.right - box.right, box.top - outer.top], lowerRight: [outer.right - box.right, outer.bottom - box.bottom], lowerLeft: [box.left - outer.left, outer.bottom - box.bottom] };
    let rounded = false;
    for (const [corner, css] of CORNERS) {
      const radius = parseFloat(style.getPropertyValue(`border-${css.replace(/([A-Z])/g, "-$1").toLowerCase().slice(1)}-radius`)) || 0;
      if (radius <= 0) continue;
      rounded = true;
      const inset = Math.max(...insets[corner]);
      if (Math.min(...insets[corner]) > -0.5 && inset <= 2) radii[corner] = Math.max(0, radius - Math.max(0, inset));
    }
    if (rounded) return radii;
  }
  return radii;
}

const visiblePage = () => typeof document === "undefined" || !document.hidden;

export const HostExtensionWebView = forwardRef<WebViewHandle, HostExtensionWebViewProps>(function HostExtensionWebView(props, ref) {
  const latest = useRef(props);
  latest.current = props;
  const element = useRef<HTMLDivElement>(null);
  const view = useRef<HostExtensionView | null>(null);
  const navigation = useRef<NavigationState | null>(null);
  const ready = useRef(false);
  const sizes = useRef(new PopupSizeWaiters());
  const decorated = useRef<{ serial: number; scale: number } | null>(null);

  const place = () => {
    const p = latest.current;
    const current = view.current;
    if (!current || !p.placement) return;
    const ack = decorated.current;
    void current.place({ ...p.placement, visible: p.visible !== false && visiblePage(), ...(ack ? { decorated: ack.serial, decoratedScale: ack.scale } : {}) }).catch(reportHostError);
  };

  const receive = (event: ExtensionViewEvent) => {
    const p = latest.current;
    if (event.type === "ready") {
      if (!ready.current) p.onReady?.();
      ready.current = true;
    } else if (event.type === "navigation") {
      const state = event.state as NavigationState;
      navigation.current = { ...state, url: toAppUrl(state.url) };
      p.onNavigationChange?.(navigation.current);
    } else if (event.type === "preferredSize") {
      const size = event.value as { width: number; height: number };
      if (Number.isFinite(size?.width) && Number.isFinite(size?.height)) {
        p.onPreferredSize?.(size);
        sizes.current.note(size);
      }
    } else if (event.type === "frame") {
      const frame = event.value as NativeFrame;
      if (![frame?.x, frame?.y, frame?.width, frame?.height, frame?.serial].every(Number.isFinite)) return;
      p.onNativeFrame?.(frame);
      let waited = 0;
      const acknowledge = () => {
        if ((decorated.current?.serial ?? 0) >= frame.serial) return;
        const visible = latest.current.decorationVisible;
        if (visible && !visible()) {
          if (++waited < DECORATION_WAIT_FRAMES) requestAnimationFrame(acknowledge);
          return;
        }
        decorated.current = { serial: frame.serial, scale: window.devicePixelRatio || 1 };
        place();
      };
      requestAnimationFrame(() => requestAnimationFrame(acknowledge));
    } else if (event.type === "windowClose") p.onWindowClose?.();
  };

  useEffect(() => {
    const current = new HostExtensionView(ardiaHost!, { kind: props.extensionHost!, url: props.url ?? "", profile: props.profile }, receive);
    view.current = current;
    void current.ready.catch((error) => {
      if (!current.disposed) latest.current.onLoadError?.({ url: latest.current.url ?? "", code: -2, text: String(error) });
      reportHostError(error);
    });
    return () => {
      current.dispose();
      sizes.current.close();
      if (view.current === current) view.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => new Proxy({} as WebViewHandle, {
    get(_target, property) {
      if (typeof property !== "string" || property === "then") return undefined;
      if (property === "nativeTag") return () => null;
      return async (...args: unknown[]) => {
        const current = view.current;
        if (!current) throw new Error("Ardia extension view is not mounted");
        if (property === "evaluate") return extensionViewEvaluate(args[0], sizes.current);
        if (property !== "focus") throw new Error(`Extension views do not support ${property}`);
        return current.command(property, args);
      };
    },
  }), []);

  useEffect(refreshTabViewports, [props.visible]);

  useEffect(place, [JSON.stringify(props.placement), props.visible]);

  useEffect(() => {
    if (props.extensionHost !== "popup") return;
    document.addEventListener("visibilitychange", place);
    void view.current?.ready.then(place, () => {});
    return () => document.removeEventListener("visibilitychange", place);
  }, []);

  useEffect(() => {
    const node = element.current;
    const regions = inputRegions();
    if (!node || !regions || props.extensionHost !== "sidePanel") return;
    const visible = () => latest.current.visible !== false;
    return watchPageBelowShell(node, regions, visible, () => view.current && { identity: true, disposed: view.current.disposed, viewport: (viewport) => view.current!.viewport({ ...viewport, radii: clipRadii(node) }) }, () => clipRadii(node));
  }, []);

  return <View style={[props.style, { backgroundColor: "transparent" }]}><div ref={element} data-ardia-extension-view={props.extensionHost} style={{ position: "absolute", inset: 0 }} /></View>;
});
