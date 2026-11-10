import { useEffect, useState } from "react";
import { View } from "react-native";
import { stageOfferPassword, type VaultPasswordDraft } from "../../state/vaults/savePassword";
import { Box, Button, Text, VaultPasswordField } from "../ui";
import { VAULT_SAVE } from "./tokens";

export function VaultSavePassword({
  tabId,
  origin,
  seq,
  onLength,
  onFocusInside,
  onSubmit,
  onEscape,
}: {
  tabId: string;
  origin: string;
  seq: number;
  onLength: (length: number) => void;
  onFocusInside?: () => void;
  onSubmit: () => void;
  onEscape: () => void;
}) {
  const [draft, setDraft] = useState<VaultPasswordDraft | null>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    let live = true;
    setDraft(null);
    void stageOfferPassword(tabId, origin).then((staged) => {
      if (!live) return;
      setDraft(staged);
      if (staged.token) onLength(staged.length);
    });
    return () => {
      live = false;
    };
  }, [tabId, origin, seq]);
  if (!draft?.token) return null;
  return (
    <View style={FIELD}>
      <Text size="caption" tone="textSecondary">
        Password
      </Text>
      <Box row gap="xs" center>
        <VaultPasswordField draft={draft.token} revealed={revealed} style={INPUT} onEdit={(next) => (onFocusInside?.(), onLength(next))} onSubmit={() => (onFocusInside?.(), onSubmit())} onEscape={() => (onFocusInside?.(), onEscape())} />
        <Button variant="icon" icon={revealed ? "eye.slash" : "eye"} size="m" tooltip={revealed ? "Hide Password" : "Show Password"} onPress={() => setRevealed(!revealed)} />
      </Box>
    </View>
  );
}

const FIELD = { gap: VAULT_SAVE.fieldGap } as const;
const INPUT = { flex: 1, height: VAULT_SAVE.passwordHeight } as const;
