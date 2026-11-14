import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeScanJudge, openCameraSettings, prepareCamera, type CameraAccess } from "../../state/sync/scan";
import { SCAN_REJECTED } from "../../state/sync/syncRules";
import { copy } from "../../lib/platformCopy";
import { capsule, CodeCamera, font, ink, scanInk, scanLayout, space, Symbol, useTheme } from "../ui";

const CAMERA_STOP_MS = 120;

type Props = { onScan: (phrase: string) => void; onEnterWords: () => void; onCancel: () => void };

export function SyncScan({ onScan, onEnterWords, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [access, setAccess] = useState<CameraAccess | "checking">("checking");
  const [rejected, setRejected] = useState(false);
  const judge = useRef(makeScanJudge()).current;
  const done = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const leave = (then: () => void) => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(then, CAMERA_STOP_MS);
  };
  useEffect(() => {
    void prepareCamera().then(setAccess);
  }, []);
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      leave(onCancel);
      return true;
    });
    return () => back.remove();
  }, [onCancel, leaving]);
  const read = (text: string) => {
    if (done.current) return;
    const verdict = judge(text);
    if (verdict.kind === "accept") {
      done.current = true;
      const phrase = verdict.phrase;
      leave(() => onScan(phrase));
    } else if (verdict.kind === "reject") setRejected(true);
  };
  return (
    <View style={styles.screen}>
      {access === "checking" ? <ActivityIndicator style={styles.center} color={ink.white} /> : null}
      {access === "granted" ? (
        <>
          <CodeCamera onCode={read} active={!leaving} />
          <View style={[styles.finder, { paddingTop: insets.top + 44, paddingBottom: insets.bottom + space.xl }]}>
            <View style={styles.words}>
              <Text accessibilityRole="header" style={[font.title3, styles.bold, styles.white]}>
                Scan the Code on Your Mac
              </Text>
              <Text style={[font.subheadline, styles.soft]}>In Ardia on your Mac, open Settings › Sync › Connect Another Device.</Text>
            </View>
            <View style={styles.frame} />
            {rejected ? <Text style={[font.subheadline, styles.medium, styles.white, styles.rejected]}>{SCAN_REJECTED}</Text> : <View />}
            <GlassButton title="Enter Words Instead" onPress={() => leave(onEnterWords)} />
          </View>
        </>
      ) : null}
      {access === "denied" ? (
        <Unavailable
          icon="gearshape"
          title="Allow Camera Access"
          message="Ardia uses the camera only to read the code your Mac shows. You can allow it in Settings, or type the 24 words instead."
          onSettings={openCameraSettings}
          onEnterWords={onEnterWords}
        />
      ) : null}
      {access === "unavailable" || access === "undetermined" ? (
        <Unavailable
          icon="macAndPhone"
          title={copy().cantScanTitle}
          message="Type the 24 words of your recovery phrase instead. Your Mac shows them under Connect Another Device."
          onEnterWords={onEnterWords}
        />
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => leave(onCancel)} style={[styles.cancel, { top: insets.top + space.xs }]}>
        <Text style={[font.body, styles.white]}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function Unavailable({ icon, title, message, onSettings, onEnterWords }: { icon: "gearshape" | "macAndPhone"; title: string; message: string; onSettings?: () => void; onEnterWords: () => void }) {
  return (
    <View style={styles.unavailable}>
      <Symbol name={icon} size={48} color={ink.white} />
      <Text style={[font.title3, styles.bold, styles.white, styles.centered]}>{title}</Text>
      <Text style={[font.subheadline, styles.soft]}>{message}</Text>
      {onSettings ? <GlassButton title="Open Settings" prominent onPress={onSettings} /> : null}
      <GlassButton title="Enter Words Instead" onPress={onEnterWords} />
    </View>
  );
}

function GlassButton({ title, onPress, prominent }: { title: string; onPress: () => void; prominent?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.glass, { backgroundColor: prominent ? ink.white : scanInk.glass }]}>
      <Text style={[font.body, styles.bold, { color: prominent ? theme.label : ink.white }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: ink.black },
  center: { ...StyleSheet.absoluteFillObject },
  finder: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "space-between" },
  words: { alignItems: "center", gap: space.xs, paddingHorizontal: space.xxl },
  frame: { width: scanLayout.frame, height: scanLayout.frame, borderRadius: scanLayout.frameRadius, borderWidth: scanLayout.frameStroke, borderColor: scanInk.frame },
  rejected: { backgroundColor: scanInk.note, borderRadius: scanLayout.noteRadius, paddingHorizontal: space.l, paddingVertical: space.s, overflow: "hidden" },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.m, paddingHorizontal: space.xxl },
  glass: { minHeight: 50, borderRadius: capsule(50), paddingHorizontal: space.xl, justifyContent: "center" },
  cancel: { position: "absolute", left: space.s, minHeight: 44, justifyContent: "center", paddingHorizontal: space.s },
  bold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  white: { color: ink.white },
  soft: { color: scanInk.soft, textAlign: "center" },
  centered: { textAlign: "center" },
});
