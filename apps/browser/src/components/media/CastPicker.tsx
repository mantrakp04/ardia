import { CastMode, preferredCastMode, startCasting, stopCasting, type CastSink, closeCastPicker, useCast } from "../../state/media/cast";
import { openExternalURL, showMenu } from "../../state/app/system";
import { Symbol, Button, PANEL, PanelHeader, Popover, POPOVER_MARGIN, PopoverValue, Text, useHover } from "../ui";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useTheme } from "../ui/theme";
import { ink, radius, space } from "../ui/tokens";
import { mediaType, useMediaTokens } from "./tokens";

const WIDTH = 340;
const SINK_ROW_PAD_Y = 5;
const MESSAGE_GAP = 5;
const FLEX = { flex: 1 } as const;
const UNDERLINE = { textDecorationLine: "underline" } as const;
const NO_UNDERLINE = { textDecorationLine: "none" } as const;

const SINK_ICON: Record<number, string> = { 0: "tv", 1: "hifispeaker.2", 2: "hifispeaker", 6: "display", 7: "tv" };

export function CastPicker({ tabId, paneWidth }: { tabId: string; paneWidth: number }) {
  const theme = useTheme();
  const dialog = useCast((c) => c.dialogs[tabId]);
  const [screen, setScreen] = useState(false);
  useEffect(() => setScreen(false), [dialog?.id]);
  if (!dialog) return null;
  const close = () => closeCastPicker(tabId);
  const available = dialog.sinks.filter((s) => s.state !== "unavailable");
  const canScreen = dialog.sinks.some((s) => s.modes & CastMode.screen);
  const width = Math.min(WIDTH, paneWidth - 24);
  const cast = (sink: CastSink) => {
    const mode = screen && sink.modes & CastMode.screen ? CastMode.screen : preferredCastMode(sink.modes & ~CastMode.screen) || preferredCastMode(sink.modes);
    if (mode) void startCasting(dialog.id, sink.id, mode);
  };

  return (
    <Popover key={dialog.id} width={width} top={POPOVER_MARGIN} right={POPOVER_MARGIN} onDismiss={close}>
      <View style={{ paddingBottom: PANEL.inset }}>
        <PanelHeader
          icon={<Symbol name="tv.and.mediabox" size={14} color={theme.icon} style={{ width: PANEL.iconSlot, height: PANEL.iconSlot }} />}
          title={screen ? "Cast screen" : dialog.header || "Cast tab"}
          accessory={canScreen ? <SourceButton screen={screen} onChange={setScreen} /> : null}
        />

        {dialog.permissionRejected ? (
          <Message
            text="Ardia needs Local Network access to find Cast devices."
            link="Open Local Network Settings"
            onLink={() => void openExternalURL("x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork")}
          />
        ) : available.length ? (
          <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ paddingHorizontal: PANEL.rowInset, gap: 2 }}>
            {available.map((sink) => (
              <SinkRow key={sink.id} sink={sink} onCast={() => cast(sink)} onStop={() => void stopCasting(dialog.id, sink.routeId)} />
            ))}
          </ScrollView>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.m, paddingHorizontal: PANEL.inset, paddingTop: space.xs, paddingBottom: space.xs }}>
            <ActivityIndicator size="small" style={{ transform: [{ scale: 0.6 }], width: 14, height: 14 }} />
            <Text size="small" tone="textSecondary" style={FLEX}>
              Looking for devices… Cast devices need to be on the same Wi‑Fi network as this Mac.
            </Text>
          </View>
        )}

        <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: PANEL.inset, marginTop: space.ml }}>
          <Button variant="pill" title="Done" onPress={close} />
        </View>
      </View>
    </Popover>
  );
}

function SinkRow({ sink, onCast, onStop }: { sink: CastSink; onCast(): void; onStop(): void }) {
  const theme = useTheme();
  const tokens = useMediaTokens();
  const { hovered, hoverProps } = useHover();
  const active = sink.state === "connected" && !!sink.routeId;
  const busy = sink.state === "connecting" || sink.state === "disconnecting";
  return (
    <View {...hoverProps}>
      <Pressable onPress={active || busy ? undefined : onCast}>
        <View style={{ minHeight: 42, borderRadius: PANEL.rowRadius, flexDirection: "row", alignItems: "center", gap: PANEL.iconGap, paddingHorizontal: PANEL.rowPadding, paddingVertical: SINK_ROW_PAD_Y, backgroundColor: hovered && !active ? theme.rowHover : undefined }}>
          <View style={{ width: 28, height: 28, borderRadius: radius.button, alignItems: "center", justifyContent: "center", backgroundColor: active ? theme.accent : tokens.iconTile }}>
            <Symbol name={SINK_ICON[sink.icon] ?? "tv"} size={13} color={active ? ink.white : theme.icon} style={{ width: 20, height: 20 }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text lines={1}>
              {sink.name}
            </Text>
            {sink.issue || sink.status ? (
              <Text lines={1} size="footnote" tone={sink.issue ? "destructive" : "textSecondary"}>
                {sink.issue || sink.status}
              </Text>
            ) : null}
          </View>
          {busy ? <ActivityIndicator size="small" style={{ transform: [{ scale: 0.6 }], width: 16, height: 16 }} /> : null}
          {active ? <Button variant="pill" title="Stop" onPress={onStop} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

function SourceButton({ screen, onChange }: { screen: boolean; onChange: (screen: boolean) => void }) {
  const pick = async () => {
    const choice = await showMenu([
      { id: "tab", title: "Cast Tab", checked: !screen },
      { id: "screen", title: "Cast Screen", checked: screen },
    ]);
    if (choice) onChange(choice === "screen");
  };
  return <PopoverValue title="Sources" chevron="chevron.down" tooltip="Source" onPress={() => void pick()} />;
}

function Message({ text, link, onLink }: { text: string; link: string; onLink: () => void }) {
  const { hovered, hoverProps } = useHover();
  return (
    <View style={{ paddingHorizontal: PANEL.inset, paddingTop: space.xs, gap: MESSAGE_GAP }}>
      <Text tone="textSecondary" style={mediaType.castMessage}>{text}</Text>
      <View {...hoverProps}>
        <Pressable onPress={onLink}>
          <Text size="small" weight="medium" tone="accent" style={hovered ? UNDERLINE : NO_UNDERLINE}>{link}</Text>
        </Pressable>
      </View>
    </View>
  );
}
