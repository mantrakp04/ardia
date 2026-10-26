import { toAppUrl, urlForDisplay } from "@ardia/core";
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ui/theme";
import { webviews } from "../../state/tabs/webviewHandles";
import { Button, font, Panel, radius, space, Symbol, weight } from "../ui";
import { patchPage, usePage } from "../../state/tabs/pageState";
import { SAD_TAB_TITLE_SIZE, SHADOWS, STATUS_MOTION, windowColors } from "./tokens";

export function StatusBubble({ tabId, maxWidth }: { tabId: string; maxWidth: number }) {
  const colors = windowColors(useTheme().dark);
  const status = usePage(tabId, (p) => p.status);
  const [shown, setShown] = useState(status);
  const opacity = useRef(new Animated.Value(status ? 1 : 0)).current;
  useEffect(() => {
    if (status) {
      setShown(status);
      Animated.timing(opacity, { toValue: 1, ...STATUS_MOTION.show, useNativeDriver: true }).start();
      return;
    }
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, ...STATUS_MOTION.hide, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setShown("");
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [status]);
  if (!shown) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: space.s, bottom: space.s, maxWidth, opacity }}>
      <Panel fill={colors.statusFill} radius={radius.button} border={colors.statusBorder} shadow={SHADOWS.status} style={{ paddingHorizontal: space.m, height: 22, justifyContent: "center" }}>
        <Text numberOfLines={1} ellipsizeMode="middle" style={{ ...font.small, color: colors.statusText }}>
          {displayUrl(shown)}
        </Text>
      </Panel>
    </Animated.View>
  );
}

function displayUrl(url: string) {
  let out = /^https?:\/\//i.test(url) ? urlForDisplay(url) : toAppUrl(url);
  try {
    out = decodeURI(out);
  } catch {}
  return out;
}

export function SadTab({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const colors = windowColors(theme.dark);
  const crashed = usePage(tabId, (p) => !!p.crashed);
  const unresponsive = usePage(tabId, (p) => p.unresponsive);
  if (crashed) {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.crashedBackground, alignItems: "center", justifyContent: "center", padding: space.xxxl }]}>
        <Symbol name="exclamationmark.triangle" size={30} weight="light" color={theme.textSecondary} style={{ width: 44, height: 40, marginBottom: space.lx }} />
        <Text style={{ fontSize: SAD_TAB_TITLE_SIZE, fontWeight: weight.semibold, color: theme.textPrimary, marginBottom: space.s }}>This tab needs to reload</Text>
        <Text style={{ ...font.body, color: theme.textSecondary, textAlign: "center", maxWidth: 340, marginBottom: space.xlx }}>
          Something went wrong with this tab. Reloading often fixes it.
        </Text>
        <Button variant="pill"
          title="Reload"
          primary
          onPress={() => {
            patchPage(tabId, { crashed: null });
            void webviews.get(tabId)?.reload();
          }}
        />
      </View>
    );
  }
  if (!unresponsive) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", backgroundColor: colors.unresponsiveScrim }]}>
      <Panel fill={theme.panel} radius={radius.sheet} border={theme.panelBorder} shadow={SHADOWS.unresponsive} style={{ width: 320, padding: space.xlx, gap: space.s }}>
        <Text style={{ ...font.title, fontWeight: weight.semibold, color: theme.textPrimary }}>Page Unresponsive</Text>
        <Text style={{ ...font.small, color: theme.textSecondary, marginBottom: space.ml }}>You can wait for it to become responsive or exit the page.</Text>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.m }}>
          <Button variant="pill"
            title="Exit Page"
            onPress={() => {
              patchPage(tabId, { unresponsive: false });
              void webviews.get(tabId)?.resolveUnresponsive(true);
            }}
          />
          <Button variant="pill"
            title="Wait"
            primary
            onPress={() => {
              patchPage(tabId, { unresponsive: false });
              void webviews.get(tabId)?.resolveUnresponsive(false);
            }}
          />
        </View>
      </Panel>
    </View>
  );
}
