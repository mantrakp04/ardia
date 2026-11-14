import { DeckBackdrop, FilmGrain, Frost, FrostSource, lookIsNative, ProfileBackdrop, type FrostVariant } from "@ardia/phone-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const LOOKS = [
  { color: "plum", themeColors: [] as string[] },
  { color: "green", themeColors: ["#4F7CFF", "#9B6BFF"] },
  { color: "orange", themeColors: [] as string[] },
];

const VARIANTS: FrostVariant[] = ["bar", "sheet", "glass", "thin"];

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function LookLab() {
  const [lookIndex, setLookIndex] = useState(0);
  const [dark, setDark] = useState(false);
  const [still, setStill] = useState(false);
  const [variant, setVariant] = useState(0);
  const look = LOOKS[lookIndex]!;
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Look (native {String(lookIsNative())})</Text>
      <View style={styles.row}>
        <Button label={`Look ${look.color}`} onPress={() => setLookIndex((index) => (index + 1) % LOOKS.length)} />
        <Button label={dark ? "Dark" : "Light"} onPress={() => setDark((on) => !on)} />
        <Button label={still ? "Reduce motion" : "Moving"} onPress={() => setStill((on) => !on)} />
        <Button label={`Frost ${VARIANTS[variant]}`} onPress={() => setVariant((index) => (index + 1) % VARIANTS.length)} />
      </View>
      <FrostSource name="lab" style={styles.stage}>
        <DeckBackdrop style={StyleSheet.absoluteFill} color={look.color} themeColors={look.themeColors} dark={dark} reduceMotion={still} />
        <Text style={[styles.stageText, { color: dark ? "#fff" : "#1d1a17" }]}>The deck's mesh, blobs and grain. The frost below blurs this.</Text>
      </FrostSource>
      <View style={styles.pair}>
        <ProfileBackdrop style={styles.tile} color={look.color} themeColors={look.themeColors} dark={dark} themed />
        <ProfileBackdrop style={styles.tile} color={look.color} themeColors={look.themeColors} dark={dark} softened />
        <FilmGrain style={[styles.tile, { backgroundColor: dark ? "#2a2a2c" : "#e8e4f0" }]} opacity={0.2} />
      </View>
      <Frost source="lab" variant={VARIANTS[variant]} color={look.color} themeColors={look.themeColors} dark={dark} cornerRadius={14} style={styles.frost}>
        <Text style={{ color: dark ? "#fff" : "#1d1a17" }}>Frosted {VARIANTS[variant]}</Text>
      </Frost>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#eeeae2", padding: 6, borderRadius: 6, gap: 6 },
  title: { fontSize: 13, fontWeight: "700", color: "#1d1a17" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  button: { backgroundColor: "#ddd6c9", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6 },
  buttonText: { fontSize: 13, color: "#1d1a17" },
  stage: { height: 220, borderRadius: 10, overflow: "hidden", justifyContent: "flex-end", padding: 10 },
  stageText: { fontSize: 13 },
  pair: { flexDirection: "row", gap: 6 },
  tile: { flex: 1, height: 70, borderRadius: 8, overflow: "hidden" },
  frost: { height: 56, marginTop: -150, marginHorizontal: 16, justifyContent: "center", alignItems: "center" },
});
