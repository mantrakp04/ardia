import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { touchRetryInk, type VaultHighlight } from "../../state/vaults/highlight";
import { FOOTER_KINDS, itemKey, type VaultRow } from "../../state/vaults/menuModel";
import { siteLabel } from "../../state/vaults/originMatch";
import { forgetVaultCode, loadVaultCode } from "../../state/vaults/codes";
import { noteCodeUnavailable } from "../../state/vaults/fill";
import { noteVaultMenuPress, type VaultTouchPhase } from "../../state/vaults/menu";
import { useVaultCode } from "../../state/vaults/hooks";
import { ActivitySpinner, capsule, curve, ink, reduceMotion, springs, Symbol, tabularNums, Text, useTheme, withAlpha } from "../ui";
import { CountdownRing, formatCode, VaultAppIcon } from "./VaultParts";
import { VAULT_CODE, VAULT_MENU, VAULT_TOUCH } from "./tokens";
import type { VaultPasswordStyle } from "../../state/vaults/types";

export const rowHeight = (row: VaultRow) => (FOOTER_KINDS.has(row.kind) ? VAULT_MENU.compactRow : VAULT_MENU.row);

const withScheme = (url: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
const itemSite = (urls: readonly string[]) => (urls[0] ? siteLabel(withScheme(urls[0])) : "");

const TEXT = { flex: 1, minWidth: 0, gap: VAULT_MENU.textGap } as const;
const SPINNER = { width: VAULT_MENU.spinner, height: VAULT_MENU.spinner } as const;
const TOUCH_ID = { width: VAULT_MENU.touchID, height: VAULT_MENU.touchID } as const;
const LAYER = { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" } as const;
const DISC = { position: "absolute", width: VAULT_TOUCH.retryDisc, height: VAULT_TOUCH.retryDisc, borderRadius: capsule(VAULT_TOUCH.retryDisc) } as const;
const TRAILING = { width: VAULT_MENU.touchID, height: VAULT_MENU.touchID, alignItems: "center", justifyContent: "center" } as const;
const BUSY_SLOT = { position: "absolute", top: 0, bottom: 0, width: VAULT_MENU.touchID, alignItems: "center", justifyContent: "center" } as const;
const CODE_SLOT = { width: VAULT_CODE.ring, height: VAULT_CODE.ring, alignItems: "center", justifyContent: "center" } as const;

export const TRY_AGAIN = "Try Again";

export const GENERATOR_COPY: Record<VaultPasswordStyle, { title: string; detail?: string }> = {
  strong: { title: "New Strong Password" },
  alphanumeric: { title: "New Strong Password", detail: "Without Special Characters" },
  easyToType: { title: "New Strong Password", detail: "Easy to Type" },
  passphrase: { title: "New Memorable Password", detail: "Five Words" },
};

type Ink = { title: string; detail: string; icon: string };

export type VaultTouchState = { phase: VaultTouchPhase; retries: number };

function useInk(highlight: VaultHighlight | null): Ink {
  const theme = useTheme();
  if (!highlight) return { title: theme.textPrimary, detail: withAlpha(theme.dark ? ink.white : ink.black, VAULT_MENU.detailAlpha), icon: theme.icon };
  const on = highlight.onLight ? ink.black : ink.white;
  return { title: on, detail: on, icon: on };
}

function RowShell({ height, compact, selected, plated, highlight, onHover, onPress, children }: { height: number; compact: boolean; selected: boolean; plated: boolean; highlight: VaultHighlight; onHover: () => void; onPress: () => void; children: (ink: Ink, lit: boolean) => ReactNode }) {
  const lit = useInk(highlight);
  const plain = useInk(null);
  return (
    <View onMouseEnter={onHover}>
      <Pressable onPressIn={noteVaultMenuPress} onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height,
              marginHorizontal: VAULT_MENU.rowInset,
              paddingHorizontal: compact ? VAULT_MENU.footerPadding : VAULT_MENU.rowPadding,
              borderRadius: VAULT_MENU.rowRadius,
              flexDirection: "row",
              alignItems: "center",
              gap: VAULT_MENU.iconGap,
              backgroundColor: (selected && !plated) || (pressed && !selected) ? highlight.fill : undefined,
            }}
          >
            {children(selected || pressed ? lit : plain, selected || pressed)}
          </View>
        )}
      </Pressable>
    </View>
  );
}

function useTryAgain(retries: number) {
  const [shown, setShown] = useState(false);
  const first = useRef(retries);
  useEffect(() => {
    if (retries === first.current) return;
    setShown(true);
    const timer = setTimeout(() => setShown(false), VAULT_TOUCH.tryAgainMs);
    return () => clearTimeout(timer);
  }, [retries]);
  return shown;
}

function useCrossfade(on: boolean, ms: number) {
  const value = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    const run = Animated.timing(value, { toValue: on ? 1 : 0, duration: ms, easing: curve.enter, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [on]);
  return value;
}

function Swap({ from, to, showTo, color, size, weight, mono }: { from: string; to: string; showTo: boolean; color: string; size?: "caption"; weight?: "medium"; mono?: boolean }) {
  const fade = useCrossfade(showTo, VAULT_TOUCH.crossfadeMs);
  if (from === to) return <Text lines={1} size={size} weight={weight} color={color} style={mono ? tabularNums : undefined}>{from}</Text>;
  return (
    <View>
      <Animated.View style={{ opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
        <Text lines={1} size={size} weight={weight} color={color} style={mono ? tabularNums : undefined}>
          {from}
        </Text>
      </Animated.View>
      <Animated.View style={{ ...StyleSheet.absoluteFillObject, opacity: fade }}>
        <Text lines={1} size={size} weight={weight} color={color}>
          {to}
        </Text>
      </Animated.View>
    </View>
  );
}

function Lines({ title, detail, ink, mono, strong, tryAgain }: { title: string; detail?: string; ink: Ink; mono?: boolean; strong?: boolean; tryAgain?: boolean }) {
  const weight = strong || detail ? "medium" : undefined;
  const swapTitle = !!tryAgain && !detail;
  return (
    <View style={TEXT}>
      <Swap from={title} to={swapTitle ? TRY_AGAIN : title} showTo={swapTitle} color={ink.title} weight={weight} mono={mono} />
      {detail ? <Swap from={detail} to={tryAgain ? TRY_AGAIN : detail} showTo={!!tryAgain} color={ink.detail} size="caption" /> : null}
    </View>
  );
}

function TouchGlyph({ touch, ink, fill }: { touch: VaultTouchState; ink: Ink; fill: string | null }) {
  const theme = useTheme();
  const still = reduceMotion() === true;
  const shake = useRef(new Animated.Value(0)).current;
  const first = useRef(touch.retries);
  const granted = touch.phase === "granted";
  const check = useCrossfade(granted, VAULT_TOUCH.grantMs);
  useEffect(() => {
    if (still || touch.retries === first.current) return;
    shake.setValue(0);
    const run = Animated.timing(shake, { toValue: 1, duration: VAULT_TOUCH.shakeMs, easing: curve.linear, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [touch.retries]);
  const pop = useRef(new Animated.Value(granted ? 1 : 0)).current;
  useEffect(() => {
    if (!granted || still) return pop.setValue(granted ? 1 : 0);
    pop.setValue(0);
    const run = Animated.spring(pop, { toValue: 1, ...springs.bouncy, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [granted]);
  const retry = touch.phase === "retry";
  const red = touchRetryInk(fill, theme.destructive);
  const steps = VAULT_TOUCH.shakeSteps;
  const translateX = shake.interpolate({ inputRange: steps.map((_, i) => i / (steps.length - 1)), outputRange: [...steps] });
  const checkScale = pop.interpolate({ inputRange: [0, 1], outputRange: [VAULT_TOUCH.grantFrom, 1] });
  return (
    <Animated.View style={{ ...TRAILING, transform: still ? [] : [{ translateX }] }}>
      <Animated.View style={{ ...LAYER, opacity: check.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
        {retry && red.disc ? <View style={{ ...DISC, backgroundColor: red.disc }} /> : null}
        <Symbol name="touchid" size={VAULT_MENU.touchID} color={retry ? red.glyph : ink.title} style={TOUCH_ID} />
      </Animated.View>
      <Animated.View style={{ ...LAYER, opacity: check, transform: still ? [] : [{ scale: checkScale }] }}>
        <Symbol name="checkmark.circle.fill" size={VAULT_MENU.touchID} color={ink.title} style={TOUCH_ID} />
      </Animated.View>
    </Animated.View>
  );
}

function GrantedThenSpinner({ touch, ink, fill }: { touch: VaultTouchState; ink: Ink; fill: string | null }) {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), VAULT_TOUCH.grantMs + VAULT_TOUCH.grantHoldMs);
    return () => clearTimeout(timer);
  }, []);
  if (waited) return <Spinner />;
  return <TouchGlyph touch={touch} ink={ink} fill={fill} />;
}

function Spinner() {
  return (
    <View style={TRAILING}>
      <ActivitySpinner style={SPINNER} />
    </View>
  );
}

function BusyOverlay({ busy, compact = false }: { busy: boolean; compact?: boolean }) {
  return busy ? (
    <View pointerEvents="none" style={{ ...BUSY_SLOT, right: compact ? VAULT_MENU.footerPadding : VAULT_MENU.rowPadding }}>
      <ActivitySpinner style={SPINNER} />
    </View>
  ) : null;
}

function Trailing({ busy, touch, ink, fill, reserve }: { busy: boolean; touch: VaultTouchState | null; ink: Ink; fill: string | null; reserve: boolean }) {
  if (busy && touch?.phase === "granted") return <GrantedThenSpinner touch={touch} ink={ink} fill={fill} />;
  if (busy) return <Spinner />;
  if (touch) return <TouchGlyph touch={touch} ink={ink} fill={fill} />;
  return reserve ? <View style={TRAILING} /> : null;
}

function CodeLine({ tabId, seq, row, ink, busy }: { tabId: string; seq: number; row: Extract<VaultRow, { kind: "otp" }>; ink: Ink; busy: boolean }) {
  const key = itemKey(row.item);
  const code = useVaultCode(key);
  useEffect(() => {
    if (code === undefined) void loadVaultCode(row.item);
    if (code === "none") noteCodeUnavailable(tabId, seq, key);
    if (!code || typeof code === "string") return;
    const timer = setTimeout(() => {
      forgetVaultCode(row.item);
      void loadVaultCode(row.item);
    }, Math.max(0, code.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [code, key]);
  const live = code && typeof code === "object" ? code : null;
  return (
    <>
      <VaultAppIcon provider={row.item.provider} />
      <Lines title={live ? formatCode(live.code) : "••• •••"} detail={row.item.username || row.item.title || itemSite(row.item.urls)} ink={ink} mono />
      <View style={CODE_SLOT}>{live && !busy ? <CountdownRing key={live.expiresAt} expiresAt={live.expiresAt} period={live.period} /> : <ActivitySpinner style={SPINNER} />}</View>
    </>
  );
}

export function VaultRowView({
  tabId,
  seq,
  row,
  selected,
  plated = false,
  reserveTrailing = false,
  highlight,
  touch,
  busy,
  site,
  onHover,
  onPress,
}: {
  tabId: string;
  seq: number;
  row: VaultRow;
  selected: boolean;
  plated?: boolean;
  reserveTrailing?: boolean;
  highlight: VaultHighlight;
  touch: VaultTouchState | null;
  busy: boolean;
  site: string;
  onHover: () => void;
  onPress: () => void;
}) {
  const tryAgain = useTryAgain(touch?.retries ?? 0) && !!touch && !busy;
  const shell = (children: (ink: Ink, lit: boolean) => ReactNode) => (
    <RowShell height={rowHeight(row)} compact={FOOTER_KINDS.has(row.kind)} selected={selected} plated={plated} highlight={highlight} onHover={onHover} onPress={onPress}>
      {children}
    </RowShell>
  );
  const trailing = (ink: Ink, lit: boolean) => <Trailing busy={busy} touch={touch} ink={ink} fill={lit ? highlight.fill : null} reserve={reserveTrailing} />;
  switch (row.kind) {
    case "login": {
      const where = itemSite(row.item.urls) || site;
      const title = row.item.username || row.item.title || where;
      const detail = row.item.username ? where : row.item.title ? where : "";
      return shell((ink, lit) => (
        <>
          <VaultAppIcon provider={row.item.provider} />
          <Lines title={title} detail={detail || undefined} ink={ink} tryAgain={tryAgain} />
          {trailing(ink, lit)}
        </>
      ));
    }
    case "otp":
      return shell((ink) => (
        <>
          <CodeLine tabId={tabId} seq={seq} row={row} ink={ink} busy={busy} />
        </>
      ));
    case "username":
      return shell((ink) => (
        <>
          <VaultAppIcon provider="" symbol="person.crop.circle" neutral />
          <Lines title={row.username} detail="Used Before" ink={ink} />
          <BusyOverlay busy={busy} />
        </>
      ));
    case "generate": {
      const copy = GENERATOR_COPY[row.style];
      return shell((ink) => (
        <>
          <VaultAppIcon provider="" symbol="key.fill" neutral />
          <Lines title={copy.title} detail={copy.detail} ink={ink} strong />
          <BusyOverlay busy={busy} />
        </>
      ));
    }
    case "unlock":
      return shell((ink, lit) => (
        <>
          <VaultAppIcon provider={row.provider} />
          <Lines title={`Unlock ${row.name}`} ink={ink} tryAgain={tryAgain} />
          {trailing(ink, lit)}
        </>
      ));
    case "allPasswords":
      return shell((ink) => <Lines title="Other Passwords…" ink={ink} />);
    case "suggest":
      return shell((ink) => (
        <>
          <Lines title="Suggest New Password" ink={ink} />
          <BusyOverlay busy={busy} compact />
        </>
      ));
    case "openPasswords":
      return shell((ink) => <Lines title="Open Passwords" ink={ink} />);
    case "settings":
      return shell((ink) => <Lines title="Password Settings…" ink={ink} />);
  }
}
