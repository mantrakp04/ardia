import { useEffect } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { notePainted, startPinHandoff, useFrozenPages } from "./pinHandoff";

const LIGHT_WASH = "rgba(255,255,255,0.4)";
const DARK_WASH = "rgba(0,0,0,0.25)";

export function useFrozenPageShown(windowId: string, tabId: string | undefined, enabled: boolean): boolean {
  const frozen = useBrowser((s) => enabled && !!tabId && !!s.tabs[tabId]?.pageIn);
  const passing = useFrozenPages((f) => enabled && !!f.bridges[windowId]);
  return frozen || passing;
}

export function FrozenPage({ windowId, tabId, top }: { windowId: string; tabId: string | undefined; top: number }) {
  const theme = useTheme();
  useEffect(startPinHandoff, []);
  const frozen = useBrowser((s) => !!tabId && !!s.tabs[tabId]?.pageIn);
  const pass = useFrozenPages((f) => f.bridges[windowId]);
  const copyId = frozen ? tabId : pass?.copyId;
  const uri = useFrozenPages((f) => (copyId ? f.frames[copyId] : undefined)) ?? pass?.uri;
  if (!frozen && !pass) return null;
  return (
    <Pressable
      accessibilityLabel="Bring this tab to this window"
      onPress={() => {
        if (frozen && tabId) useBrowser.getState().activate(tabId);
      }}
      style={[StyleSheet.absoluteFill, { top }]}
    >
      {uri && <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onLoad={() => notePainted(windowId)} />}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.dark ? DARK_WASH : LIGHT_WASH }]} />
    </Pressable>
  );
}
