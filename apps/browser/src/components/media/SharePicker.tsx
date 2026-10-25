import { getDisplayMediaSources, type DisplayMediaAudio, type DisplayMediaRequest, type DisplayMediaSource } from "@ardia/ardiacore";
import { runningAppIcon, Symbol } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { webviews } from "../../lib/webviews";
import { useBrowser } from "../../store/browser";
import { engineProfile } from "../../store/model";
import { PANEL, PanelHeader, Popover, POPOVER_MARGIN, PromptButton } from "../layout/controls";
import { usePages } from "../layout/pageState";
import { Favicon, useHover } from "../primitives";
import { Checkbox } from "../settings/controls";
import { noteTabShare } from "./ShareBar";
import { useMedia } from "./state";

const WIDTH = 460;
const REFRESH_MS = 2500;
const TAB = "tab:";
const AUDIO_SHARED_BY_DEFAULT = { tab: true, screen: false, window: false };

type SourceKind = keyof typeof AUDIO_SHARED_BY_DEFAULT;

const audioLabel = (kind: SourceKind, audio: DisplayMediaAudio) =>
  kind === "tab" ? "Also share tab audio" : kind === "window" && audio.window === "application" ? "Also share application audio" : "Also share system audio";

const audioOffered = (kind: SourceKind | null, audio: DisplayMediaAudio | null) =>
  !!audio && (kind === "tab" ? audio.tab : kind === "screen" ? audio.screen : kind === "window" ? !!audio.window : false);

function shareableTabs(tabId: string) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  if (!tab) return [];
  const profile = engineProfile(tab.profileId);
  const live = new Set(Object.values(usePages.getState().browsers));
  return Object.values(s.tabs)
    .filter((t) => live.has(t.id) && engineProfile(t.profileId) === profile && /^https?:|^file:/.test(t.url))
    .sort((a, b) => (a.id === tabId ? 1 : b.id === tabId ? -1 : b.lastActiveAt - a.lastActiveAt));
}

type Pending = DisplayMediaRequest & { pageUrl: string };

export function requestDisplayMedia(tabId: string, request: DisplayMediaRequest) {
  const pending = useMedia.getState().displayRequests[tabId];
  if (pending) void webviews.get(tabId)?.resolveDisplayMedia(pending.id, null);
  const pageUrl = useBrowser.getState().tabs[tabId]?.url ?? "";
  useMedia.setState((m) => ({ displayRequests: { ...m.displayRequests, [tabId]: { ...request, pageUrl } as Pending } }));
}

if (__DEV__)
  (globalThis as { acSharePicker?: unknown }).acSharePicker = {
    answerDisplayMedia: (tabId: string, sourceId: string | null, audio = false) => answerDisplayMedia(tabId, sourceId, audio),
    shareTab: (tabId: string, sharedTabId: string, audio = true) => shareTab(tabId, sharedTabId, audio),
  };

export function answerDisplayMedia(tabId: string, sourceId: string | null, audio = false) {
  const request = useMedia.getState().displayRequests[tabId];
  if (!request) return;
  void webviews.get(tabId)?.resolveDisplayMedia(request.id, sourceId, audio);
  useMedia.setState((m) => {
    const displayRequests = { ...m.displayRequests };
    delete displayRequests[tabId];
    return { displayRequests };
  });
}

async function shareTab(tabId: string, sharedTabId: string, audio: boolean) {
  const request = useMedia.getState().displayRequests[tabId];
  if (!request) return;
  const source = await webviews.get(sharedTabId)?.mediaCaptureSourceId();
  if (useMedia.getState().displayRequests[tabId] !== request) return;
  if (source) noteTabShare(tabId, sharedTabId, request.origin);
  answerDisplayMedia(tabId, source ?? null, audio);
}

export function cancelDisplayMediaOnNavigation() {
  const page = (url: string) => url.replace(/#.*$/, "");
  return useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    for (const [tabId, request] of Object.entries(useMedia.getState().displayRequests) as [string, Pending][]) {
      const url = s.tabs[tabId]?.url;
      if (url !== undefined && page(url) !== page(request.pageUrl)) answerDisplayMedia(tabId, null);
    }
  });
}

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
};

export function SharePicker({ tabId, paneWidth }: { tabId: string; paneWidth: number }) {
  const theme = useTheme();
  const request = useMedia((m) => m.displayRequests[tabId]);
  const [sources, setSources] = useState<DisplayMediaSource[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [shareAudio, setShareAudio] = useState(AUDIO_SHARED_BY_DEFAULT);
  const [icons, setIcons] = useState<Record<number, string | null>>({});
  const list = useRef<ScrollView>(null);

  useEffect(() => {
    if (!request) return;
    setSources(request.sources);
    setSelected(null);
    setShareAudio(AUDIO_SHARED_BY_DEFAULT);
    let live = true;
    const t = setInterval(() => void getDisplayMediaSources().then((next) => live && setSources(next)), REFRESH_MS);
    setTimeout(() => (list.current as unknown as { focus?: () => void } | null)?.focus?.(), 50);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [request?.id]);

  useEffect(() => {
    const missing = [...new Set(sources.map((s) => s.pid).filter((pid): pid is number => pid !== undefined && !(pid in icons)))];
    if (!missing.length) return;
    void Promise.all(missing.map(async (pid) => [pid, await runningAppIcon(pid, 20)] as const)).then((entries) =>
      setIcons((current) => ({ ...current, ...Object.fromEntries(entries) })),
    );
  }, [sources]);

  if (!request) return null;
  const tabs = shareableTabs(tabId);
  const screens = sources.filter((s) => s.kind === "screen");
  const windows = sources.filter((s) => s.kind === "window");
  const isTab = (id: string | null) => !!id && id.startsWith(TAB) && tabs.some((t) => TAB + t.id === id);
  const kindOf = (id: string | null): SourceKind | null => (isTab(id) ? "tab" : (sources.find((s) => s.id === id)?.kind ?? null));
  const valid = !!kindOf(selected);
  const selectedKind = kindOf(selected);
  const audioFor = (kind: SourceKind | null) => !!kind && audioOffered(kind, request.audio) && shareAudio[kind];
  const share = (id: string | null = selected) => {
    const kind = kindOf(id);
    if (!id || !kind) return;
    if (kind === "tab") return void shareTab(tabId, id.slice(TAB.length), audioFor(kind));
    answerDisplayMedia(tabId, id, audioFor(kind));
  };
  const cancel = () => answerDisplayMedia(tabId, null);
  const frameHost = request.frameOrigin ? hostOf(request.frameOrigin) : "";
  const receiver = frameHost && frameHost !== hostOf(request.origin) ? `${frameHost}, a frame on this page,` : "The site";
  const width = Math.min(WIDTH, paneWidth - 24);

  return (
    <Popover key={request.id} width={width} top={POPOVER_MARGIN} left={(paneWidth - width) / 2} onDismiss={cancel}>
      <View style={{ paddingBottom: PANEL.inset }}>
        <PanelHeader
          large
          iconSize={32}
          icon={
            <View style={{ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: theme.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)" }}>
              <Symbol name="rectangle.inset.filled.and.person.filled" size={15} color={theme.icon} style={{ width: 22, height: 22 }} />
            </View>
          }
          title={`Share your screen with ${hostOf(request.origin)}`}
          subtitle={
            audioFor(selectedKind)
              ? `${receiver} will see and hear what you choose.`
              : request.audio && !request.audio.screen && !request.audio.window && selectedKind !== "tab"
                ? `${receiver} will see what you choose. Only tabs share their audio.`
                : `${receiver} will see what you choose.`
          }
          subtitleLines={2}
        />

        <ScrollView
          ref={list}
          focusable
          enableFocusRing={false}
          keyDownEvents={[{ key: "Escape" }, { key: "Enter" }]}
          onKeyDown={(e) => (e.nativeEvent.key === "Escape" ? cancel() : share())}
          style={{ maxHeight: 340, marginTop: 4 }}
          contentContainerStyle={{ paddingHorizontal: PANEL.rowInset }}
        >
          {tabs.length ? (
            <>
              <SectionTitle title="Tabs" />
              {tabs.map((t) => (
                <TabRow
                  key={t.id}
                  title={t.title || t.url}
                  url={t.url}
                  current={t.id === tabId}
                  selected={TAB + t.id === selected}
                  onSelect={() => setSelected(TAB + t.id)}
                  onShare={() => share(TAB + t.id)}
                />
              ))}
            </>
          ) : null}
          {screens.length ? (
            <>
              <SectionTitle title={screens.length === 1 ? "Screen" : "Screens"} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {screens.map((s) => (
                  <ScreenTile key={s.id} source={s} width={(width - 2 * PANEL.rowInset - 8) / 2} selected={s.id === selected} onSelect={() => setSelected(s.id)} onShare={() => share(s.id)} />
                ))}
              </View>
            </>
          ) : null}
          {windows.length ? (
            <>
              <SectionTitle title="Windows" />
              {windows.map((s) => (
                <WindowRow key={s.id} source={s} icon={s.pid !== undefined ? icons[s.pid] : null} selected={s.id === selected} onSelect={() => setSelected(s.id)} onShare={() => share(s.id)} />
              ))}
            </>
          ) : null}
          {!sources.length && !tabs.length ? <Text style={{ fontSize: 12, color: theme.textSecondary, padding: 12, textAlign: "center" }}>Nothing can be shared right now.</Text> : null}
        </ScrollView>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: PANEL.inset, marginTop: 12 }}>
          {selectedKind && request.audio && audioOffered(selectedKind, request.audio) ? (
            <Checkbox
              value={shareAudio[selectedKind]}
              onChange={(on) => setShareAudio((current) => ({ ...current, [selectedKind]: on }))}
              label={audioLabel(selectedKind, request.audio)}
            />
          ) : null}
          <View style={{ flex: 1 }} />
          <PromptButton title="Cancel" onPress={cancel} />
          <View pointerEvents={valid ? "auto" : "none"} style={{ opacity: valid ? 1 : 0.4 }}>
            <PromptButton title="Share" primary onPress={() => share()} />
          </View>
        </View>
      </View>
    </Popover>
  );
}

function SectionTitle({ title }: { title: string }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textSecondary, paddingHorizontal: PANEL.rowPadding, marginTop: 6, marginBottom: 6 }}>{title}</Text>;
}

const selectedFill = (dark: boolean) => (dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)");

function ScreenTile({ source, width, selected, onSelect, onShare }: { source: DisplayMediaSource; width: number; selected: boolean; onSelect(): void; onShare(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const aspect = source.width && source.height ? source.height / source.width : 10 / 16;
  const previewWidth = width - 16;
  return (
    <View {...hoverProps} onDoubleClick={onShare}>
      <Pressable onPress={onSelect}>
        <View style={{ width, padding: 8, borderRadius: 10, alignItems: "center", backgroundColor: selected ? selectedFill(theme.dark) : hovered ? theme.rowHover : undefined }}>
          <View
            style={{
              width: previewWidth,
              height: Math.min(previewWidth * aspect, 80),
              borderRadius: 6,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? theme.accent : theme.dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)",
              backgroundColor: theme.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Symbol name="display" size={22} color={theme.textSecondary} style={{ width: 30, height: 30 }} />
          </View>
          <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textPrimary, marginTop: 6 }}>
            {source.name}
          </Text>
          {source.width ? (
            <Text numberOfLines={1} style={{ fontSize: 10.5, color: theme.textTertiary, fontVariant: ["tabular-nums"] }}>
              {source.width} × {source.height}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

function TabRow({ title, url, current, selected, onSelect, onShare }: { title: string; url: string; current: boolean; selected: boolean; onSelect(): void; onShare(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} onDoubleClick={onShare}>
      <Pressable onPress={onSelect}>
        <View style={{ height: 34, borderRadius: PANEL.rowRadius, flexDirection: "row", alignItems: "center", gap: PANEL.iconGap, paddingHorizontal: PANEL.rowPadding, backgroundColor: selected ? selectedFill(theme.dark) : hovered ? theme.rowHover : undefined }}>
          <View style={{ width: PANEL.iconSlot, alignItems: "center" }}>
            <Favicon url={url} />
          </View>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, color: theme.textPrimary }}>
            {title}
          </Text>
          {current ? (
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textSecondary }}>
              This Tab
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {selected ? <Symbol name="checkmark" size={11} weight="semibold" color={theme.accent} style={{ width: 16, height: 16 }} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

function WindowRow({ source, icon, selected, onSelect, onShare }: { source: DisplayMediaSource; icon: string | null | undefined; selected: boolean; onSelect(): void; onShare(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const title = source.name || source.app || "Window";
  const app = source.app && source.app !== title ? source.app : null;
  return (
    <View {...hoverProps} onDoubleClick={onShare}>
      <Pressable onPress={onSelect}>
        <View style={{ height: 34, borderRadius: PANEL.rowRadius, flexDirection: "row", alignItems: "center", gap: PANEL.iconGap, paddingHorizontal: PANEL.rowPadding, backgroundColor: selected ? selectedFill(theme.dark) : hovered ? theme.rowHover : undefined }}>
          {icon ? <Image source={{ uri: icon }} style={{ width: 20, height: 20 }} /> : <Symbol name="macwindow" size={14} color={theme.textSecondary} style={{ width: 20, height: 20 }} />}
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, color: theme.textPrimary }}>
            {title}
          </Text>
          {app ? (
            <Text numberOfLines={1} style={{ flexShrink: 2, fontSize: 12, color: theme.textSecondary }}>
              {app}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {selected ? <Symbol name="checkmark" size={11} weight="semibold" color={theme.accent} style={{ width: 16, height: 16 }} /> : null}
        </View>
      </Pressable>
    </View>
  );
}
