import { speech, type SpeechAccess } from "@ardia/phone-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function VoiceLab({ note }: { note: (line: string) => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [access, setAccess] = useState<SpeechAccess | null>(null);
  const [heard, setHeard] = useState("");
  const [level, setLevel] = useState(0);
  const session = useRef(0);

  const report = useCallback(
    (line: string) => {
      console.log(`PAGELAB voice ${line}`);
      note(`voice ${line}`);
    },
    [note],
  );

  useEffect(() => {
    speech.isAvailable().then(setAvailable, () => setAvailable(false));
    const subscription = speech.addListener((event) => {
      if (event.session !== session.current) return;
      if (event.type === "level") setLevel(event.level);
      else if (event.type === "text") {
        setHeard(event.text);
        report(`${event.isFinal ? "final" : "partial"} "${event.text}"`);
      } else report(`failure ${event.problem ?? "nothing heard"}`);
    });
    return () => {
      subscription.remove();
      speech.stop().catch(() => undefined);
    };
  }, [report]);

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Voice</Text>
      <Text style={styles.line}>available {String(available)} · access {access ?? "-"} · level {level.toFixed(2)}</Text>
      <Text style={styles.line}>heard: {heard || "-"}</Text>
      <View style={styles.row}>
        <Button label="Ask for mic" onPress={() => speech.requestAccess().then((next) => {
          setAccess(next);
          report(`access ${next}`);
        })} />
        <Button label="Start" onPress={() => {
          session.current += 1;
          setHeard("");
          speech.start(session.current).then(() => report(`listening, session ${session.current}`), (error: { message?: string }) => report(`start ✗ ${error.message ?? ""}`));
        }} />
        <Button label="Stop" onPress={() => speech.stop().then(() => report("stopped"))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#ece7f5", padding: 6, borderRadius: 6, gap: 4 },
  title: { fontSize: 13, fontWeight: "700", color: "#1d1a17" },
  line: { fontSize: 11, color: "#1d1a17" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  button: { backgroundColor: "#d8cfea", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6 },
  buttonText: { fontSize: 13, color: "#1d1a17" },
});
