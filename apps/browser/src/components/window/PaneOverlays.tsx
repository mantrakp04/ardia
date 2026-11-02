import { toAppUrl, urlForDisplay } from "@ardia/core";
import { Animated, StyleSheet, View } from "react-native";
import { useTheme } from "../ui/theme";
import { webviews } from "../../state/tabs/webviewHandles";
import { Button, Dialog, DialogActions, DialogTitle, space, Symbol, Text, usePresence } from "../ui";
import { Hud } from "./Hud";
import { patchPage, usePage } from "../../state/tabs/pageState";
import { STATUS_MOTION, windowColors } from "./tokens";

export function StatusBubble({ tabId, maxWidth }: { tabId: string; maxWidth: number }) {
  const colors = windowColors(useTheme().dark);
  const status = usePage(tabId, (p) => p.status);
  const { shown, appear: opacity } = usePresence(status || null, STATUS_MOTION);
  if (!shown) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: space.s, bottom: space.s, maxWidth, opacity }}>
      <Hud shape="tile" height={STATUS_HEIGHT}>
        <Text numberOfLines={1} ellipsizeMode="middle" size="small" color={colors.statusText}>
          {displayUrl(shown)}
        </Text>
      </Hud>
    </Animated.View>
  );
}

const STATUS_HEIGHT = 22;

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
        <Symbol name="exclamationmark.triangle" size={30} weight="light" color={theme.textSecondary} style={{ width: 44, height: 40, marginBottom: space.xl }} />
        <Text size="large" weight="semibold" style={{ marginBottom: space.s }}>
          This tab needs to reload
        </Text>
        <Text tone="textSecondary" style={{ textAlign: "center", maxWidth: 340, marginBottom: space.xl }}>
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
    <Dialog width="xs" pad="xl">
      <DialogTitle subtitle="You can wait for it to become responsive or exit the page.">Page Unresponsive</DialogTitle>
      <DialogActions>
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
      </DialogActions>
    </Dialog>
  );
}
