import type { ReactNode } from "react";
import { useSettings } from "../../state/browser/hooks";
import { updateSettings } from "../../state/settings/actions";
import type { VaultProviderState } from "../../state/vaults/actions";
import { ActivitySpinner, Box, DialogTitle, proseLineHeight, space, Text, Toggle } from "../ui";
import { BrandBadge } from "./VaultParts";
import { VAULT_SETTINGS } from "./tokens";

export function SheetHead({ provider, title }: { provider: string; title: string }) {
  return <DialogTitle icon={<BrandBadge provider={provider} box={VAULT_SETTINGS.sheetTile} glyph={VAULT_SETTINGS.sheetGlyph} solid />}>{title}</DialogTitle>;
}

export function SheetText({ children }: { children: ReactNode }) {
  return (
    <Text size="small" tone="textSecondary" style={BODY}>
      {children}
    </Text>
  );
}

export function SheetError({ text }: { text: string }) {
  return text ? (
    <Text size="small" tone="destructive" style={BODY}>
      {text}
    </Text>
  ) : null;
}

export function Waiting({ text }: { text: string }) {
  return (
    <Box row gap="m" center style={GAP_TOP}>
      <ActivitySpinner style={SPINNER} />
      <Text size="small" tone="textSecondary">
        {text}
      </Text>
    </Box>
  );
}

export function TouchIdRow({ provider }: { provider: VaultProviderState }) {
  const on = useSettings((s) => s.vaultTouchID);
  if (!provider.capabilities.touchID) return null;
  return (
    <Box row gap="m" center style={GAP_TOP}>
      <Toggle value={on} accessibilityLabel="Unlock with Touch ID next time" onChange={(v) => updateSettings({ vaultTouchID: v })} />
      <Text size="small">Unlock with Touch ID next time</Text>
    </Box>
  );
}

const BODY = { marginTop: space.l, lineHeight: proseLineHeight.small } as const;
const GAP_TOP = { marginTop: space.l } as const;
const SPINNER = { width: VAULT_SETTINGS.spinner, height: VAULT_SETTINGS.spinner } as const;
