import { useEffect, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { VaultRow } from "../../state/vaults/menuModel";
import { itemKey } from "../../state/vaults/menuModel";
import { forgetVaultCode, loadVaultCode } from "../../state/vaults/codes";
import { noteCodeUnavailable } from "../../state/vaults/fill";
import { noteVaultMenuPress } from "../../state/vaults/menu";
import { useVaultCode, useVaultProvider } from "../../state/vaults/hooks";
import { Favicon } from "../favicon/Favicon";
import { ActivitySpinner, menuRowFill, PANEL, Symbol, tabularNums, Text, useTheme } from "../ui";
import { BrandBadge, CountdownRing, formatCode } from "./VaultParts";
import { VAULT_MENU } from "./tokens";

export const rowHeight = (row: VaultRow) => (row.kind === "login" || row.kind === "otp" ? VAULT_MENU.row : VAULT_MENU.compactRow);

const faviconUrl = (url: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);

const SLOT = { width: PANEL.iconSlot, height: PANEL.iconSlot, alignItems: "center", justifyContent: "center" } as const;
const TEXT = { flex: 1, minWidth: 0, gap: VAULT_MENU.textGap } as const;
const SPINNER = { width: VAULT_MENU.spinner, height: VAULT_MENU.spinner } as const;
const GLYPH = { width: PANEL.iconSlot, height: PANEL.iconSlot } as const;

function RowShell({ height, selected, onHover, onPress, children }: { height: number; selected: boolean; onHover: () => void; onPress: () => void; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View onMouseEnter={onHover}>
      <Pressable onPressIn={noteVaultMenuPress} onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height,
              marginHorizontal: PANEL.rowInset,
              paddingHorizontal: PANEL.rowPadding,
              borderRadius: PANEL.rowRadius,
              flexDirection: "row",
              alignItems: "center",
              gap: PANEL.iconGap,
              backgroundColor: pressed || selected ? menuRowFill(theme, pressed) : undefined,
            }}
          >
            {children}
          </View>
        )}
      </Pressable>
    </View>
  );
}

function Lines({ title, detail, mono }: { title: string; detail?: string; mono?: boolean }) {
  return (
    <View style={TEXT}>
      <Text lines={1} weight={mono ? "semibold" : undefined} style={mono ? tabularNums : undefined}>
        {title}
      </Text>
      {detail ? (
        <Text lines={1} size="caption" tone="textSecondary">
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

function Trailing({ busy, provider, name }: { busy: boolean; provider: string; name: string }) {
  return busy ? <ActivitySpinner style={SPINNER} /> : <BrandBadge provider={provider} tooltip={name} />;
}

function CodeLine({ tabId, seq, row }: { tabId: string; seq: number; row: Extract<VaultRow, { kind: "otp" }> }) {
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
      <View style={SLOT}>{live ? <CountdownRing key={live.expiresAt} expiresAt={live.expiresAt} period={live.period} /> : <ActivitySpinner style={SPINNER} />}</View>
      <Lines title={live ? formatCode(live.code) : "••• •••"} detail={row.item.title} mono />
    </>
  );
}

export function VaultRowView({
  tabId,
  seq,
  row,
  selected,
  busy,
  site,
  onHover,
  onPress,
}: {
  tabId: string;
  seq: number;
  row: VaultRow;
  selected: boolean;
  busy: boolean;
  site: string;
  onHover: () => void;
  onPress: () => void;
}) {
  const theme = useTheme();
  const provider = useVaultProvider(row.kind === "login" || row.kind === "otp" ? row.item.provider : row.kind === "unlock" ? row.provider : "");
  const name = provider?.name ?? "";
  const shell = (children: ReactNode) => (
    <RowShell height={rowHeight(row)} selected={selected} onHover={onHover} onPress={onPress}>
      {children}
    </RowShell>
  );
  switch (row.kind) {
    case "login":
      return shell(
        <>
          <View style={SLOT}>
            {row.item.urls[0] ? <Favicon url={faviconUrl(row.item.urls[0])} /> : <Symbol name="key.fill" size={PANEL.iconSize} color={theme.textTertiary} style={GLYPH} />}
          </View>
          <Lines title={row.item.title || site} detail={row.item.username || undefined} />
          <Trailing busy={busy} provider={row.item.provider} name={name} />
        </>,
      );
    case "otp":
      return shell(
        <>
          <CodeLine tabId={tabId} seq={seq} row={row} />
          <Trailing busy={busy} provider={row.item.provider} name={name} />
        </>,
      );
    case "generate":
      return shell(
        <>
          <Symbol name="key.fill" size={PANEL.iconSize} color={theme.accent} style={GLYPH} />
          <Lines title="Use Strong Password" />
          {busy ? <ActivitySpinner style={SPINNER} /> : null}
        </>,
      );
    case "unlock":
      return shell(
        <>
          <View style={SLOT}>
            <BrandBadge provider={row.provider} box={VAULT_MENU.unlockBadge.box} glyph={VAULT_MENU.unlockBadge.glyph} />
          </View>
          <Lines title={`Unlock ${row.name}`} />
          {busy ? <ActivitySpinner style={SPINNER} /> : provider?.capabilities.touchID ? <Symbol name="touchid" size={PANEL.iconSize} color={theme.icon} style={GLYPH} /> : null}
        </>,
      );
    case "allPasswords":
      return shell(
        <>
          <Symbol name="magnifyingglass" size={PANEL.iconSize} color={theme.icon} style={GLYPH} />
          <Lines title="All Passwords…" />
        </>,
      );
    case "settings":
      return shell(
        <>
          <Symbol name="gearshape" size={PANEL.iconSize} color={theme.icon} style={GLYPH} />
          <Lines title="Password Settings" />
        </>,
      );
  }
}
