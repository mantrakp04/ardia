import { scanner, ScanView, sync, type ScanPermission } from "@ardia/phone-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function ScanLab({ note }: { note: (line: string) => void }) {
  const [permission, setPermission] = useState<ScanPermission | null>(null);
  const [active, setActive] = useState(true);
  const [rejected, setRejected] = useState(0);

  const report = useCallback(
    (line: string) => {
      console.log(`PAGELAB scan ${line}`);
      note(`scan ${line}`);
    },
    [note],
  );

  useEffect(() => {
    scanner.permission().then(setPermission, () => undefined);
  }, []);

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Scanner</Text>
      <Text style={styles.line}>
        available {String(scanner.isAvailable())} · permission {permission ? `${permission.status} (ask again ${permission.canAskAgain})` : "-"} · rejected {rejected}
      </Text>
      <View style={styles.row}>
        <Button label="Ask for camera" onPress={() => scanner.requestPermission().then((next) => {
          setPermission(next);
          report(`permission ${next.status}`);
        })} />
        <Button label={active ? "Pause" : "Resume"} onPress={() => setActive((on) => !on)} />
      </View>
      {permission?.status === "granted" && (
        <ScanView
          style={styles.camera}
          active={active}
          onCode={(text) => {
            const check = sync.check(text);
            report(`code: ${text.length} characters, ${check.wordCount} words, valid ${check.isValid}`);
          }}
          onRejected={() => {
            setRejected((count) => count + 1);
            report("rejected: not a recovery phrase");
          }}
          onError={(error) => report(`error ${error}`)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#f3e9e4", padding: 6, borderRadius: 6, gap: 4 },
  title: { fontSize: 13, fontWeight: "700", color: "#1d1a17" },
  line: { fontSize: 11, color: "#1d1a17" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  button: { backgroundColor: "#e3d2c9", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6 },
  buttonText: { fontSize: 13, color: "#1d1a17" },
  camera: { height: 220, borderRadius: 6, overflow: "hidden" },
});
