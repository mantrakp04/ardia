import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTheme } from "../ui/theme";
import { cancelChooser, chooseDevice, openChooserBluetoothSettings, rescanDevices, useDeviceChooser } from "../../state/site/deviceChoosers";
import { ActivitySpinner, Box, Button, capsule, MenuRow, PANEL, Popover, POPOVER_WIDTH, Symbol, Text } from "../ui";
import { usePromptInputGuard } from "./PromptParts";
import { PromptBody } from "./Prompts";
import { noticeType, UNAVAILABLE_OPACITY } from "./tokens";

const SIGNAL_BAR = 2.5;

function Signal({ level, color }: { level: number; color: string }) {
  return (
    <Box row gap="xxs" style={{ alignItems: "flex-end", height: 11 }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ width: SIGNAL_BAR, height: 3 + i * SIGNAL_BAR, borderRadius: capsule(SIGNAL_BAR), backgroundColor: color, opacity: i < level ? 1 : 0.25 }} />
      ))}
    </Box>
  );
}

function OptionRow({ name, detail, signal, selected, onSelect, onChoose }: { name: string; detail: string | null; signal: number; selected: boolean; onSelect(): void; onChoose(): void }) {
  const theme = useTheme();
  return (
    <View onDoubleClick={onChoose}>
      <MenuRow
        selected={selected}
        leading={signal >= 0 ? <Signal level={signal} color={theme.icon} /> : undefined}
        title={name}
        onPress={onSelect}
        accessory={
          <>
            {detail ? (
              <Text size="caption" tone="textSecondary">
                {detail}
              </Text>
            ) : null}
            {selected ? <Symbol name="checkmark" size={11} weight="semibold" color={theme.accent} style={CHECK_GLYPH} /> : null}
          </>
        }
      />
    </View>
  );
}

const CHECK_GLYPH = { width: 16, height: 16 } as const;

export const DEVICE_CHOOSER_WIDTH = POPOVER_WIDTH.m;

export function DeviceChooser({ tabId, left, top }: { tabId: string; left: number; top: number }) {
  const chooser = useDeviceChooser(tabId);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => setSelected(null), [chooser?.id]);
  const guard = usePromptInputGuard(chooser?.id);
  if (!chooser) return null;
  const scanning = chooser.bothButtonsEnabled;
  const blocked = chooser.adapterOff || chooser.unauthorized;
  const valid = scanning || (selected !== null && selected < chooser.options.length);
  const choose = guard((index: number | null = selected) => {
    if (scanning) return chooseDevice(chooser.id, -1);
    if (index !== null) chooseDevice(chooser.id, index);
  });
  const cancel = () => cancelChooser(chooser.id);

  let body;
  if (chooser.unauthorized) {
    body = (
      <Notice
        icon="lock"
        text="Ardia needs access to Bluetooth to find devices."
        link="Open Bluetooth Settings"
        onLink={() => openChooserBluetoothSettings(chooser.id)}
      />
    );
  } else if (chooser.adapterOff) {
    body = <Notice icon="antenna.radiowaves.left.and.right.slash" text="Bluetooth is turned off. Turn it on to find devices." />;
  } else if (scanning) {
    body = null;
  } else {
    body = (
      <>
        <ScrollView style={{ maxHeight: 200, marginHorizontal: -PANEL.inset }}>
          <Box gap="xxs">
            {chooser.options.map((o, i) => (
              <OptionRow
                key={`${i}:${o.name}`}
                name={o.name}
                detail={o.connected ? "Connected" : o.paired ? "Paired" : null}
                signal={chooser.showSignal ? o.signal : -1}
                selected={selected === i}
                onSelect={() => setSelected(i)}
                onChoose={() => choose(i)}
              />
            ))}
          </Box>
        </ScrollView>
        <Box row gap="m" style={{ alignItems: "center", minHeight: 22 }}>
          {chooser.refreshing ? (
            <>
              <ActivitySpinner style={SPINNER} />
              <Text size="small" tone="textSecondary">
                {chooser.scanningText}
              </Text>
            </>
          ) : (
            <>
              {!chooser.options.length ? (
                <Text size="small" tone="textSecondary">
                  {chooser.noOptionsText}
                </Text>
              ) : null}
              {chooser.canRefresh ? <Button variant="text" look="link" title="Scan Again" onPress={() => rescanDevices(chooser.id)} /> : null}
            </>
          )}
        </Box>
      </>
    );
  }

  return (
    <Popover key={chooser.id} width={DEVICE_CHOOSER_WIDTH} top={top} left={left} modal={false}>
      <View
        focusable
        enableFocusRing={false}
        keyDownEvents={[{ key: "Escape" }, { key: "Enter" }]}
        onKeyDown={(e) => (e.nativeEvent.key === "Escape" ? cancel() : valid && !blocked && choose())}
      >
        <PromptBody icons={[chooser.showSignal || scanning ? "dot.radiowaves.left.and.right" : "cable.connector"]} title={chooser.title} detail={body}>
          <Button variant="pill" title={chooser.cancelLabel || "Cancel"} onPress={cancel} />
          <View pointerEvents={valid && !blocked ? "auto" : "none"} style={{ opacity: valid && !blocked ? 1 : UNAVAILABLE_OPACITY }}>
            <Button variant="pill" title={chooser.okLabel || "Connect"} primary onPress={() => choose()} />
          </View>
        </PromptBody>
      </View>
    </Popover>
  );
}

const SPINNER = { width: 14, height: 14 } as const;

function Notice({ icon, text, link, onLink }: { icon: string; text: string; link?: string; onLink?: () => void }) {
  const theme = useTheme();
  return (
    <Box row gap="m" padY="s">
      <Symbol name={icon} size={13} color={theme.textSecondary} style={{ width: 18, height: 18 }} />
      <Box gap="xs" style={{ flex: 1 }}>
        <Text tone="textSecondary" style={noticeType}>
          {text}
        </Text>
        {link && onLink ? <Button variant="text" look="link" title={link} onPress={onLink} /> : null}
      </Box>
    </Box>
  );
}
