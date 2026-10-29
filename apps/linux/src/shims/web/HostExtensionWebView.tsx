import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import { toAppUrl } from "@ardia/core";
import type { NavigationState, WebViewHandle, WebViewProps } from "@ardia-real/ardiacore";
import { ardiaHost, reportHostError } from "../../host";
import { HostExtensionView, type ExtensionViewEvent } from "../../hostExtensionView";
import { PopupSizeWaiters, extensionViewEvaluate } from "../../hostExtensionScripts";
import { watchTabViewport } from "../../hostViewport";
import { menuShown } from "../../menus";

export const HostExtensionWebView = forwardRef<WebViewHandle, WebViewProps>(function HostExtensionWebView(props, ref) {
  const latest = useRef(props);
  latest.current = props;
  const element = useRef<HTMLDivElement>(null);
  const view = useRef<HostExtensionView | null>(null);
  const navigation = useRef<NavigationState | null>(null);
  const ready = useRef(false);
  const sizes = useRef(new PopupSizeWaiters());

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

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    return watchTabViewport(node, () => latest.current.visible !== false && !menuShown(), (viewport) => {
      void view.current?.viewport({ rect: viewport.rect, visible: viewport.visible }).catch(reportHostError);
    });
  }, []);

  return <View style={[props.style, { backgroundColor: "transparent" }]}><div ref={element} data-ardia-extension-view={props.extensionHost} style={{ position: "absolute", inset: 0 }} /></View>;
});
