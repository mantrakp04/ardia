import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, ScrollView, StyleSheet, View } from "react-native";
import { activateVaultRow, stepVaultMenu } from "../../state/vaults/fill";
import { closeVaultMenu, hoverVaultMenu, searchVaultMenu, selectVaultRow, showVaultMatches, type VaultMenu as MenuState } from "../../state/vaults/menu";
import type { VaultRow } from "../../state/vaults/menuModel";
import { siteLabel } from "../../state/vaults/originMatch";
import { useVaultMenu, useVaultMenuRows } from "../../state/vaults/hooks";
import { Button, MenuSeparator, PANEL, POPOVER_MARGIN, POPOVER_MOTION, PopoverSurface, reduceMotion, SearchField, space, Text } from "../ui";
import { rowHeight, VaultRowView } from "./VaultRows";
import { VAULT_MENU } from "./tokens";

type Area = { width: number; height: number };

export function VaultMenuHost({ tabId, zoom }: { tabId: string; zoom: number }) {
  const menu = useVaultMenu(tabId);
  const [area, setArea] = useState<Area>({ width: 0, height: 0 });
  useEffect(() => () => closeVaultMenu(tabId), [tabId]);
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={(e) => setArea(e.nativeEvent.layout)}>
      {menu && area.width > 0 ? <MenuPanel key={menu.seq} tabId={tabId} menu={menu} zoom={zoom} area={area} /> : null}
    </View>
  );
}

const FOOTER_KINDS = new Set<VaultRow["kind"]>(["allPasswords", "settings"]);
const FOOTER_HEIGHT = 2 * VAULT_MENU.compactRow + 2 * PANEL.separatorGap + 2 * VAULT_MENU.footerPad;

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

function MenuPanel({ tabId, menu, zoom, area }: { tabId: string; menu: MenuState; zoom: number; area: Area }) {
  const rows = useVaultMenuRows(menu);
  const [height, setHeight] = useState(0);
  const appear = useRef(new Animated.Value(0)).current;
  const scroll = useRef<ScrollView>(null);
  const scrollTop = useRef(0);
  const place = placement(menu, zoom, area, height);
  const still = reduceMotion() === true;
  useEffect(() => {
    if (height) Animated.timing(appear, { toValue: 1, ...POPOVER_MOTION.open, useNativeDriver: true }).start();
  }, [height > 0]);
  useEffect(() => {
    if (place.offscreen) closeVaultMenu(tabId);
  }, [place.offscreen]);
  const list = rows.filter((r) => !FOOTER_KINDS.has(r.kind));
  const footer = rows.filter((r) => FOOTER_KINDS.has(r.kind));
  const listRoom = Math.max(VAULT_MENU.minList, Math.min(VAULT_MENU.maxList, place.room - (footer.length ? FOOTER_HEIGHT : 0) - (menu.mode === "search" ? VAULT_MENU.searchHeight : 0)));
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
  const site = siteLabel(menu.origin);
  const view = (row: VaultRow, index: number) => (
    <VaultRowView
      key={row.key}
      tabId={tabId}
      seq={menu.seq}
      row={row}
      site={site}
      selected={menu.selected === index}
      busy={menu.busy === row.key || (row.kind === "generate" && menu.busy === "generate")}
      onHover={() => menu.selected !== index && selectVaultRow(tabId, index)}
      onPress={() => activateVaultRow(tabId, row)}
    />
  );
  const motion = still
    ? { opacity: height ? 1 : 0 }
    : {
        opacity: appear,
        transform: [
          { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [place.upward ? 3 : -3, 0] }) },
        ],
      };
  return (
    <Animated.View
      onMouseEnter={() => hoverVaultMenu(tabId, true)}
      onMouseLeave={() => hoverVaultMenu(tabId, false)}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      style={{ position: "absolute", left: place.left, top: place.y, width: place.width, transformOrigin: place.upward ? "left bottom" : "left top", ...motion }}
    >
      <PopoverSurface>
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
            contentContainerStyle={LIST}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => (scrollTop.current = e.nativeEvent.contentOffset.y)}
          >
            {list.map(view)}
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
            <MenuSeparator />
            {footer.map((row, i) => view(row, list.length + i))}
          </View>
        ) : null}
      </PopoverSurface>
    </Animated.View>
  );
}

const FILL = { flex: 1 } as const;
const SEARCH_ROW = { flexDirection: "row", alignItems: "center", gap: space.xs, height: VAULT_MENU.searchHeight, paddingHorizontal: space.ml } as const;
const LIST = { paddingVertical: VAULT_MENU.listPad } as const;
const EMPTY = { height: VAULT_MENU.compactRow, justifyContent: "center", paddingHorizontal: PANEL.inset, marginTop: VAULT_MENU.listPad } as const;
const ERROR = { paddingHorizontal: PANEL.inset, paddingBottom: space.s } as const;
const FOOTER = { paddingBottom: VAULT_MENU.footerPad } as const;
