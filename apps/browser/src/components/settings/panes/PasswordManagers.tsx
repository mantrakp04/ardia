import { useEffect, useState } from "react";
import { View } from "react-native";
import { confirm, showMenu } from "../../../state/app/system";
import { useSettings } from "../../../state/browser/hooks";
import { updateSettings } from "../../../state/settings/actions";
import { VAULT_LOCK_MINUTES } from "../../../state/settings/settings";
import { lockProvider, refreshProvider, reloadProviders, signInError, signOutProvider, unlockProvider, type VaultProviderState } from "../../../state/vaults/actions";
import { useVaultProviders, useVaultsLoaded } from "../../../state/vaults/hooks";
import { Box, Button, PopUp, space } from "../../ui";
import { BrandBadge } from "../../vaults/VaultParts";
import { VAULT_SETTINGS } from "../../vaults/tokens";
import { Group, Row, SectionHeader, SettingToggle } from "../Form";
import { showConnectSheet, showUnlockSheet } from "./PasswordManagerSheets";

const LOCK_TITLES: Record<(typeof VAULT_LOCK_MINUTES)[number], string> = { 5: "5 Minutes", 15: "15 Minutes", 30: "30 Minutes", 60: "1 Hour", 0: "Never" };
const LOCK_OPTIONS = VAULT_LOCK_MINUTES.map((m) => ({ value: String(m), title: LOCK_TITLES[m] }));
const ASK = "ask";

function stateLine(p: VaultProviderState): string | undefined {
  const account = [p.account, p.server && p.capabilities.selfHosted ? p.server.replace(/^https?:\/\//, "") : null].filter(Boolean).join(" · ");
  const status = p.state === "locked" ? "Locked" : p.state === "notInstalled" ? "Not installed" : p.state === "unavailable" ? p.message || "Not available" : p.state === "signedOut" ? "Not connected" : "";
  return [account, status].filter(Boolean).join(" · ") || undefined;
}

function ProviderRow({ provider }: { provider: VaultProviderState }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unlock = async () => {
    setBusy(true);
    setError("");
    const result = await unlockProvider(provider.id, null);
    setBusy(false);
    if (result.needs === "password") return showUnlockSheet(provider.id);
    if (!result.ok) setError(signInError(result, provider.name));
  };
  const more = async () => {
    const choice = await showMenu([
      ...(provider.state === "unlocked" ? [{ id: "lock", title: "Lock", symbol: "lock" }] : []),
      { id: "refresh", title: "Refresh", symbol: "arrow.clockwise" },
      { separator: true },
      { id: "signOut", title: "Sign Out…", symbol: "rectangle.portrait.and.arrow.right" },
    ]);
    if (choice === "lock") await lockProvider(provider.id);
    if (choice === "refresh") await refreshProvider(provider.id);
    if (choice !== "signOut") return;
    const { confirmed } = await confirm({ title: `Sign out of ${provider.name}?`, message: "Ardia stops filling from it until you connect again.", confirmTitle: "Sign Out" });
    if (confirmed) await signOutProvider(provider.id);
  };
  const connected = provider.state === "unlocked" || provider.state === "locked";
  return (
    <Row
      icon={<BrandBadge provider={provider.id} box={VAULT_SETTINGS.brandTile} glyph={VAULT_SETTINGS.brandGlyph} solid />}
      title={provider.name}
      description={error || stateLine(provider)}
    >
      <Box row gap="s" center>
        {provider.state === "locked" ? <Button title={busy ? "Unlocking…" : "Unlock"} disabled={busy} onPress={() => void unlock()} /> : null}
        {connected ? (
          <Button variant="icon" icon="ellipsis.circle" size="l" tooltip="More" onPress={() => void more()} />
        ) : (
          <Button title="Connect…" onPress={() => showConnectSheet(provider.id)} />
        )}
      </Box>
    </Row>
  );
}

export function PasswordManagersSection() {
  const providers = useVaultProviders();
  const loaded = useVaultsLoaded();
  const saveTarget = useSettings((s) => s.vaultSaveTarget);
  const saveOffer = useSettings((s) => s.vaultSaveOffer);
  const lockAfter = useSettings((s) => s.vaultIdleLockMinutes);
  useEffect(() => void reloadProviders(), []);
  const savers = providers.filter((p) => p.capabilities.save);
  const targetOptions = [{ value: ASK, title: "Ask Each Time" }, ...savers.map((p) => ({ value: p.id, title: p.name }))];
  const target = savers.some((p) => p.id === saveTarget) ? saveTarget : ASK;
  return (
    <View>
      <SectionHeader anchor="passwords.managers" description={null} />
      <Group>
        {providers.length ? null : <Row title={loaded ? "No password managers" : "…"} />}
        {providers.map((p) => (
          <ProviderRow key={p.id} provider={p} />
        ))}
      </Group>
      <View style={GROUP_GAP}>
        <Group>
          <SettingToggle anchor="passwords.vaultSuggestOnFocus" />
          <SettingToggle anchor="passwords.vaultAskBeforeFilling" />
          <SettingToggle anchor="passwords.vaultLoadPasswordsWhenUsed" />
          <SettingToggle anchor="passwords.vaultMenuGlass" />
          <SettingToggle anchor="passwords.vaultSaveOffer" />
          {saveOffer ? <SettingToggle anchor="passwords.vaultAutoSave" /> : null}
          <Row anchor="passwords.vaultSaveTarget">
            <PopUp value={target} options={targetOptions} onChange={(v) => updateSettings({ vaultSaveTarget: v === ASK ? "" : v })} />
          </Row>
          <Row anchor="passwords.vaultIdleLockMinutes">
            <PopUp value={String(lockAfter)} options={LOCK_OPTIONS} onChange={(v) => updateSettings({ vaultIdleLockMinutes: Number(v) })} />
          </Row>
        </Group>
      </View>
    </View>
  );
}

const GROUP_GAP = { marginTop: space.l } as const;
