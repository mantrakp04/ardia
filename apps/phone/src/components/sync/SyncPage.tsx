import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { acknowledgeSyncReset, changeSyncFolder, setDeviceName, stopSyncing, syncNow } from "../../state/sync/actions";
import { useSyncStatus, useSyncView } from "../../state/sync/hooks";
import { connectMessage, deviceIcon, inboxNotice, shownProfile, deviceSeen, isSyncConnected, isSyncOff, orderedDevices, sendReceivers, syncHeroSubtitle } from "../../state/sync/syncRules";
import { popSettings, pushSettings } from "../../state/settings/nav";
import { capsule, ConfirmDialog, font, settingsLayout, settingsTint, space, Symbol, useTheme, type Confirmation, type SymbolName } from "../ui";
import { ButtonRow, Divider, Group, IconTile, NavRow, SettingsPage, ValueRow } from "../settings/SettingsKit";

const NAME_SETTLE_MS = 600;
const DEVICE_ICONS: Record<ReturnType<typeof deviceIcon>, SymbolName> = { phone: "iphone", laptop: "laptop", desktop: "macDesktop" };

export function SyncHero({ title, subtitle, warning, children }: { title: string; subtitle: string; warning?: boolean; children?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.hero}>
      <IconTile icon="macAndPhone" tint={settingsTint.sync} side={settingsLayout.heroTile} />
      <Text accessibilityRole="header" style={[font.title2, styles.bold, { color: theme.label }]}>
        {title}
      </Text>
      <Text style={[font.subheadline, styles.centered, { color: warning ? theme.destructive : theme.secondaryLabel }]}>{subtitle}</Text>
      {children}
    </View>
  );
}

export function CapsuleButton({ title, onPress, prominent, enabled = true, icon }: { title: string; onPress: () => void; prominent?: boolean; enabled?: boolean; icon?: SymbolName }) {
  const theme = useTheme();
  const ink = prominent ? theme.groupFill : theme.formAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={[styles.capsule, { backgroundColor: prominent ? theme.label : theme.tertiaryFill, opacity: enabled ? 1 : 0.4 }]}
    >
      {icon ? <Symbol name={icon} size={16} color={ink} /> : null}
      <Text style={[font.body, styles.bold, { color: ink }]}>{title}</Text>
    </Pressable>
  );
}

function FeatureRow({ icon, title, divider }: { icon: SymbolName; title: string; divider?: boolean }) {
  const theme = useTheme();
  return (
    <View accessible>
      <View style={styles.feature}>
        <View style={styles.featureIcon}>
          <Symbol name={icon} size={20} color={theme.formAccent} />
        </View>
        <Text style={[font.body, { color: theme.label }]}>{title}</Text>
      </View>
      {divider ? <Divider inset={settingsLayout.rowInset + 28 + space.s} /> : null}
    </View>
  );
}

function DeviceName({ current }: { current: string }) {
  const theme = useTheme();
  const [draft, setDraft] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const field = useRef<TextInput>(null);
  const pending = useRef<string | null>(null);
  useEffect(() => setDraft(current), [current]);
  const save = () => {
    const trimmed = pending.current?.trim();
    pending.current = null;
    if (trimmed && trimmed !== current) setDeviceName(trimmed);
  };
  useLayoutEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      save();
      if (field.current?.isFocused()) field.current.blur();
    },
    [],
  );
  const change = (text: string) => {
    setDraft(text);
    pending.current = text;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, NAME_SETTLE_MS);
  };
  return (
    <Group header="This Phone’s Name" footer="Shown on your Mac.">
      <View style={styles.row}>
        <TextInput
          ref={field}
          accessibilityLabel="Name"
          value={draft}
          onChangeText={change}
          placeholder="Name"
          placeholderTextColor={theme.tertiaryLabel}
          autoCapitalize="words"
          returnKeyType="done"
          style={[font.body, styles.input, { color: theme.label }]}
        />
      </View>
    </Group>
  );
}

export function SyncPage() {
  const theme = useTheme();
  const status = useSyncStatus();
  const view = useSyncView();
  const [syncing, setSyncing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const off = isSyncOff(status);
  const hero = syncHeroSubtitle(status);
  const notice = inboxNotice(status);
  const devices = orderedDevices(view.devices);
  const noReceivers = sendReceivers(view, shownProfile(view, status)?.syncId ?? null).length === 0;
  const now = Date.now();
  const chooseFolder = async () => setFolderError(connectMessage(await changeSyncFolder()));
  const runSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    await syncNow();
    setSyncing(false);
  };
  const confirmStop = () =>
    setConfirmation({
      title: "Stop Syncing This Device?",
      message: "To sync again, you’ll need your Mac’s code or your recovery phrase.",
      action: "Stop Syncing",
      run: async () => {
        setStopping(true);
        await stopSyncing();
        setStopping(false);
      },
    });
  return (
    <SettingsPage title="Sync With Mac" onBack={popSettings}>
      <SyncHero title="Sync With Mac" subtitle={hero.text} warning={hero.isWarning}>
        {off ? <CapsuleButton title="Connect to Your Mac" prominent onPress={() => pushSettings({ page: "syncConnect" })} /> : null}
      </SyncHero>
      {off ? (
        <Group header="What You Get" footer="End-to-end encrypted, in a folder you choose.">
          <FeatureRow icon="laptop" title="Your Mac’s Tabs" divider />
          <FeatureRow icon="pinFill" title="Pinned Tabs and Spaces" divider />
          <FeatureRow icon="paperplane" title="Send Tabs Both Ways" divider />
          <FeatureRow icon="clockArrow" title="History and Bookmarks" />
        </Group>
      ) : null}
      {notice ? (
        <Group footer={notice.footer}>
          <View accessible style={styles.row}>
            <Symbol name="exclamationmarkTriangle" size={20} color={theme.destructive} />
            <Text style={[font.body, styles.fill, { color: theme.label }]}>{notice.message}</Text>
          </View>
        </Group>
      ) : null}
      {status.attention === "folder" ? (
        <Group footer="Choose the Ardia Sync folder again.">
          <ButtonRow title="Choose Folder…" onPress={() => void chooseFolder()} />
        </Group>
      ) : null}
      {status.attention === "phrase" ? (
        <Group>
          <NavRow title="Enter Recovery Phrase" onPress={() => pushSettings({ page: "syncConnect" })} />
        </Group>
      ) : null}
      {status.attention === "reset" ? (
        <Group footer="Tabs on this phone stay.">
          <NavRow
            title="Connect Again"
            onPress={() => {
              void acknowledgeSyncReset().then(() => pushSettings({ page: "syncConnect" }));
            }}
          />
        </Group>
      ) : null}
      {isSyncConnected(status) ? (
        <>
          <Group>
            <ButtonRow title={syncing ? "Syncing…" : "Sync Now"} enabled={!syncing} busy={syncing} onPress={() => void runSyncNow()} />
          </Group>
          {devices.length ? (
            <Group header="Devices" footer={noReceivers ? "Update Ardia on your Mac to send tabs to it." : null}>
              {devices.map((device, index) => (
                <View key={device.id}>
                  <View accessible accessibilityLabel={`${device.name}, ${deviceSeen(device, now)}`} style={styles.row}>
                    <Symbol name={DEVICE_ICONS[deviceIcon(device.kind, device.name)]} size={22} color={theme.secondaryLabel} />
                    <Text style={[font.body, styles.fill, { color: theme.label }]} numberOfLines={1}>
                      {device.name}
                    </Text>
                    <Text style={[font.body, { color: theme.secondaryLabel }]}>{deviceSeen(device, now)}</Text>
                  </View>
                  {index < devices.length - 1 ? <Divider inset={settingsLayout.rowInset + 22 + settingsLayout.labelGap} /> : null}
                </View>
              ))}
            </Group>
          ) : null}
          <DeviceName current={status.deviceName} />
          <Group header="Sync Folder" footer={folderError ?? "Encrypted so only your devices can read it."}>
            <ValueRow title="Folder" value={status.folderName ?? "Ardia Sync"} divider />
            <ButtonRow title="Change Folder…" onPress={() => void chooseFolder()} />
          </Group>
          <Group footer="Your Mac stops seeing this phone’s tabs.">
            <ButtonRow title="Stop Syncing…" destructive enabled={!stopping} busy={stopping} onPress={confirmStop} />
          </Group>
        </>
      ) : null}
      {confirmation ? <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} /> : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: space.s, paddingHorizontal: space.xxl },
  bold: { fontWeight: "600" },
  centered: { textAlign: "center" },
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs + 2,
    minHeight: 48,
    paddingHorizontal: space.xl,
    borderRadius: capsule(48),
    marginTop: space.s,
    alignSelf: "stretch",
  },
  feature: { flexDirection: "row", alignItems: "center", gap: space.s, minHeight: 44, paddingHorizontal: settingsLayout.rowInset, paddingVertical: space.xs },
  featureIcon: { width: 28, alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: settingsLayout.labelGap, minHeight: settingsLayout.rowMinHeight, paddingHorizontal: settingsLayout.rowInset },
  fill: { flex: 1 },
  input: { flex: 1, paddingVertical: space.s },
});
