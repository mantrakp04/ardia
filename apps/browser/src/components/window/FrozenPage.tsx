import { useEffect } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../ui/theme";
import { windowColors } from "./tokens";
import { useTab } from "../../state/browser/hooks";
import { activate } from "../../state/tabs/actions";
import { notePainted, startPinHandoff, useFrozenPages } from "../../state/pins/pinHandoff";

export function FrozenPage({ windowId, tabId, top }: { windowId: string; tabId: string | undefined; top: number }) {
  const theme = useTheme();
  useEffect(startPinHandoff, []);
  const frozen = useTab(tabId, (t) => !!t?.pageIn);
  const pass = useFrozenPages((f) => f.bridges[windowId]);
  const copyId = frozen ? tabId : pass?.copyId;
  const uri = useFrozenPages((f) => (copyId ? f.frames[copyId] : undefined)) ?? pass?.uri;
  if (!frozen && !pass) return null;
  return (
    <Pressable
      accessibilityLabel="Bring this tab to this window"
      onPress={() => {
        if (frozen && tabId) activate(tabId);
      }}
      style={[StyleSheet.absoluteFill, { top }]}
    >
      {uri && <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onLoad={() => notePainted(windowId)} />}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: windowColors(theme.dark).frozenWash }]} />
    </Pressable>
  );
}
