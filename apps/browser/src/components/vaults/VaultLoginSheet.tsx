import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { VaultItem } from "../../state/vaults/types";
import { copyFailureMessage, copyFromManager, type VaultCopyField, type VaultCopyOutcome } from "../../state/vaults/actions";
import { brandOf } from "../../state/vaults/brands";
import { useVaultProvider } from "../../state/vaults/hooks";
import { closeSettingsSheet } from "../../state/settings/sheet";
import { Box, Button, DialogActions, DialogTitle, Sheet, space, Text } from "../ui";
import { Favicon } from "../favicon/Favicon";
import { Group, Row } from "../settings/Form";
import { BrandBadge } from "./VaultParts";
import { VAULT_SETTINGS } from "./tokens";

export const vaultItemUrl = (item: Pick<VaultItem, "urls">) => {
  const url = item.urls[0] ?? "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) || !url ? url : `https://${url}`;
};

export function CopyButton({ label, onCopy }: { label: string; onCopy: () => Promise<VaultCopyOutcome> }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const press = async () => {
    setBusy(true);
    const outcome = await onCopy();
    setBusy(false);
    if (outcome !== "copied") return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), VAULT_SETTINGS.copiedMs);
  };
  return (
    <Button
      variant="icon"
      icon={copied ? "checkmark" : "doc.on.doc"}
      size="m"
      disabled={busy}
      tooltip={copied ? "Copied" : `Copy ${label}`}
      onPress={() => void press()}
    />
  );
}

export function VaultLoginSheet({ item, site }: { item: VaultItem; site: string }) {
  const provider = useVaultProvider(item.provider);
  const name = provider?.name ?? brandOf(item.provider).name;
  const url = vaultItemUrl(item);
  const [problem, setProblem] = useState("");
  const copy = (field: VaultCopyField) => async () => {
    const outcome = await copyFromManager(item.provider, item.id, field);
    setProblem(copyFailureMessage(outcome, field, item.provider));
    return outcome;
  };
  return (
    <Sheet onClose={closeSettingsSheet}>
      <DialogTitle icon={url ? <Favicon url={url} size={20} /> : <BrandBadge provider={item.provider} />}>{site || item.title || name}</DialogTitle>
      <View style={SHEET_BODY}>
        <Group>
          {url ? <Row title="Website" description={url} /> : null}
          <Row title="Username">
            <Box row gap="xs" style={CENTER}>
              <Text selectable>{item.username || "No username"}</Text>
              {item.username ? <CopyButton label="Username" onCopy={copy("username")} /> : null}
            </Box>
          </Row>
          <Row title="Password">
            <Box row gap="xs" style={CENTER}>
              <Text>••••••••</Text>
              <CopyButton label="Password" onCopy={copy("password")} />
            </Box>
          </Row>
          <Row title="Saved In" icon={<BrandBadge provider={item.provider} />}>
            <Text tone="textSecondary">{name}</Text>
          </Row>
        </Group>
        {problem ? (
          <Text size="caption" tone="destructive" style={ERROR}>
            {problem}
          </Text>
        ) : null}
      </View>
      <DialogActions>
        <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
      </DialogActions>
    </Sheet>
  );
}

const SHEET_BODY = { marginTop: space.xl } as const;
const ERROR = { marginTop: space.ml } as const;
const CENTER = { alignItems: "center" } as const;
