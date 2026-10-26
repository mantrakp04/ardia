import {
  getContentBlocker,
  getSiteSettings,
  WEBKIT_SITE_SETTINGS,
  isContentBlockerAllowed,
  setContentBlockerAllowed,
  setSiteSetting,
  type SiteSettingType,
  type SiteSettingValue,
  type SiteSettings,
} from "../../state/site/siteSettings";
import { displayHost } from "@ardia/core";
import { confirm, showMenu } from "../../state/app/system";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../ui/theme";
import { webviews } from "../../state/tabs/webviewHandles";
import { currentLive, currentTab } from "../../state/browser/current";
import { updateTab } from "../../state/tabs/actions";
import { setFind } from "../../state/windows/actions";
import { updateSettings } from "../../state/settings/actions";
import { useEngineRule, usePageEngine, useRecommendedEngine, useStreamingSite } from "../../state/engines/hooks";
import { useSettings, useTab } from "../../state/browser/hooks";
import { engineProfile, isIncognitoProfile, tabLabel } from "../../state/browser/model";
import { ENGINE_NAMES, ENGINE_SYMBOLS, otherEngine } from "../../state/engines/engines";
import { openPageIn, togglePageEngine } from "../../state/engines/actions";
import { Box, MenuRow, MenuSeparator, PANEL, PanelHeader, Popover, PopoverValue, space, Toggle, usePopoverPresence } from "../ui";
import { Favicon } from "../favicon/Favicon";
import { pageOf, patchPage, setPopover, usePage } from "../../state/tabs/pageState";
import { showToast } from "../../state/splits/actions";
import { toggleCastPicker } from "../../state/media/cast";
import { useMedia, usePictureInPicture } from "../../state/media/media";
import { openSettings } from "../../state/settings/settingsWindows";
import { copyPageUrl } from "../../state/site/selection";
import { canShare, shareTab } from "../../state/site/share";
import { ActionTile, gridColumns, MoreButton, SectionTitle, SettingRow, SITE_PANEL, TileRow } from "./SiteControlsParts";
import { CertificateDetails, ConnectionChip, ConnectionRow } from "./SiteConnection";
import { SiteExtensions } from "./SiteExtensions";
import { TranslateRows } from "./TranslateControls";
import { ZoomStepper } from "./ZoomControls";

type Permission = { type: SiteSettingType; title: string; icon: string; badge: string; choices: SiteSettingValue[] };

const PERMISSIONS: Permission[] = [
  { type: "camera", title: "Camera", icon: "video", badge: "video.fill", choices: ["ask", "allow", "block"] },
  { type: "microphone", title: "Microphone", icon: "mic", badge: "mic.fill", choices: ["ask", "allow", "block"] },
  { type: "location", title: "Location", icon: "location", badge: "location.fill", choices: ["ask", "allow", "block"] },
  { type: "notifications", title: "Notifications", icon: "bell", badge: "bell.fill", choices: ["ask", "allow", "block"] },
  { type: "popups", title: "Pop-ups and Redirects", icon: "macwindow.on.rectangle", badge: "macwindow.on.rectangle", choices: ["allow", "block"] },
  { type: "sound", title: "Sound", icon: "speaker.wave.2", badge: "speaker.wave.2.fill", choices: ["allow", "block"] },
];

const choiceTitle = (type: SiteSettingType, value: SiteSettingValue) =>
  type === "sound" ? (value === "block" ? "Muted" : "Allowed") : value === "allow" ? "Allowed" : value === "block" ? "Blocked" : "Ask";

type Expanded = "connection" | "more" | null;
type Blocker = { enabled: boolean; allowed: boolean };

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function SiteControls({ tabId, open, right, left, top }: { tabId: string; open: boolean; right?: number; left?: number; top: number }) {
  const presence = usePopoverPresence(open);
  if (!presence.shown) return null;
  return <SiteControlsPanel tabId={tabId} right={right} left={left} top={top} closing={presence.closing} onClosed={presence.onClosed} />;
}

function featuredPermissions(tabId: string, settings: SiteSettings, list: Permission[]): Set<SiteSettingType> {
  const tab = currentTab(tabId);
  const access = pageOf(tabId).mediaAccess;
  const inUse: Partial<Record<SiteSettingType, boolean>> = {
    camera: !!access?.camera,
    microphone: !!access?.microphone,
    sound: !!tab?.muted || !!currentLive(tabId)?.playingAudio,
  };
  return new Set(list.filter((p) => !settings[p.type]?.isDefault || inUse[p.type]).map((p) => p.type));
}

function SiteControlsPanel({
  tabId,
  right,
  left,
  top,
  closing,
  onClosed,
}: {
  tabId: string;
  right?: number;
  left?: number;
  top: number;
  closing: boolean;
  onClosed: () => void;
}) {
  const tab = useTab(tabId);
  const theme = useTheme();
  const security = usePage(tabId, (p) => p.security);
  const blocked = usePage(tabId, (p) => p.blocked);
  const showFullUrl = useSettings((s) => s.showFullUrl);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [featured, setFeatured] = useState<Set<SiteSettingType> | null>(null);
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  const [expanded, setExpanded] = useState<Expanded>(null);
  const [cleared, setCleared] = useState<string | null>(null);
  const shareTile = useRef<View>(null);
  const url = tab?.url ?? "";
  const origin = originOf(url);
  const host = origin ? new URL(origin).hostname : "";
  const profile = engineProfile(tab?.profileId ?? "");
  const close = () => setPopover(tabId, null);
  const video = useMedia((m) => !!m.sessions[tabId]?.hasVideo || !!m.pipOpen[tabId]);
  const [pip, togglePip] = usePictureInPicture(tabId);
  const pageEngine = usePageEngine(tabId);
  const webkitPage = pageEngine === "webkit";
  const permissionList = webkitPage ? PERMISSIONS.filter((p) => WEBKIT_SITE_SETTINGS.includes(p.type)) : PERMISSIONS;
  const readSettings = (p: string, o: string) => getSiteSettings(p, o, pageEngine).catch((): SiteSettings => ({}) as SiteSettings);
  const engineRule = useEngineRule(url);
  const recommendedEngine = useRecommendedEngine(url);
  const streamingSite = useStreamingSite(url);
  const recommendedTitle = streamingSite ? `Recommended (${ENGINE_NAMES[recommendedEngine]})` : `Default (${ENGINE_NAMES[recommendedEngine]})`;

  useEffect(() => {
    if (!origin) return;
    let live = true;
    void readSettings(profile, origin).then((s) => {
      if (!live) return;
      setSettings(s);
      setFeatured((f) => f ?? featuredPermissions(tabId, s, permissionList));
    });
    void Promise.all([getContentBlocker(), isContentBlockerAllowed(host)]).then(([state, allowed]) => live && setBlocker({ enabled: state.enabled, allowed }));
    void webviews.get(tabId)?.getSecurityInfo().then((info) => live && info && patchPage(tabId, { security: info }));
    return () => {
      live = false;
    };
  }, [origin, profile, webkitPage]);

  if (!tab) return null;

  const setPermission = async (type: SiteSettingType, value: SiteSettingValue) => {
    if (!origin) return;
    await setSiteSetting(profile, origin, type, value, pageEngine);
    setSettings(await readSettings(profile, origin));
    if (type === "sound") {
      updateTab(tabId, { muted: value === "block" });
      void webviews.get(tabId)?.setMuted(value === "block");
    }
  };
  const pickPermission = async (type: SiteSettingType, choices: SiteSettingValue[]) => {
    const current = settings?.[type]?.value;
    const choice = await showMenu(choices.map((v) => ({ id: v, title: choiceTitle(type, v), checked: v === current })));
    if (choice) void setPermission(type, choice as SiteSettingValue);
  };
  const toggleBlocker = async (on: boolean) => {
    const failed = await setContentBlockerAllowed(host, !on).then(() => false, () => true);
    const allowed = await isContentBlockerAllowed(host);
    setBlocker((b) => (b ? { ...b, allowed } : b));
    if (failed) return showToast(tab.windowId, "Couldn't Change the Ad Blocker", `Blocking on ${host} is as it was. Try again.`, { icon: "exclamationmark.triangle" });
    void webviews.get(tabId)?.reload();
  };
  const clearData = async () => {
    if (!origin) return;
    const { confirmed } = await confirm({
      title: `Clear cookies and site data for ${host}?`,
      message: "You'll be signed out of this site, and its offline data will be deleted.",
      confirmTitle: "Clear",
      destructive: true,
      windowId: tab.windowId,
    });
    if (!confirmed) return;
    const result = await webviews.get(tabId)?.clearSiteData().catch(() => null);
    const n = result && typeof result.cookies === "number" ? result.cookies : 0;
    setCleared(n ? `Cleared ${n} cookie${n === 1 ? "" : "s"} and site data` : "Cleared site data");
    void webviews.get(tabId)?.reload();
  };
  const share = () =>
    shareTile.current?.measureInWindow((x, y, width, height) => {
      close();
      void shareTab(tab, tab.windowId, null, [x, y, width, height]);
    });
  const cast = () => {
    close();
    void toggleCastPicker(tab.windowId);
  };
  const privatePage = isIncognitoProfile(tab.profileId);
  const opensIn = privatePage ? ENGINE_NAMES[pageEngine] : engineRule ? ENGINE_NAMES[engineRule] : recommendedTitle;
  const pickEngine = async () => {
    const checked = (engine: "chromium" | "webkit") => (privatePage ? pageEngine === engine : engineRule === engine);
    const choice = await showMenu([
      ...(privatePage ? [] : [{ id: "default", title: recommendedTitle, checked: !engineRule }, { separator: true as const }]),
      { id: "chromium", title: ENGINE_NAMES.chromium, checked: checked("chromium") },
      { id: "webkit", title: ENGINE_NAMES.webkit, checked: checked("webkit") },
    ]);
    if (!choice) return;
    close();
    if (choice === "default") void openPageIn(tabId, recommendedEngine, { rule: null });
    else {
      const engine = choice === "webkit" ? "webkit" : "chromium";
      void openPageIn(tabId, engine, { rule: engine });
    }
  };
  const toggle = (section: Exclude<Expanded, null>) => setExpanded((e) => (e === section ? null : section));

  const findable = /^(https?|file):/i.test(url);
  const castTile = !video && !!origin;
  const tiles = [
    canShare(tab) ? <ActionTile key="share" ref={shareTile} icon="square.and.arrow.up" label="Share…" onPress={share} /> : null,
    <ActionTile
      key="copy"
      icon="link"
      label="Copy Clean Link"
      onPress={() => {
        close();
        void copyPageUrl(tabId);
      }}
    />,
    findable ? (
      <ActionTile
        key="find"
        icon="text.magnifyingglass"
        label="Find on Page"
        onPress={() => {
          close();
          setFind(tabId, { open: true, replace: false, focusRequest: Date.now() });
        }}
      />
    ) : null,
    video ? (
      <ActionTile
        key="pip"
        icon={pip ? "pip.exit" : "pip.enter"}
        label={pip ? "Exit Picture in Picture" : "Picture in Picture"}
        active={pip}
        onPress={(press) => {
          togglePip(press);
          close();
        }}
      />
    ) : castTile ? (
      <ActionTile key="cast" icon="tv.and.mediabox" label="Cast…" onPress={cast} />
    ) : null,
  ].filter(Boolean);

  const blockerValue = pageEngine === "webkit"
    ? "Chromium only for now"
    : !blocker
    ? "…"
    : !blocker.enabled
      ? "Off in Settings"
      : blocker.allowed
        ? "Off for this site"
        : blocked > 0
          ? `On · ${blocked} blocked on this page`
          : "On";
  const shownPermissions = featured ? permissionList.filter((p) => featured.has(p.type)) : [];
  const otherPermissions = permissionList.filter((p) => !featured?.has(p.type));
  const value = (p: Permission) => (settings ? choiceTitle(p.type, settings[p.type]?.value ?? "ask") : "…");

  return (
    <Popover width={SITE_PANEL.width} top={top} right={right} left={left} onDismiss={close} fitHeight closing={closing} onClosed={onClosed}>
      <View style={{ paddingTop: PANEL.inset }}>
        <TileRow>{tiles}</TileRow>

        <SiteExtensions windowId={tab.windowId} tabId={tab.id} columns={gridColumns(tiles.length)} onClose={close} />

        {origin ? (
          <>
            <SectionTitle title="Settings" tight />
            <SettingRow
              icon="shield.lefthalf.filled"
              title="Block Ads & Trackers"
              value={blockerValue}
              on={pageEngine !== "webkit" && !!blocker?.enabled && !blocker.allowed}
              onPress={
                !blocker || pageEngine === "webkit"
                  ? undefined
                  : blocker.enabled
                    ? () => void toggleBlocker(blocker.allowed)
                    : () => {
                        close();
                        openSettings("privacy");
                      }
              }
            />
            <SettingRow icon={ENGINE_SYMBOLS[pageEngine]} title="Opens in" value={opensIn} on={!!engineRule} onPress={() => void pickEngine()} />
            {shownPermissions.map((p) => (
              <SettingRow
                key={p.type}
                icon={p.badge}
                title={p.title}
                value={value(p)}
                on={settings?.[p.type]?.value === "allow"}
                onPress={() => void pickPermission(p.type, p.choices)}
              />
            ))}
          </>
        ) : null}

        {expanded === "connection" ? (
          <>
            <MenuSeparator />
            <PanelHeader
              icon={<Favicon url={url} favicon={tab.favicon} size={PANEL.iconSlot} profileId={tab.profileId} />}
              title={host ? displayHost(host) : tabLabel(tab)}
              subtitle={tab.title}
            />
            <ConnectionRow security={security} />
            {security?.certificate ? <CertificateDetails security={security} /> : null}
          </>
        ) : null}

        {expanded === "more" ? (
          <>
            <MenuSeparator />
            <MenuRow icon="plus.magnifyingglass" title="Zoom" accessory={<ZoomStepper tabId={tabId} zoom={tab.zoom} />} />
            {origin && !castTile ? <MenuRow icon="tv.and.mediabox" title="Cast…" onPress={cast} /> : null}
            {origin ? (
              <MenuRow
                icon={ENGINE_SYMBOLS[otherEngine(pageEngine)]}
                title={`Open Page in ${ENGINE_NAMES[otherEngine(pageEngine)]}`}
                onPress={() => {
                  close();
                  void togglePageEngine(tabId);
                }}
              />
            ) : null}
            {origin ? (
              <>
                <MenuSeparator />
                <TranslateRows tabId={tabId} onClose={close} />
                {otherPermissions.map((p) => (
                  <MenuRow
                    key={p.type}
                    icon={p.icon}
                    title={p.title}
                    accessory={<PopoverValue title={value(p)} onPress={() => void pickPermission(p.type, p.choices)} />}
                  />
                ))}
                {otherPermissions.length ? <MenuSeparator /> : null}
                <MenuRow icon="trash" title="Clear Cookies and Site Data…" detail={cleared ?? undefined} onPress={() => void clearData()} />
              </>
            ) : null}
            <MenuRow
              icon="text.alignleft"
              title="Show Full URL"
              accessory={<Toggle look="panel" value={showFullUrl} onChange={(v) => updateSettings({ showFullUrl: v })} />}
            />
          </>
        ) : null}

        <View style={{ height: StyleSheet.hairlineWidth, marginTop: origin ? space.m : space.lx, marginHorizontal: PANEL.inset, backgroundColor: theme.divider }} />
        <Box row style={{ alignItems: "center", justifyContent: "space-between", paddingHorizontal: PANEL.inset, paddingTop: space.ml, paddingBottom: space.l }}>
          <ConnectionChip security={security} open={expanded === "connection"} onPress={() => toggle("connection")} />
          <MoreButton open={expanded === "more"} onPress={() => toggle("more")} />
        </Box>
      </View>
    </Popover>
  );
}
