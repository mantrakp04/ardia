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
import { backdropCovers, hostOverlayBlocked, refreshTabViewports, watchTabViewport, type TabViewport } from "../../hostViewport";
import { menuShown } from "../../menus";
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
  const requestedUrl = useRef(props.url);
  const ready = useRef(false);

  const receive = (event: HostTabEvent) => {
    if (event.type !== "ready") return;
    refreshTabViewports();
    if (!ready.current) latest.current.onReady?.();
    ready.current = true;
  };
  const page: HostPageFactory = (claim, nativeId, rebound) => new HostPageEvents(claim, nativeId, () => withPopupDismissal(latest.current),
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
    if (props.url === undefined || props.url === requestedUrl.current) return;
    requestedUrl.current = props.url;
    void tab.current?.command("loadUrl", [toEngineUrl(props.url)]).catch(reportHostError);
  }, [props.url]);

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
        if (property === "loadUrl") {
          requestedUrl.current = args[0] as string;
          args[0] = toEngineUrl(args[0] as string);
        }
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
    if (!node) return;
    let revision = 0;
    let last = "";
    let backdrop: Promise<boolean> | null = null;
    let captured: NonNullable<TabViewport["occlusions"]> = [];
    let retryAfter = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const stop = watchTabViewport(node, () => {
      const p = latest.current;
      return p.visible !== false && !menuShown() && !hostOverlayBlocked(p.tabId);
    }, (viewport) => {
      const current = tab.current;
      if (!current?.identity) return;
      if (viewport.occlusions?.length && Date.now() < retryAfter) return;
      const json = JSON.stringify(viewport);
      if (json === last) return;
      last = json;
      const mine = ++revision;
      void (async () => {
        if (viewport.visible && viewport.occlusions?.length) {
          if (backdrop && !backdropCovers(captured, viewport.occlusions)) backdrop = null;
          if (!backdrop) {
            captured = viewport.occlusions;
            const capture: Promise<boolean> = current.command<string | null>("captureViewport").then(async (data) => {
              if (!data) return false;
              const image = new Image();
              image.src = data;
              await image.decode();
              if (current.disposed || backdrop !== capture) return false;
              node.style.backgroundImage = `url("${data}")`;
              return true;
            }).catch((error) => {
              reportHostError(error);
              return false;
            });
            backdrop = capture;
          }
          if (!await backdrop) {
            if (mine === revision) {
              backdrop = null;
              last = "";
              retryAfter = Date.now() + 250;
              retry = setTimeout(refreshTabViewports, 250);
            }
            return;
          }
        }
        if (mine !== revision || current.disposed) return;
        await current.viewport(viewport);
        if (mine === revision && !viewport.occlusions?.length) {
          backdrop = null;
          node.style.backgroundImage = "";
        }
      })().catch((error) => {
        if (mine === revision) {
          last = "";
          clearTimeout(retry);
          retry = setTimeout(refreshTabViewports, 250);
        }
        reportHostError(error);
      });
    });
    return () => {
      revision++;
      backdrop = null;
      clearTimeout(retry);
      stop();
    };
  }, []);

  return <View style={[props.style, { backgroundColor: "transparent" }]}><div ref={element} data-ardia-native-tab={key.current} style={{ position: "absolute", inset: 0, backgroundSize: "100% 100%" }} /></View>;
});
