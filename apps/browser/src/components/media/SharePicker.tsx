import {
  getDisplayMediaSources,
  type DisplayMediaAudio,
  type DisplayMediaSource,
  answerDisplayMedia,
  shareableTabs,
  shareTab,
} from "../../state/media/screenShare";
import { runningAppIcon } from "../../state/app/system";
import { Symbol, Button, Checkbox, PANEL, PanelHeader, Popover, POPOVER_MARGIN, Text, useHover } from "../ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, View, type TextStyle } from "react-native";
import { useTheme } from "../ui/theme";
import { radius, space } from "../ui/tokens";
import { mediaType, useMediaTokens } from "./tokens";
import { Favicon } from "../favicon/Favicon";
import { useMedia } from "../../state/media/media";

const WIDTH = 460;
const REFRESH_MS = 2500;
const TAB = "tab:";
const AUDIO_SHARED_BY_DEFAULT = { tab: true, screen: false, window: false };

type SourceKind = keyof typeof AUDIO_SHARED_BY_DEFAULT;

const audioLabel = (kind: SourceKind, audio: DisplayMediaAudio) =>
  kind === "tab" ? "Also share tab audio" : kind === "window" && audio.window === "application" ? "Also share application audio" : "Also share system audio";

const audioOffered = (kind: SourceKind | null, audio: DisplayMediaAudio | null) =>
  !!audio && (kind === "tab" ? audio.tab : kind === "screen" ? audio.screen : kind === "window" ? !!audio.window : false);

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
};

export function SharePicker({ tabId, paneWidth }: { tabId: string; paneWidth: number }) {
  const theme = useTheme();
  const tokens = useMediaTokens();
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
            <View style={{ width: 32, height: 32, borderRadius: radius.l, alignItems: "center", justifyContent: "center", backgroundColor: tokens.iconTile }}>
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
          style={{ maxHeight: 340, marginTop: space.xs }}
          contentContainerStyle={{ paddingHorizontal: PANEL.rowInset }}
        >
          {tabs.length ? (
            <>
              <SectionTitle title="Tabs" />
              {tabs.map((t) => (
                <SourceRow
                  key={t.id}
                  leading={
                    <View style={{ width: PANEL.iconSlot, alignItems: "center" }}>
                      <Favicon url={t.url} />
                    </View>
                  }
                  title={t.title || t.url}
                  detail={t.id === tabId ? "This Tab" : null}
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
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.m }}>
                {screens.map((s) => (
                  <ScreenTile key={s.id} source={s} width={(width - 2 * PANEL.rowInset - space.m) / 2} selected={s.id === selected} onSelect={() => setSelected(s.id)} onShare={() => share(s.id)} />
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
          {!sources.length && !tabs.length ? <Text size="small" tone="textSecondary" style={EMPTY}>Nothing can be shared right now.</Text> : null}
        </ScrollView>

        <View style={{ flexDirection: "row", alignItems: "center", gap: space.m, paddingHorizontal: PANEL.inset, marginTop: space.l }}>
          {selectedKind && request.audio && audioOffered(selectedKind, request.audio) ? (
            <Checkbox
              value={shareAudio[selectedKind]}
              onChange={(on) => setShareAudio((current) => ({ ...current, [selectedKind]: on }))}
              label={audioLabel(selectedKind, request.audio)}
            />
          ) : null}
          <View style={{ flex: 1 }} />
          <Button variant="pill" title="Cancel" onPress={cancel} />
          <View pointerEvents={valid ? "auto" : "none"} style={{ opacity: valid ? 1 : 0.4 }}>
            <Button variant="pill" title="Share" primary onPress={() => share()} />
          </View>
        </View>
      </View>
    </Popover>
  );
}

const EMPTY = { padding: space.l, textAlign: "center" } as const;
const SECTION_TITLE = { paddingHorizontal: PANEL.rowPadding, marginTop: space.s, marginBottom: space.s } as const;

function SectionTitle({ title }: { title: string }) {
  return (
    <Text size="caption" weight="semibold" tone="textSecondary" style={SECTION_TITLE}>
      {title}
    </Text>
  );
}

function ScreenTile({ source, width, selected, onSelect, onShare }: { source: DisplayMediaSource; width: number; selected: boolean; onSelect(): void; onShare(): void }) {
  const theme = useTheme();
  const tokens = useMediaTokens();
  const { hovered, hoverProps } = useHover();
  const aspect = source.width && source.height ? source.height / source.width : 10 / 16;
  const previewWidth = width - 16;
  return (
    <View {...hoverProps} onDoubleClick={onShare}>
      <Pressable onPress={onSelect}>
        <View style={{ width, padding: space.m, borderRadius: radius.card, alignItems: "center", backgroundColor: selected ? tokens.pickerSelected : hovered ? theme.rowHover : undefined }}>
          <View
            style={{
              width: previewWidth,
              height: Math.min(previewWidth * aspect, 80),
              borderRadius: radius.m,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? theme.accent : tokens.previewBorder,
              backgroundColor: tokens.previewFill,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Symbol name="display" size={22} color={theme.textSecondary} style={{ width: 30, height: 30 }} />
          </View>
          <Text lines={1} size="small" style={TILE_NAME}>
            {source.name}
          </Text>
          {source.width ? (
            <Text lines={1} tone="textTertiary" style={TILE_RESOLUTION}>
              {source.width} × {source.height}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const TILE_NAME = { marginTop: space.s } as const;
const TILE_RESOLUTION: TextStyle = { ...mediaType.resolution, fontVariant: ["tabular-nums"] };
const ROW_TITLE = { flexShrink: 1 } as const;
const ROW_DETAIL = { flexShrink: 2 } as const;

function WindowRow({ source, icon, selected, onSelect, onShare }: { source: DisplayMediaSource; icon: string | null | undefined; selected: boolean; onSelect(): void; onShare(): void }) {
  const theme = useTheme();
  const title = source.name || source.app || "Window";
  const app = source.app && source.app !== title ? source.app : null;
  return (
    <SourceRow
      leading={icon ? <Image source={{ uri: icon }} style={{ width: 20, height: 20 }} /> : <Symbol name="macwindow" size={14} color={theme.textSecondary} style={{ width: 20, height: 20 }} />}
      title={title}
      detail={app}
      detailShrinks
      selected={selected}
      onSelect={onSelect}
      onShare={onShare}
    />
  );
}

function SourceRow({
  leading,
  title,
  detail,
  detailShrinks,
  selected,
  onSelect,
  onShare,
}: {
  leading: ReactNode;
  title: string;
  detail: string | null;
  detailShrinks?: boolean;
  selected: boolean;
  onSelect(): void;
  onShare(): void;
}) {
  const theme = useTheme();
  const tokens = useMediaTokens();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} onDoubleClick={onShare}>
      <Pressable onPress={onSelect}>
        <View style={{ height: 34, borderRadius: PANEL.rowRadius, flexDirection: "row", alignItems: "center", gap: PANEL.iconGap, paddingHorizontal: PANEL.rowPadding, backgroundColor: selected ? tokens.pickerSelected : hovered ? theme.rowHover : undefined }}>
          {leading}
          <Text lines={1} style={ROW_TITLE}>
            {title}
          </Text>
          {detail ? (
            <Text lines={1} size="small" tone="textSecondary" style={detailShrinks ? ROW_DETAIL : undefined}>
              {detail}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          {selected ? <Symbol name="checkmark" size={11} weight="semibold" color={theme.accent} style={{ width: 16, height: 16 }} /> : null}
        </View>
      </Pressable>
    </View>
  );
}
