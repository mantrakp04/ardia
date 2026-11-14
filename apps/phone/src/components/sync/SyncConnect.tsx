import { useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { checkPhrase, connectSync, pastedText } from "../../state/sync/actions";
import { chooseFolderTitle, setupStepLabel, connectMessage, MAC_HINT, phraseFooter } from "../../state/sync/syncRules";
import { capsule, font, radius, settingsLayout, space, spacesLayout, Symbol, useTheme } from "../ui";
import { BarButton, Group, SettingsPage } from "../settings/SettingsKit";
import { CapsuleButton, SyncHero } from "./SyncPage";
import { SyncScan } from "./SyncScan";
import { copy } from "../../lib/platformCopy";
import type { ConnectResult } from "../../platform/sync";
import { canScanCodes } from "../../state/sync/scan";

type FlowProps = { onClose: () => void; onConnected: () => void; closes?: boolean };

export function SyncConnect({ onClose, onConnected, closes }: FlowProps) {
  const [phrase, setPhrase] = useState("");
  const [entering, setEntering] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scans] = useState(canScanCodes);
  const [connecting, setConnecting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ConnectResult["result"] | null>(null);
  const hasPhrase = phrase.length > 0 && checkPhrase(phrase).isValid;

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (connecting) return true;
      if (scanning) setScanning(false);
      else if (entering) setEntering(false);
      else onClose();
      return true;
    });
    return () => back.remove();
  }, [connecting, entering, scanning, onClose]);

  const connect = async () => {
    if (!hasPhrase || connecting) return;
    setConnecting(true);
    setFailure(null);
    const result = await connectSync(phrase);
    setConnecting(false);
    setLastResult(result.result);
    if (result.result === "connected") {
      setPhrase("");
      onConnected();
    } else setFailure(connectMessage(result));
  };

  if (scanning) {
    return (
      <SyncScan
        onScan={(text) => {
          setPhrase(text);
          setFailure(null);
          setScanning(false);
        }}
        onEnterWords={() => {
          setScanning(false);
          setEntering(true);
        }}
        onCancel={() => setScanning(false)}
      />
    );
  }
  if (entering) {
    return (
      <PhraseEntry
        initial={phrase}
        onBack={() => setEntering(false)}
        onUse={(text) => {
          setPhrase(text);
          setFailure(null);
          setEntering(false);
        }}
      />
    );
  }
  return (
    <SettingsPage
      title="Connect to Your Mac"
      onBack={closes || connecting ? undefined : onClose}
      leading={closes ? <BarButton title="Close" onPress={onClose} enabled={!connecting} /> : undefined}
    >
      <SyncHero title="Connect to Your Mac" subtitle="Two steps, and your Mac’s tabs are here." />
      <Group header="Two Steps" footer={copy().phraseStays}>
        <Step number={1} title="Show the code on your Mac" detail={MAC_HINT} done={hasPhrase} current>
          {hasPhrase ? (
            <PhraseAdded onChange={() => setEntering(true)} />
          ) : (
            <>
              {scans ? <CapsuleButton title="Scan Code" icon="qrcodeViewfinder" prominent onPress={() => setScanning(true)} /> : null}
              <CapsuleButton title="Enter Words" icon="textCursor" prominent={!scans} onPress={() => setEntering(true)} />
            </>
          )}
        </Step>
        <Step number={2} title="Choose the Ardia Sync folder" detail={copy().chooseFolderDetail} done={false} current={hasPhrase}>
          {connecting ? <Connecting /> : <CapsuleButton title={chooseFolderTitle(lastResult)} enabled={hasPhrase} onPress={() => void connect()} />}
          {failure ? <Problem text={failure} /> : null}
        </Step>
      </Group>
    </SettingsPage>
  );
}

function Step({ number, title, detail, done, current, children }: { number: number; title: string; detail: string; done: boolean; current: boolean; children: React.ReactNode }) {
  const theme = useTheme();
  const ink = done ? theme.switchOn : current ? theme.formAccent : theme.tertiaryLabel;
  return (
    <View style={styles.step}>
      <View accessible accessibilityLabel={setupStepLabel(number, done, current)} style={[styles.badge, { borderColor: ink, backgroundColor: done ? ink : undefined }]}>
        {done ? <Symbol name="checkmark" size={14} color={theme.groupFill} /> : <Text style={[font.footnote, styles.bold, { color: ink }]}>{number}</Text>}
      </View>
      <View style={styles.stepBody}>
        <Text style={[font.body, styles.bold, { color: current || done ? theme.label : theme.secondaryLabel }]}>{title}</Text>
        <Text style={[font.footnote, { color: theme.secondaryLabel }]}>{detail}</Text>
        <View style={styles.stepActions}>{children}</View>
      </View>
    </View>
  );
}

function PhraseAdded({ onChange }: { onChange: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.added}>
      <Symbol name="checkmarkCircle" size={18} color={theme.switchOn} />
      <Text style={[font.subheadline, styles.medium, styles.fill, { color: theme.switchOn }]}>Recovery phrase added</Text>
      <BarButton title="Change" onPress={onChange} />
    </View>
  );
}

function Connecting() {
  const theme = useTheme();
  return (
    <View style={styles.added}>
      <ActivityIndicator size="small" color={theme.secondaryLabel} />
      <Text style={[font.subheadline, { color: theme.secondaryLabel }]}>Connecting…</Text>
    </View>
  );
}

function Problem({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Text accessibilityLiveRegion="polite" style={[font.subheadline, { color: theme.destructive }]}>
      {text}
    </Text>
  );
}

function PhraseEntry({ initial, onUse, onBack }: { initial: string; onUse: (phrase: string) => void; onBack: () => void }) {
  const theme = useTheme();
  const [draft, setDraft] = useState(initial);
  const check = checkPhrase(draft);
  const footer = phraseFooter(check);
  const footerInk = footer.tone === "problem" ? theme.destructive : footer.tone === "good" ? theme.switchOn : theme.secondaryLabel;
  const use = () => {
    if (check.isValid) onUse(draft);
  };
  return (
    <SettingsPage title="Enter Words" onBack={onBack} trailing={<BarButton title="Use Phrase" emphasized enabled={check.isValid} onPress={use} />}>
      <View style={styles.phrase}>
        <View style={styles.phraseHeader}>
          <Text style={[font.footnote, styles.fill, { color: theme.secondaryLabel }]}>Recovery Phrase</Text>
          <Text style={[font.footnote, styles.digits, { color: check.isTooLong ? theme.destructive : theme.secondaryLabel }]}>{check.counterText}</Text>
        </View>
        <View style={[styles.field, { backgroundColor: theme.groupFill }]}>
          <TextInput
            accessibilityLabel="Recovery Phrase"
            value={draft}
            onChangeText={setDraft}
            placeholder="Enter your 24-word recovery phrase"
            placeholderTextColor={theme.tertiaryLabel}
            multiline
            autoFocus={!initial}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            spellCheck={false}
            keyboardType={Platform.OS === "android" ? "visible-password" : "default"}
            textContentType="none"
            onSubmitEditing={use}
            style={[font.body, styles.phraseInput, { color: theme.label }]}
          />
        </View>
        <Text accessibilityLiveRegion="polite" style={[font.footnote, styles.footer, { color: footerInk }]}>
          {footer.text}
        </Text>
      </View>
      {!draft ? (
        <View style={styles.paste}>
          <CapsuleButton
            title="Paste"
            icon="docOnDoc"
            onPress={() => {
              void pastedText().then((text) => {
                if (text.trim()) setDraft(text);
              });
            }}
          />
        </View>
      ) : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  fill: { flex: 1 },
  digits: { fontVariant: ["tabular-nums"] },
  step: { flexDirection: "row", gap: space.m, paddingHorizontal: settingsLayout.rowInset, paddingVertical: space.m },
  badge: { width: spacesLayout.stepBadge, height: spacesLayout.stepBadge, borderRadius: capsule(spacesLayout.stepBadge), borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  stepBody: { flex: 1, gap: space.xs },
  stepActions: { gap: space.s, paddingTop: space.xs },
  added: { flexDirection: "row", alignItems: "center", gap: space.s },
  phrase: { paddingHorizontal: space.l, gap: space.s },
  phraseHeader: { flexDirection: "row", paddingHorizontal: settingsLayout.rowInset },
  field: { borderRadius: radius.card, paddingHorizontal: settingsLayout.rowInset, paddingVertical: space.s },
  phraseInput: { minHeight: 140, textAlignVertical: "top", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  footer: { paddingHorizontal: settingsLayout.rowInset },
  paste: { alignItems: "center", paddingHorizontal: space.huge },
});
