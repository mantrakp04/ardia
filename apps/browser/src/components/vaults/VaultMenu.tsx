import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, ScrollView, StyleSheet, View } from "react-native";
import { activateVaultRow, stepVaultMenu } from "../../state/vaults/fill";
import { closeVaultMenu, hoverVaultMenu, offerToFocusedField, restingRowOf, searchVaultMenu, selectVaultRow, setVaultMenuOffscreen, showVaultMatches, type VaultMenu as MenuState } from "../../state/vaults/menu";
import { FOOTER_KINDS, type VaultRow } from "../../state/vaults/menuModel";
import { siteLabel } from "../../state/vaults/originMatch";
import { useVaultMenu, useVaultMenuGlass, useVaultMenuRows, useVaultProviders, useVaultTouchID } from "../../state/vaults/hooks";
import { noteVaultTouchStatus, touchIDGlyphShown } from "../../state/vaults/touchID";
import { useWindowInFront } from "../../state/windows/inFront";
import { armVaultTouchID } from "../../state/vaults/touchID";
import { vaultHighlight } from "../../state/vaults/highlight";
import { over } from "../../lib/color";
import { useSettings, useTab, useTabLive } from "../../state/browser/hooks";
import { Button, curve, Divider, duration, GlassFill, ink, liquidGlass, PANEL, Panel, POPOVER_MARGIN, PopoverSurface, reduceMotion, SearchField, shadow, space, Text, useTheme, VaultTouchID, withAlpha } from "../ui";
import { rowHeight, VaultRowView } from "./VaultRows";
import { VAULT_MENU } from "./tokens";

type Area = { width: number; height: number };

export function VaultMenuHost({ tabId, zoom }: { tabId: string; zoom: number }) {
  const menu = useVaultMenu(tabId);
  const [area, setArea] = useState<Area>({ width: 0, height: 0 });
  useEffect(() => {
    offerToFocusedField(tabId);
    return () => closeVaultMenu(tabId);
  }, [tabId]);
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={(e) => setArea(e.nativeEvent.layout)}>
      {menu && area.width > 0 ? <MenuPanel key={menu.seq} tabId={tabId} menu={menu} zoom={zoom} area={area} /> : null}
    </View>
  );
}

const footerHeight = (rows: number) => rows * VAULT_MENU.compactRow + 2 * VAULT_MENU.separatorGap + VAULT_MENU.footerBottom;

function placement(menu: MenuState, zoom: number, area: Area, height: number) {
  const r = menu.rect ?? { x: POPOVER_MARGIN / zoom, y: 0, width: 0, height: 0 };
  const top = r.y * zoom;
  const bottom = (r.y + r.height) * zoom;
  const offscreen = !!menu.rect && (bottom < 0 || top > area.height);
  const width = Math.min(area.width - 2 * POPOVER_MARGIN, Math.max(VAULT_MENU.minWidth, Math.min(VAULT_MENU.maxWidth, r.width * zoom)));
  const left = Math.max(POPOVER_MARGIN, Math.min(r.x * zoom, area.width - width - POPOVER_MARGIN));
  const below = area.height - POPOVER_MARGIN - (bottom + VAULT_MENU.gap);
  const above = top - VAULT_MENU.gap - POPOVER_MARGIN;
  const upward = height > below && above > below;
  const room = Math.max(0, upward ? above : below);
  const y = upward ? top - VAULT_MENU.gap - Math.min(height, room) : Math.max(POPOVER_MARGIN, bottom + VAULT_MENU.gap);
  return { offscreen, width, left, upward, room, y };
}

function MenuSurface({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const glass = useVaultMenuGlass() && liquidGlass;
  if (!glass) return <PopoverSurface>{children}</PopoverSurface>;
  const veil = over(theme.popoverFill, theme.dark ? ink.black : ink.white);
  return (
    <Panel fill={ink.clear} radius={PANEL.radius} border={theme.popoverBorder} shadow={shadow.popover}>
      <GlassFill panelFill={theme.popoverFill} tint={withAlpha(veil, VAULT_MENU.glassTint)} radius={PANEL.radius} />
      <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, borderRadius: PANEL.radius, backgroundColor: withAlpha(veil, VAULT_MENU.glassVeil) }} />
      {children}
    </Panel>
  );
}

function MenuPanel({ tabId, menu, zoom, area }: { tabId: string; menu: MenuState; zoom: number; area: Area }) {
  const rows = useVaultMenuRows(menu);
  const theme = useTheme();
  const websiteColor = useTabLive(tabId, (l) => l.themeColor);
  const extendWebsiteColor = useSettings((s) => s.extendWebsiteColor);
  const glass = useVaultMenuGlass() && liquidGlass;
  const surface = glass ? (theme.dark ? VAULT_MENU.glassSurface.dark : VAULT_MENU.glassSurface.light) : over(theme.popoverFill, theme.dark ? ink.black : ink.white);
  const highlight = useMemo(() => vaultHighlight(websiteColor, extendWebsiteColor, theme.windowTint[0], theme.accent, surface), [websiteColor, extendWebsiteColor, theme, surface]);
  const [height, setHeight] = useState(0);
  const appear = useRef(new Animated.Value(0)).current;
  const scroll = useRef<ScrollView>(null);
  const scrollTop = useRef(0);
  const place = placement(menu, zoom, area, height);
  const still = reduceMotion() === true;
  useEffect(() => {
    if (height) Animated.timing(appear, { toValue: 1, ...VAULT_MENU_MOTION, useNativeDriver: true }).start();
  }, [height > 0]);
  useEffect(() => {
    setVaultMenuOffscreen(tabId, menu.seq, place.offscreen);
  }, [place.offscreen]);
  const list = rows.filter((r) => !FOOTER_KINDS.has(r.kind));
  const footer = rows.filter((r) => FOOTER_KINDS.has(r.kind));
  const listRoom = Math.max(VAULT_MENU.minList, Math.min(VAULT_MENU.maxList, place.room - (footer.length ? footerHeight(footer.length) : 0) - (menu.mode === "search" ? VAULT_MENU.searchHeight : 0)));
  const offsets = useMemo(() => {
    let at = 0;
    return list.map((r) => (at += rowHeight(r)) - rowHeight(r));
  }, [rows]);
  useEffect(() => {
    if (menu.selected < 0 || menu.selected >= list.length) return;
    const start = offsets[menu.selected]!;
    const end = start + rowHeight(list[menu.selected]!);
    if (start < scrollTop.current) scroll.current?.scrollTo({ y: start, animated: false });
    else if (end > scrollTop.current + listRoom) scroll.current?.scrollTo({ y: end - listRoom, animated: false });
  }, [menu.selected]);
  const touchIDReady = useVaultTouchID();
  const windowId = useTab(tabId, (t) => t?.windowId);
  const inFront = useWindowInFront(windowId);
  const providers = useVaultProviders();
  const shownSelected = inFront ? menu.selected : -1;
  const selectedRow = list[shownSelected];
  const touchable = (row: VaultRow | undefined) =>
    row?.kind === "login" || (row?.kind === "unlock" && !!providers.find((p) => p.id === row.provider)?.touchUnlock);
  const touchTarget = !touchIDReady || menu.hidden || !touchIDGlyphShown(menu.touch) || !touchable(selectedRow) ? -1 : shownSelected;
  useEffect(() => {
    if (inFront && !menu.hovered && menu.mode === "matches") selectVaultRow(tabId, restingRowOf(menu));
  }, [inFront]);
  const touchArmed = touchTarget >= 0 && !menu.busy;
  useEffect(() => {
    armVaultTouchID(tabId, touchArmed ? menu.seq : null);
    return () => armVaultTouchID(tabId, null);
  }, [tabId, touchArmed, menu.seq]);
  const touch = { phase: menu.touch, retries: menu.touchRetries };
  const site = siteLabel(menu.origin);
  const view = (row: VaultRow, index: number) => (
    <VaultRowView
      key={row.key}
      tabId={tabId}
      seq={menu.seq}
      row={row}
      site={site}
      selected={shownSelected === index}
      highlight={highlight}
      touch={index === touchTarget ? touch : null}
      busy={menu.busy === row.key}
      onHover={() => menu.selected !== index && selectVaultRow(tabId, index)}
      onPress={() => activateVaultRow(tabId, row)}
    />
  );
  const motion = menu.hidden ? { opacity: 0 } : still ? { opacity: height ? 1 : 0 } : { opacity: appear };
  return (
    <Animated.View
      pointerEvents={menu.hidden ? "none" : "auto"}
      onMouseEnter={() => hoverVaultMenu(tabId, true)}
      onMouseLeave={() => hoverVaultMenu(tabId, false)}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      style={{ position: "absolute", left: place.left, top: place.y, width: place.width, transformOrigin: place.upward ? "left bottom" : "left top", ...motion }}
    >
      <MenuSurface>
        {menu.mode === "search" ? (
          <View style={SEARCH_ROW}>
            <Button variant="icon" icon="chevron.backward" size="s" tooltip="Back" onPress={() => showVaultMatches(tabId)} />
            <SearchField
              look="bare"
              autoFocus
              value={menu.query}
              placeholder="Search Passwords"
              onChangeText={(q) => searchVaultMenu(tabId, q)}
              onArrow={(step) => stepVaultMenu(tabId, step > 0 ? "ArrowDown" : "ArrowUp")}
              onSubmit={() => stepVaultMenu(tabId, "Enter")}
              onEscape={() => stepVaultMenu(tabId, "Escape")}
              style={FILL}
            />
          </View>
        ) : null}
        {list.length ? (
          <ScrollView
            ref={scroll}
            style={{ maxHeight: listRoom }}
            contentContainerStyle={footer.length ? LIST : LIST_ALONE}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => (scrollTop.current = e.nativeEvent.contentOffset.y)}
          >
            {list.map(view)}
            {touchTarget >= 0 ? (
              <View pointerEvents="none" style={{ ...TOUCH_ID_SLOT, top: VAULT_MENU.listPad + offsets[touchTarget]! + (rowHeight(list[touchTarget]!) - VAULT_MENU.touchID) / 2 }}>
                <VaultTouchID key={menu.touchRearms} armed={touchArmed} onStatus={(status) => noteVaultTouchStatus(tabId, menu.seq, status)} style={TOUCH_ID_SIZE} />
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <View style={EMPTY}>
            <Text size="small" tone="textSecondary" lines={1}>
              {menu.mode === "search" ? "No matches" : `No passwords for ${site}`}
            </Text>
          </View>
        )}
        {menu.error ? (
          <Text size="caption" tone="destructive" lines={2} style={ERROR}>
            {menu.error}
          </Text>
        ) : null}
        {footer.length ? (
          <View style={FOOTER}>
            <Divider style={SEPARATOR} />
            <View style={FOOTER_ROWS}>{footer.map((row, i) => view(row, list.length + i))}</View>
          </View>
        ) : null}
      </MenuSurface>
    </Animated.View>
  );
}

const VAULT_MENU_MOTION = { duration: duration.fast, easing: curve.enter } as const;
const FILL = { flex: 1 } as const;
const SEARCH_ROW = { flexDirection: "row", alignItems: "center", gap: space.xs, height: VAULT_MENU.searchHeight, paddingHorizontal: VAULT_MENU.rowInset } as const;
const LIST = { paddingTop: VAULT_MENU.listPad, paddingBottom: VAULT_MENU.separatorGap } as const;
const TOUCH_ID_SIZE = { width: VAULT_MENU.touchID, height: VAULT_MENU.touchID } as const;
const TOUCH_ID_SLOT = { position: "absolute", right: VAULT_MENU.rowInset + VAULT_MENU.rowPadding, ...TOUCH_ID_SIZE } as const;
const LIST_ALONE = { paddingVertical: VAULT_MENU.listPad } as const;
const SEPARATOR = { marginHorizontal: VAULT_MENU.separatorInset } as const;
const EMPTY = { height: VAULT_MENU.compactRow, justifyContent: "center", paddingHorizontal: VAULT_MENU.separatorInset, marginTop: VAULT_MENU.listPad, marginBottom: VAULT_MENU.separatorGap } as const;
const ERROR = { paddingHorizontal: PANEL.inset, paddingBottom: space.s } as const;
const FOOTER = { paddingBottom: VAULT_MENU.footerBottom } as const;
const FOOTER_ROWS = { paddingTop: VAULT_MENU.separatorGap } as const;
