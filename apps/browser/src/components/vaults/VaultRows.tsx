import { useEffect, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { VaultHighlight } from "../../state/vaults/highlight";
import type { VaultRow } from "../../state/vaults/menuModel";
import { itemKey } from "../../state/vaults/menuModel";
import { siteLabel } from "../../state/vaults/originMatch";
import { forgetVaultCode, loadVaultCode } from "../../state/vaults/codes";
import { noteCodeUnavailable } from "../../state/vaults/fill";
import { noteVaultMenuPress } from "../../state/vaults/menu";
import { useVaultCode, useVaultProvider } from "../../state/vaults/hooks";
import { ActivitySpinner, ink, Symbol, tabularNums, Text, useTheme, withAlpha } from "../ui";
import { CountdownRing, formatCode, VaultAppIcon } from "./VaultParts";
import { VAULT_MENU } from "./tokens";

export const rowHeight = (row: VaultRow) => (row.kind === "allPasswords" || row.kind === "suggest" || row.kind === "settings" ? VAULT_MENU.compactRow : VAULT_MENU.row);

const withScheme = (url: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
const itemSite = (urls: readonly string[]) => (urls[0] ? siteLabel(withScheme(urls[0])) : "");

const TEXT = { flex: 1, minWidth: 0, gap: VAULT_MENU.textGap } as const;
const SPINNER = { width: VAULT_MENU.spinner, height: VAULT_MENU.spinner } as const;
const TOUCH_ID = { width: VAULT_MENU.touchID, height: VAULT_MENU.touchID } as const;

type Ink = { title: string; detail: string; icon: string };

function useInk(highlight: VaultHighlight | null): Ink {
  const theme = useTheme();
  if (!highlight) return { title: theme.textPrimary, detail: withAlpha(theme.dark ? ink.white : ink.black, VAULT_MENU.detailAlpha), icon: theme.icon };
  const on = highlight.onLight ? ink.black : ink.white;
  return { title: on, detail: on, icon: on };
}

function RowShell({ height, compact, selected, highlight, onHover, onPress, children }: { height: number; compact: boolean; selected: boolean; highlight: VaultHighlight; onHover: () => void; onPress: () => void; children: (ink: Ink) => ReactNode }) {
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
              backgroundColor: selected || pressed ? highlight.fill : undefined,
            }}
          >
            {children(selected || pressed ? lit : plain)}
          </View>
        )}
      </Pressable>
    </View>
  );
}

function Lines({ title, detail, ink, mono }: { title: string; detail?: string; ink: Ink; mono?: boolean }) {
  return (
    <View style={TEXT}>
      <Text lines={1} weight={detail ? "medium" : undefined} color={ink.title} style={mono ? tabularNums : undefined}>
        {title}
      </Text>
      {detail ? (
        <Text lines={1} size="caption" color={ink.detail}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

function CodeLine({ tabId, seq, row, ink }: { tabId: string; seq: number; row: Extract<VaultRow, { kind: "otp" }>; ink: Ink }) {
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
      {live ? <CountdownRing key={live.expiresAt} expiresAt={live.expiresAt} period={live.period} /> : <ActivitySpinner style={SPINNER} />}
    </>
  );
}

export function VaultRowView({
  tabId,
  seq,
  row,
  selected,
  highlight,
  touchSlot,
  busy,
  site,
  onHover,
  onPress,
}: {
  tabId: string;
  seq: number;
  row: VaultRow;
  selected: boolean;
  highlight: VaultHighlight;
  touchSlot: boolean;
  busy: boolean;
  site: string;
  onHover: () => void;
  onPress: () => void;
}) {
  const provider = useVaultProvider(row.kind === "unlock" ? row.provider : "");
  const spinner = busy ? <ActivitySpinner style={SPINNER} /> : null;
  const shell = (children: (ink: Ink) => ReactNode) => (
    <RowShell height={rowHeight(row)} compact={rowHeight(row) === VAULT_MENU.compactRow} selected={selected} highlight={highlight} onHover={onHover} onPress={onPress}>
      {children}
    </RowShell>
  );
  switch (row.kind) {
    case "login": {
      const where = itemSite(row.item.urls) || site;
      const title = row.item.username || row.item.title || where;
      const detail = row.item.username ? where : row.item.title ? where : "";
      return shell((ink) => (
        <>
          <VaultAppIcon provider={row.item.provider} />
          <Lines title={title} detail={detail || undefined} ink={ink} />
          {spinner ?? (touchSlot ? <Symbol name="touchid" size={VAULT_MENU.touchID} color={ink.title} style={TOUCH_ID} /> : null)}
        </>
      ));
    }
    case "otp":
      return shell((ink) => (
        <>
          <CodeLine tabId={tabId} seq={seq} row={row} ink={ink} />
          {spinner}
        </>
      ));
    case "generate":
      return shell((ink) => (
        <>
          <VaultAppIcon provider="" symbol="key.fill" neutral />
          <Lines title="Use Strong Password" ink={ink} />
          {spinner}
        </>
      ));
    case "unlock":
      return shell((ink) => (
        <>
          <VaultAppIcon provider={row.provider} />
          <Lines title={`Unlock ${row.name}`} ink={ink} />
          {spinner ?? (touchSlot ? <Symbol name="touchid" size={VAULT_MENU.touchID} color={ink.title} style={TOUCH_ID} /> : null)}
        </>
      ));
    case "allPasswords":
      return shell((ink) => <Lines title="Other Passwords…" ink={ink} />);
    case "suggest":
      return shell((ink) => <Lines title="Suggest New Password" ink={ink} />);
    case "settings":
      return shell((ink) => <Lines title="Password Settings…" ink={ink} />);
  }
}
