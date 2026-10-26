import {
  permissionWarnings,
  cancelInstall,
  closeExtensionPopup,
  confirmInstall,
  closePinDialog,
  setPinned,
  useExtensions,
  useWindowExtensions,
  type InstallRequest,
} from "../../state/extensions/actions";
import { WebView, type WebViewHandle, Box, Button, Checkbox, PANEL, Surface, Text } from "../ui";
import type { InstalledExtension } from "../../state/extensions/store";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, findNodeHandle, Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { hex, useTheme } from "../ui/theme";
import { webviews } from "../../state/tabs/webviewHandles";
import { currentShownPageId } from "../../state/peek/actions";
import { useShownPageId } from "../../state/peek/hooks";
import { useExtensionProfile } from "../../state/extensions/hooks";
import { useWindowId } from "../../state/browser/hooks";
import { openFromPage, pageProfileId } from "../../state/tabs/openFromPage";
import { hairline, shadow, radius, space } from "../ui/tokens";
import { DIALOG_APPEAR_MS, DIALOG_TITLE, DIALOG_WIDTH, EXTENSION_PAGE_BACKGROUND, POPUP_SHADOW, useExtensionColors } from "./tokens";
import { curve, duration } from "../ui/motion";

export function ExtensionOverlays() {
  const windowId = useWindowId();
  const popup = useExtensions((e) => (e.popup?.windowId === windowId ? e.popup : null));
  const install = useExtensions((e) => (e.install?.windowId === windowId ? e.install : null));
  const pin = useExtensions((e) => e.pinDialog?.windowId === windowId);
  return (
    <>
      {popup && <ActionPopup key={`${popup.extensionId}|${popup.url}|${popup.opened ?? 0}`} {...popup} />}
      {install && <InstallDialog request={install} />}
      {pin && <PinDialog windowId={windowId} />}
    </>
  );
}

export function InstallDialogHost({ windowId, onClosed }: { windowId: string; onClosed: () => void }) {
  const install = useExtensions((e) => (e.install?.windowId === windowId ? e.install : null));
  useEffect(() => {
    if (!install) onClosed();
  }, [!install]);
  return install ? <InstallDialog request={install} /> : null;
}

const MIN = { width: 25, height: 25 };
const MAX = { width: 800, height: 600 };

const MEASURE = `
const measure = () => {
  const d = document.documentElement, b = document.body;
  return { w: Math.ceil(Math.max(d.scrollWidth, b ? b.scrollWidth : 0)), h: Math.ceil(Math.max(d.scrollHeight, b ? b.scrollHeight : 0)) };
};
const last = window.__ardiaSize;
const now = measure();
if (!last || last.w !== now.w || last.h !== now.h) {
  window.__ardiaSize = now;
  post("result", JSON.stringify(now));
} else {
  const ro = new ResizeObserver(() => {
    const m = measure();
    if (m.w === window.__ardiaSize.w && m.h === window.__ardiaSize.h) return;
    ro.disconnect();
    window.__ardiaSize = m;
    post("result", JSON.stringify(m));
  });
  ro.observe(document.documentElement);
  if (document.body) ro.observe(document.body);
}`;

function ActionPopup({ windowId, pageProfile, url, anchor }: { windowId: string; pageProfile: string; extensionId: string; url: string; anchor: { x: number; y: number; width: number; height: number } }) {
  const theme = useTheme();
  const colors = useExtensionColors();
  const web = useRef<WebViewHandle>(null);
  const screen = useWindowDimensions();
  const [windowWidth, setWindowWidth] = useState(0);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const appear = useRef(new Animated.Value(0)).current;
  const alive = useRef(true);
  const sized = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const tabId = useShownPageId(windowId);
  const openedOn = useRef(tabId);
  useEffect(() => {
    if (tabId !== openedOn.current) closeExtensionPopup();
  }, [tabId]);

  const resize = (w: number, h: number) => {
    const next = {
      width: Math.min(MAX.width, Math.max(MIN.width, Math.ceil(w))),
      height: Math.min(MAX.height, Math.max(MIN.height, Math.ceil(h))),
    };
    setSize((prev) => {
      if (!prev) Animated.timing(appear, { toValue: 1, duration: duration.popoverOpen, easing: curve.outCubic, useNativeDriver: true }).start();
      return prev && prev.width === next.width && prev.height === next.height ? prev : next;
    });
  };

  const watchSize = () => {
    if (sized.current) return;
    void web.current?.evaluate<{ w: number; h: number }>(MEASURE).then((m) => {
      if (!alive.current || !m || sized.current) return;
      resize(m.w, m.h);
      watchSize();
    });
  };

  const width = (size?.width ?? MIN.width) + 1;
  const height = (size?.height ?? MIN.height) + 1;
  const room = windowWidth || screen.width;
  const left = Math.max(8, Math.min(anchor.x + anchor.width - width, room - width - 8));
  const top = anchor.y + anchor.height + 6;

  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={closeExtensionPopup} onLayout={(e) => setWindowWidth(e.nativeEvent.layout.width)} />
      <Animated.View
        style={{
          position: "absolute",
          left,
          top,
          opacity: appear,
          transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }],
        }}
      >
        <Surface
          fill={hex(theme.panel)}
          cornerRadius={PANEL.radius}
          borderColor={hex(colors.popupBorder)}
          borderWidth={hairline.panel}
          shadowColor={POPUP_SHADOW.color}
          shadowOpacity={theme.dark ? POPUP_SHADOW.opacity.dark : POPUP_SHADOW.opacity.light}
          shadowRadius={POPUP_SHADOW.radius}
          shadowOffset={POPUP_SHADOW.offset}
          style={{ width, height }}
        >
          <View style={{ flex: 1, borderRadius: PANEL.radius, overflow: "hidden" }}>
            <WebView
              ref={web}
              style={StyleSheet.absoluteFill}
              url={url}
              profile={pageProfile}
              standalone
              extensionHost="popup"
              pageBackgroundColor={EXTENSION_PAGE_BACKGROUND}
              onPreferredSize={({ width, height }) => {
                sized.current = true;
                resize(width, height);
              }}
              onNavigationChange={({ isLoading }) => {
                if (isLoading) return;
                watchSize();
                void web.current?.focus();
              }}
              onWindowClose={closeExtensionPopup}
              onOpenWindow={(request) => {
                openFromPage(request, { windowId, profileId: pageProfileId(windowId, pageProfile) });
                if (request.disposition !== "background") closeExtensionPopup();
              }}
            />
          </View>
        </Surface>
      </Animated.View>
    </>
  );
}

function InstallDialog({ request }: { request: InstallRequest }) {
  const pkg = request.pkg;
  const name = pkg?.name ?? "Extension";
  const warnings = request.prompt ? request.prompt.permissions : pkg ? permissionWarnings(pkg) : [];
  const kind = request.prompt?.type;
  const title = kind === "re-enable" ? `Turn “${name}” back on?` : kind === "permissions" ? `“${name}” needs new permissions` : `Add “${name}”?`;
  const action = kind === "re-enable" ? "Turn On" : kind === "permissions" ? "Allow" : "Add Extension";
  const busy = request.status === "installing";

  let body;
  if (request.status === "error") {
    body = (
      <>
        <Text weight="semibold" style={DIALOG_TITLE}>Couldn't add the extension</Text>
        <Text tone="textSecondary" style={{ marginTop: space.s }}>{request.error}</Text>
      </>
    );
  } else {
    body = (
      <>
        <Box row gap="l" style={ALIGN_CENTER}>
          {pkg?.icon ? <Image source={{ uri: pkg.icon }} style={{ width: 36, height: 36 }} /> : null}
          <Text weight="semibold" style={[FLEX, DIALOG_TITLE]}>{title}</Text>
        </Box>
        {warnings.length ? (
          <>
            <Text style={{ marginTop: space.lx, marginBottom: space.s }}>It can:</Text>
            <ScrollView style={{ maxHeight: 180 }}>
              {warnings.map((w) => (
                <Box key={w} row gap="sm" style={{ marginBottom: space.xs }}>
                  <Text tone="textSecondary">•</Text>
                  <Text tone="textSecondary" style={FLEX}>{w}</Text>
                </Box>
              ))}
            </ScrollView>
          </>
        ) : (
          <Text tone="textSecondary" style={{ marginTop: space.lx }}>This extension requires no special permissions.</Text>
        )}
        {request.source === "unpacked" ? (
          <Text numberOfLines={2} ellipsizeMode="middle" size="caption" tone="textTertiary" style={{ marginTop: space.ml }}>
            {`Loaded from ${pkg?.path ?? ""}`}
          </Text>
        ) : null}
      </>
    );
  }

  return (
    <Dialog windowId={request.windowId} onDismiss={busy ? undefined : cancelInstall} onSubmit={request.status === "error" ? cancelInstall : () => void confirmInstall()}>
      {body}
      <Box row gap="m" style={{ justifyContent: "flex-end", marginTop: space.xlx }}>
        {request.status === "error" ? (
          <Button variant="pill" title="OK" primary onPress={cancelInstall} />
        ) : (
          <>
            <Button variant="pill" title="Cancel" onPress={cancelInstall} />
            <Button variant="pill" title={request.status === "installing" ? "Adding…" : action} primary onPress={() => void confirmInstall()} />
          </>
        )}
      </Box>
    </Dialog>
  );
}

function PinDialog({ windowId }: { windowId: string }) {
  const profile = useExtensionProfile(windowId);
  const list = useWindowExtensions(windowId);
  const close = closePinDialog;
  return (
    <Dialog windowId={windowId} onDismiss={close} onSubmit={close}>
      <Text weight="semibold" style={DIALOG_TITLE}>Pin Extensions</Text>
      <Text tone="textSecondary" style={{ marginTop: space.xs, marginBottom: space.l }}>
        Pinned extensions appear in the toolbar, next to the address.
      </Text>
      {list.length ? (
        <ScrollView style={{ maxHeight: 300 }}>
          {list.map((ext) => (
            <PinRow key={ext.id} ext={ext} onChange={(pinned) => void setPinned(profile, ext.id, pinned)} />
          ))}
        </ScrollView>
      ) : (
        <Text tone="textTertiary">No extensions are turned on.</Text>
      )}
      <Box row style={{ justifyContent: "flex-end", marginTop: space.xl }}>
        <Button variant="pill" title="Done" primary onPress={close} />
      </Box>
    </Dialog>
  );
}

function PinRow({ ext, onChange }: { ext: InstalledExtension; onChange: (pinned: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!ext.pinned)} style={PIN_ROW}>
      <Checkbox value={ext.pinned} onChange={onChange} />
      <Image source={{ uri: ext.actionIcon || ext.icon }} style={{ width: 16, height: 16 }} />
      <Text numberOfLines={1} style={FLEX}>
        {ext.name}
      </Text>
    </Pressable>
  );
}

function Dialog({ windowId, onDismiss, onSubmit, children }: { windowId: string; onDismiss?: () => void; onSubmit?: () => void; children: ReactNode }) {
  const theme = useTheme();
  const appear = useRef(new Animated.Value(0)).current;
  const keys = useRef<View>(null);
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: DIALOG_APPEAR_MS, easing: curve.outCubic, useNativeDriver: true }).start();
    keys.current?.focus();
    return () => {
      const tabId = currentShownPageId(windowId);
      if (tabId) void webviews.get(tabId)?.focus();
    };
  }, []);
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: appear, backgroundColor: theme.scrim }]}>
        <Pressable focusable={false} style={StyleSheet.absoluteFill} onPress={onDismiss} />
      </Animated.View>
      <Animated.View style={{ opacity: appear, transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
        <Surface
          fill={hex(theme.panel)}
          cornerRadius={radius.sheet}
          borderColor={hex(theme.panelBorder)}
          borderWidth={hairline.panel}
          shadowColor={shadow.dialog.color}
          shadowOpacity={theme.panelShadowOpacity}
          shadowRadius={shadow.dialog.radius}
          shadowOffset={shadow.dialog.offset}
          style={DIALOG_SIZE}
        >
          <View
            ref={keys}
            focusable
            enableFocusRing={false}
            keyDownEvents={DIALOG_KEYS}
            onKeyDown={(e) => {
              if (e.nativeEvent.key === "Escape") onDismiss?.();
              else if (e.nativeEvent.key === "Enter" && targetTag(e.nativeEvent) === findNodeHandle(keys.current)) onSubmit?.();
            }}
            style={DIALOG_PAD}
          >
            {children}
          </View>
        </Surface>
      </Animated.View>
    </View>
  );
}

const FLEX = { flex: 1 } as const;
const ALIGN_CENTER = { alignItems: "center" } as const;
const PIN_ROW = { flexDirection: "row", alignItems: "center", gap: space.ml, paddingVertical: space.s } as const;
const DIALOG_SIZE = { width: DIALOG_WIDTH } as const;
const DIALOG_PAD = { padding: space.xxl } as const;
const DIALOG_KEYS = [{ key: "Escape" }, { key: "Enter" }, { key: "Tab" }, { key: "Tab", shiftKey: true }];
const targetTag = (event: object) => (event as { target?: number }).target;
