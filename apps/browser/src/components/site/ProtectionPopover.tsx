import { getContentBlocker, getPrivacySettings, onContentBlockerChange, setContentBlockerAllowed, type ContentBlockerState, type SecurityInfo } from "@ardia/ardiacore";
import { displayHost } from "@ardia/core";
import { confirm, Symbol } from "@ardia/shell";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { PROVIDER_TITLES } from "../../lib/contentBlockerProvider";
import { usePrivacySettings } from "../../lib/privacySettings";
import { useTheme } from "../../lib/theme";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import { tabEngine } from "../../store/engines";
import { useTab } from "../../store/hooks";
import { engineProfile, incognitoOriginal, isIncognitoProfile } from "../../store/model";
import { PanelCloseButton, Popover, PopoverRow, PopoverSeparator, PromptButton, Toggle, ToolbarButton, usePopoverPresence } from "../layout/controls";
import type { ToolbarPalette } from "../layout/toolbarColors";
import { patchPage, setPopover, usePage } from "../layout/pageState";
import { openSettings } from "../settings/windows";

export const PROTECTION_WIDTH = 340;

type ProtectionButtonProps = { tabId: string; open: boolean; palette: ToolbarPalette; onFocus: () => void };

export function ProtectionButton(props: ProtectionButtonProps) {
  const engine = useBrowser(s => tabEngine(s, props.tabId));
  return engine === "chromium" ? <ChromiumProtectionButton {...props} /> : null;
}

function ChromiumProtectionButton({ tabId, open, palette, onFocus }: ProtectionButtonProps) {
  const tab = useTab(tabId);
  const url = tab?.url ?? "";
  const profileId = tab?.profileId ?? "";
  const profile = engineProfile(isIncognitoProfile(profileId) ? incognitoOriginal(profileId) : profileId);
  const key = `${profile}:${url}`;
  const [status, setStatus] = useState({ key: "", enabled: false });
  useEffect(() => {
    let live = true;
    let request = 0;
    const refresh = async () => {
      const id = ++request;
      try {
        const [blocker, privacy] = await Promise.all([getContentBlocker(), getPrivacySettings(profile, url)]);
        if (live && id === request) setStatus({ key, enabled: blocker.stats.ready && blocker.enabled && privacy.ready && privacy.blocking });
      } catch {
        if (live && id === request) setStatus({ key, enabled: false });
      }
    };
    void refresh();
    const listener = onContentBlockerChange(() => void refresh());
    return () => { live = false; listener.remove(); };
  }, [profile, url]);
  return <ToolbarButton palette={palette} icon={status.key === key && status.enabled ? "shield.lefthalf.filled" : "shield"} size={13} box={26} radius={6} tooltip="Privacy protections" active={open} onPress={() => {
    onFocus();
    setPopover(tabId, open ? null : "protection");
  }} />;
}


export function ProtectionPopover({ tabId, open, ...position }: { tabId: string; open: boolean; right?: number; left?: number; top: number }) {
  const engine = useBrowser(s => tabEngine(s, tabId));
  const presence = usePopoverPresence(open && engine === "chromium");
  const tab = useTab(tabId);
  useEffect(() => {
    if (open && engine !== "chromium") setPopover(tabId, null);
  }, [engine, open, tabId]);
  if (engine !== "chromium" || !presence.shown || !tab || !/^https?:\/\//i.test(tab.url)) return null;
  return <ProtectionPanel key={`${tab.id}:${tab.profileId}:${tab.url}`} tabId={tabId} {...position} closing={presence.closing} onClosed={presence.onClosed} />;
}

function Metric({ value, title, detail, wide = false }: { value: number | null; title: string; detail: string; wide?: boolean }) {
  const theme = useTheme();
  return <View accessible accessibilityLabel={`${title}: ${value === null ? "Unavailable" : value.toLocaleString()}. ${detail}`} style={{ flex: 1, flexDirection: wide ? "row" : "column", alignItems: wide ? "center" : undefined, gap: wide ? 12 : 0, padding: 12, borderRadius: 10, backgroundColor: theme.dark ? "rgba(255,255,255,0.055)" : "rgba(0,0,0,0.04)" }}>
    <Text style={{ fontSize: 25, lineHeight: 30, fontWeight: "600", fontVariant: ["tabular-nums"], color: theme.textPrimary }}>{value === null ? "—" : value.toLocaleString()}</Text>
    <View style={wide ? { flex: 1 } : undefined}>
      <Text style={{ fontSize: 12, fontWeight: "500", color: theme.textPrimary, marginTop: wide ? 0 : 3 }}>{title}</Text>
      <Text style={{ fontSize: 11, color: theme.textSecondary, marginTop: 3 }}>{detail}</Text>
    </View>
  </View>;
}

function connectionStatus(security: SecurityInfo | null) {
  switch (security?.level) {
    case "secure": return { title: "Secure connection", detail: "This page uses HTTPS", icon: "lock.fill" };
    case "certificateError": return { title: "Certificate warning", detail: "Avoid entering sensitive information", icon: "exclamationmark.triangle" };
    case "mixed": return { title: "Mixed content", detail: "Parts of this page are not secure", icon: "lock.open" };
    case "insecure": return { title: "Unencrypted connection", detail: "This page does not use HTTPS", icon: "lock.open" };
    case "local": return { title: "Local page", detail: "Content served on this device", icon: "desktopcomputer" };
    default: return { title: "Connection", detail: "Security information unavailable", icon: "info.circle" };
  }
}

function ProtectionPanel({ tabId, closing, onClosed, ...position }: { tabId: string; closing: boolean; onClosed: () => void; right?: number; left?: number; top: number }) {
  const tab = useTab(tabId)!;
  const theme = useTheme();
  const privateTab = isIncognitoProfile(tab.profileId);
  const origin = new URL(tab.url).origin;
  const host = new URL(origin).hostname;
  const profile = engineProfile(privateTab ? incognitoOriginal(tab.profileId) : tab.profileId);
  const privacy = usePrivacySettings(profile, origin, closing ? 0 : 2000);
  const [blocker, setBlocker] = useState<ContentBlockerState | null>(null);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let count: number | null = null;
      try {
        const stats = await webviews.get(tabId)?.getContentBlockerStats();
        if (stats?.url === tab.url && typeof stats.blocked === "number") count = stats.blocked;
      } catch {}
      if (!live) return;
      setBlocked(count);
      timer = setTimeout(poll, 2000);
    };
    if (!closing) void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [tabId, tab.url, closing]);
  const security = usePage(tabId, p => p.security);
  const close = () => setPopover(tabId, null);
  useEffect(() => {
    let live = true;
    const load = () => getContentBlocker().then(s => { if (live) setBlocker(s); }, () => { if (live) setBlocker(null); });
    void load();
    const listener = onContentBlockerChange(() => void load());
    void webviews.get(tabId)?.getSecurityInfo().then(info => { if (live && info) patchPage(tabId, { security: info }); }).catch(() => {});
    return () => { live = false; listener.remove(); };
  }, [tabId]);
  const state = privacy.state;
  const ready = !!state?.ready && !!blocker?.stats.ready;
  const on = ready && blocker.enabled && state.blocking;
  const busy = changing || privacy.busy;
  const activity = privateTab || !ready ? null : state?.activity;
  const status = !state || !blocker ? "Checking protection…" : !ready ? "Protection unavailable" : !blocker.enabled ? "Paused in Settings" : !state.blocking ? "Paused for this site" : PROVIDER_TITLES[state.mode];
  const clicking = privateTab ? "No ad collection or clicks in private tabs" : state?.mode === "ublock" ? "Standard · no new collection or clicks" : state?.blocking === false ? "Collection and background clicking paused for this site" : blocker?.enabled && state?.clicking ? "Background clicking enabled for eligible ads" : "Background clicking paused";
  const toggleBlocking = async (value: boolean) => {
    setChanging(true); setError("");
    try { await setContentBlockerAllowed(host, !value); await privacy.refresh(); await webviews.get(tabId)?.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't change site protection."); }
    finally { setChanging(false); }
  };
  const toggleForget = async () => {
    if (!state || privateTab) return;
    const value = !state.forget;
    if (value && !(await confirm({ title: `Forget ${state.site} after closing?`, message: "After its last normal tab closes, Ardia deletes this site's cookies and stored data for its visited pages, including shared subdomain cookies. This signs you out and removes offline data.", confirmTitle: "Forget After Closing", windowId: tab.windowId })).confirmed) return;
    await privacy.set("forgetSites", value);
  };
  const connection = connectionStatus(security);
  return <Popover width={PROTECTION_WIDTH} {...position} fitHeight onDismiss={close} closing={closing} onClosed={onClosed}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 16, paddingBottom: 10 }}>
      <Symbol name={on ? "shield.lefthalf.filled" : "shield"} size={23} color={on ? theme.accent : theme.icon} style={{ width: 28, height: 28 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>Site protection</Text>
        <Text numberOfLines={1} style={{ fontSize: 12, marginTop: 3, color: theme.textSecondary }}>{displayHost(host)}</Text>
      </View>
      <PanelCloseButton onPress={close} />
    </View>
    <PopoverRow title={status} detail={ready ? "Blocking can be paused if this site breaks" : "Waiting for the blocker to report its state"} accessory={<Toggle label="Block ads and trackers on this site" value={on} disabled={!ready || !blocker?.enabled || busy || privateTab} onChange={v => void toggleBlocking(v)} />} />
    <View style={{ margin: 12, marginTop: 8, gap: 8 }}>
      <Metric wide value={ready ? blocked : null} title="Ads & trackers blocked" detail="Requests blocked or safely replaced this page load. Hidden elements and script-based filtering are not counted." />
      {privateTab ? <Text style={{ fontSize: 12, color: theme.textSecondary, padding: 8 }}>{clicking}</Text> : <>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Metric value={activity?.collected ?? null} title="Ads collected" detail="Saved for this site" />
          <Metric value={activity?.clicked ?? null} title="Ads clicked" detail="Completed visits · saved" />
        </View>
        <Text style={{ fontSize: 11, lineHeight: 15, color: theme.textSecondary }}>{clicking}. Saved totals include subdomains and remain in Standard.</Text>
      </>}
    </View>
    <PopoverSeparator />
    <PopoverRow icon={connection.icon} title={connection.title} />
    <PopoverRow icon="hand.raised" title="Global Privacy Control" accessory={<Text style={{ fontSize: 12, color: theme.textSecondary }}>{!state ? "…" : state.globalPrivacyControl ? "On" : "Off"}</Text>} />
    <PopoverRow icon="link" title="Clean tracking links" detail={!state ? "Checking…" : !on || !state.cleanLinks ? "Off" : state.cleanExcepted ? "Exception for this site" : undefined} accessory={<Toggle label="Clean tracking links on this site" value={on && !!state?.cleanLinks && !state.cleanExcepted} disabled={!on || busy || privateTab || !state?.cleanLinks} onChange={v => void privacy.set("cleanExceptions", !v)} />} />
    <PopoverRow icon="network" title="CNAME tracker protection" detail={!state ? "Checking…" : !state.cnameAvailable ? "Unavailable with this engine" : !on || !state.cname ? "Off" : state.cnameExcepted ? "Exception for this site" : undefined} accessory={<Toggle label="CNAME tracker protection on this site" value={on && !!state?.cname && state.cnameAvailable && !state.cnameExcepted} disabled={!on || busy || privateTab || !state?.cname || !state.cnameAvailable} onChange={v => void privacy.set("cnameExceptions", !v)} />} />
    <PopoverRow icon="trash" title="Forget after closing" detail={privateTab ? "Private data is managed separately" : !state ? "Checking…" : state.forget ? "On · signs you out after the last tab closes" : undefined} accessory={<Toggle label="Forget this site after closing" value={!privateTab && !!state?.forget} disabled={!state || busy || privateTab} onChange={() => void toggleForget()} />} />
    {!!(error || privacy.error) && <Text accessibilityRole="alert" style={{ margin: 12, color: theme.textSecondary, fontSize: 12 }}>{error || privacy.error}</Text>}
    <PopoverSeparator />
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 12 }}>
      {!privateTab && <PromptButton title="Ad Vault…" onPress={() => { close(); useBrowser.getState().newTab(tab.windowId, { profileId: tab.profileId, url: "chrome-extension://fajbdaomknpkicfjcpipdmcpoamdmilh/vault.html" }); }} />}
      <PromptButton title="Privacy Settings…" onPress={() => { close(); openSettings("privacy"); }} />
    </View>
  </Popover>;
}
