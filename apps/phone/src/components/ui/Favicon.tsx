import { useState } from "react";
import { Image, StyleSheet } from "react-native";
import { Symbol } from "./Symbol";

export function Favicon({ url, size, color }: { url: string | null; size: number; color: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return <Symbol name="globe" size={size} color={color} />;
  return <Image source={{ uri: url }} onError={() => setFailed(url)} style={[styles.icon, { width: size, height: size, borderRadius: size * 0.22 }]} resizeMode="contain" />;
}

const styles = StyleSheet.create({ icon: { overflow: "hidden" } });
