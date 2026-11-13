import { StatusBar, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, usePageTone } from "../../state/browse/hooks";
import type { OpenPage } from "../../state/browse/store";
import { isDarkColor, LoadingLine, pageBottomInset, useTheme } from "../ui";
import { BottomBar } from "./BottomBar";
import { PageSurface } from "./PageSurface";

export function BrowsingScreen({ page }: { page: OpenPage }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tone = usePageTone();
  const progress = useNavigation((n) => n?.progress ?? 0);
  const isLoading = useNavigation((n) => n?.isLoading ?? true);
  const top = tone?.top ?? theme.surface;
  const bottom = tone?.bottom ?? theme.surface;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface }]}>
      <StatusBar barStyle={isDarkColor(top) ? "light-content" : "dark-content"} />
      <View style={{ height: insets.top, backgroundColor: top }} />
      <View style={[styles.page, { marginBottom: pageBottomInset(insets.bottom) }]}>
        <PageSurface page={page} />
      </View>
      <View style={[styles.loading, { top: insets.top }]} pointerEvents="none">
        <LoadingLine progress={progress} isLoading={isLoading} color={theme.accent} />
      </View>
      <BottomBar fill={bottom} dark={isDarkColor(bottom)} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  loading: { position: "absolute", left: 0, right: 0 },
});
