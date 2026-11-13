import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import { toAppUrl, toEngineUrl } from "@ardia/core";
import type { WebViewHandle, WebViewProps } from "@ardia-real/ardiacore";
import { ardiaHost, reportHostError } from "../../host";
import { HostPageEvents } from "../../hostPageEvents";
import { applyHostPageThemeState, forgetHostPageState, resetHostPageState } from "../../hostPageHooks";
import { hostPageScript } from "../../hostPageScripts";
import { HostTab, type HostPageFactory, type HostTabEvent } from "../../hostTab";
import { extensionViewsSupported } from "../../hostExtensionView";
import { HostExtensionWebView } from "./HostExtensionWebView";
import { refreshTabViewports, watchTabViewport, type TabViewport } from "../../hostViewport";
import { inputRegions } from "../../shellAbove";
import type { InputRegionsRegistry } from "../../inputRegions";
import type { CornerRadii } from "../../hostExtensionView";
import { notingPageFocus } from "../../pageFocus";
import { withPopupDismissal } from "../../popupDismissal";

export const HostWebView = forwardRef<WebViewHandle, WebViewProps>(function HostWebView(props, ref) {
  return props.extensionHost && extensionViewsSupported(ardiaHost) ? <HostExtensionWebView ref={ref} {...props} /> : <HostTabWebView ref={ref} {...props} />;
});

const HostTabWebView = forwardRef<WebViewHandle, WebViewProps>(function HostTabWebView(props, ref) {
  const latest = useRef(props);
  latest.current = props;
  const element = useRef<HTMLDivElement>(null);
  const tab = useRef<HostTab | null>(null);
  const key = useRef(props.tabId ?? `host_${crypto.randomUUID()}`);
  const ready = useRef(false);

  const receive = (event: HostTabEvent) => {
    if (event.type !== "ready") return;
    refreshTabViewports();
    if (!ready.current) latest.current.onReady?.();
    ready.current = true;
  };
  const page: HostPageFactory = (claim, nativeId, rebound) => new HostPageEvents(claim, nativeId, () => notingPageFocus(withPopupDismissal(latest.current)),
    (reason, replaced) => { const tabId = latest.current.tabId; if (tabId) resetHostPageState(tabId, reason, replaced); },
    (state) => { const tabId = latest.current.tabId; if (tabId) applyHostPageThemeState(tabId, state); }, rebound);

  useEffect(() => {
    const host = ardiaHost!;
    const current = new HostTab(host, { key: key.current, temporary: !props.tabId, profile: props.profile, url: toEngineUrl(props.url ?? "about:blank"), ...(props.adoptId ? { adoptId: props.adoptId } : {}) }, receive, page);
    tab.current = current;
    void current.ready.catch((error) => {
      if (!current.disposed) latest.current.onLoadError?.({ url: latest.current.url ?? "", code: -2, text: String(error) });
      reportHostError(error);
    });
    return () => {
      current.dispose();
      if (tab.current === current) tab.current = null;
      const tabId = latest.current.tabId;
      if (tabId) forgetHostPageState(tabId);
    };
  }, []);

  useEffect(() => {
    void tab.current?.presentation(props.visible !== false).catch(reportHostError);
    refreshTabViewports();
  }, [props.visible]);

  useImperativeHandle(ref, () => new Proxy({} as WebViewHandle, {
    get(_target, property) {
      if (typeof property !== "string" || property === "then") return undefined;
      if (property === "nativeTag") return () => null;
      return async (...args: unknown[]) => {
        const current = tab.current;
        if (!current) throw new Error("Ardia tab is not mounted");
        if (property === "loadUrl") args[0] = toEngineUrl(args[0] as string);
        if (property === "getSecurityInfo") return current.pageResult(property, args);
        const script = hostPageScript(property, args);
        if (script) return script.map ? current.command(script.command, script.args).then(script.map, () => (script.failed ? script.failed() : script.map!(null))) : current.command(script.command, script.args);
        if (property === "evaluate") {
          const json = await current.pageResult<string | null>(property, args).catch(() => null);
          if (typeof json !== "string") return null;
          try { return JSON.parse(json); } catch { return null; }
        }
        const result = await current.command(property, args);
        if (property === "navigationEntries" && Array.isArray(result)) return result.map((entry: { url: string }) => ({ ...entry, url: toAppUrl(entry.url) }));
        return result;
      };
    },
  }), []);

  useEffect(() => {
    const node = element.current;
    const regions = inputRegions();
    if (!node || !regions) return;
    return watchPageBelowShell(node, regions, () => latest.current.visible !== false, () => tab.current);
  }, []);

  return <View style={[props.style, { backgroundColor: "transparent" }]}><div ref={element} data-ardia-native-tab={key.current} style={{ position: "absolute", inset: 0 }} /></View>;
});

export function watchPageBelowShell(node: HTMLElement, regions: InputRegionsRegistry, visible: () => boolean, page: () => { identity?: unknown; disposed?: boolean; viewport(viewport: TabViewport): Promise<void> } | null, radii?: () => CornerRadii) {
  let last = "";
  let revision = 0;
  const stop = watchTabViewport(node, visible, (viewport) => {
    if (!viewport.visible) regions.setPage(node, false, radii);
    regions.refresh();
    const current = page();
    if (!current?.identity) return;
    const json = JSON.stringify(viewport);
    if (json === last) return;
    last = json;
    const mine = ++revision;
    void current.viewport(viewport).then(() => {
      if (mine === revision && !current.disposed && viewport.visible) regions.setPage(node, true, radii);
    }, (error) => {
      if (mine === revision) last = "";
      reportHostError(error);
    });
  }, regions);
  return () => {
    revision++;
    stop();
    regions.dropPage(node);
  };
}
