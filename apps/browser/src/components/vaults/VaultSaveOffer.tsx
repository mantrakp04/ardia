import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { showMenu } from "../../state/app/system";
import { brandOf } from "../../state/vaults/brands";
import { useVaultLogins, useVaultProviders, useVaultSaveOffer } from "../../state/vaults/hooks";
import { siteLabel } from "../../state/vaults/originMatch";
import { passwordLetsSave } from "../../state/vaults/savePassword";
import { prefilledUsername, useRankedUsernames } from "../../state/vaults/usernameSuggestions";
import { canSaveVaultOffer, chooseVaultTarget, dismissVaultOffer, editVaultOfferUsername, saveVaultOffer, setVaultOfferUsername } from "../../state/vaults/saveOffer";
import { webviews } from "../../state/tabs/webviewHandles";
import { Favicon } from "../favicon/Favicon";
import { PromptBody } from "../site/Prompts";
import { usePromptInputGuard, Well } from "../site/PromptParts";
import { Box, Button, Expand, opacity, PanelCloseButton, Popover, POPOVER_WIDTH, PopoverValue, space, Text, usePopoverPresence } from "../ui";
import { BrandBadge } from "./VaultParts";
import { VaultSavePassword } from "./VaultSavePassword";
import { VaultUsernameField } from "./VaultUsernameField";

export const VAULT_SAVE_OFFER_WIDTH = POPOVER_WIDTH.m;

export function VaultSaveOffer({ tabId, right, top }: { tabId: string; right: number; top: number }) {
  const live = useVaultSaveOffer(tabId);
  const last = useRef(live);
  if (live) last.current = live;
  const presence = usePopoverPresence(!!live);
  const offer = live ?? (presence.shown ? last.current : null);
  const providers = useVaultProviders();
  const guard = usePromptInputGuard(offer?.seq);
  const ranked = useRankedUsernames(useVaultLogins(), true);
  const [password, setPassword] = useState<{ seq: number; length: number } | null>(null);
  const editing = !!offer?.editing;
  const focusedInside = useRef(false);
  if (editing) focusedInside.current = true;
  const closed = () => {
    presence.onClosed();
    if (!focusedInside.current) return;
    focusedInside.current = false;
    void webviews.get(tabId)?.focus();
  };
  useEffect(() => {
    if (!offer || !editing || offer.username.trim()) return;
    const best = prefilledUsername(offer.username, ranked);
    if (best) setVaultOfferUsername(tabId, best);
  }, [offer?.seq, editing]);
  if (!offer) return null;
  const site = siteLabel(offer.origin);
  const length = password?.seq === offer.seq ? password.length : null;
  const ready = canSaveVaultOffer(offer) && passwordLetsSave(length);
  const save = () => ready && void saveVaultOffer(tabId);
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.name ?? brandOf(id).name;
  const target = nameOf(offer.target);
  const pickTarget = async () => {
    const choice = await showMenu(offer.targets.map((id) => ({ id, title: nameOf(id), checked: id === offer.target })));
    if (choice) chooseVaultTarget(tabId, choice);
  };
  return (
    <Popover key={offer.seq} width={VAULT_SAVE_OFFER_WIDTH} top={top} right={right} modal={false} closing={!live} onClosed={closed}>
      <View>
        <PromptBody
          icons={["key.fill"]}
          title={`Save Password for ${site}?`}
          message={offer.targets.length > 1 ? null : `Saves to ${target}`}
          detail={
            <>
              {offer.editing ? (
                <VaultUsernameField
                  value={offer.username}
                  ranked={ranked}
                  onChange={(text) => setVaultOfferUsername(tabId, text)}
                  autoFocus
                  onSubmit={save}
                  onEscape={() => dismissVaultOffer(tabId)}
                />
              ) : (
                <Well>
                  <Box row gap="ml" center style={LEFT}>
                    <Favicon url={offer.origin} />
                    <Pressable style={FILL} onPress={guard(() => editVaultOfferUsername(tabId))}>
                      <View tooltip="Edit Username">
                        <Text lines={1} size="small" weight="medium">
                          {offer.username || "No Username"}
                        </Text>
                        <Text lines={1} size="caption" tone="textSecondary">
                          {site}
                        </Text>
                      </View>
                    </Pressable>
                    <BrandBadge provider={offer.target} tooltip={target} />
                  </Box>
                </Well>
              )}
              <VaultSavePassword
                tabId={tabId}
                origin={offer.origin}
                seq={offer.seq}
                onLength={(next) => setPassword({ seq: offer.seq, length: next })}
                onFocusInside={() => (focusedInside.current = true)}
                onSubmit={save}
                onEscape={() => dismissVaultOffer(tabId)}
              />
              {offer.targets.length > 1 ? (
                <Box row center style={BETWEEN}>
                  <Text size="small" tone="textSecondary">
                    Save To
                  </Text>
                  <PopoverValue title={target} onPress={guard(() => void pickTarget())} />
                </Box>
              ) : null}
              <Expand open={!!offer.error} gap={space.ml}>
                <Text size="caption" tone="destructive">
                  {offer.error}
                </Text>
              </Expand>
            </>
          }
        >
          <Button variant="pill" title="Not Now" onPress={guard(() => dismissVaultOffer(tabId))} />
          <View pointerEvents={ready ? "auto" : "none"} style={ready || offer.busy ? undefined : DIMMED}>
            <Button variant="pill" title={offer.busy ? "Saving…" : "Save"} reserve={SAVE_TITLES} primary onPress={guard(() => void saveVaultOffer(tabId))} />
          </View>
        </PromptBody>
        <PanelCloseButton onPress={guard(() => dismissVaultOffer(tabId))} />
      </View>
    </Popover>
  );
}

const FILL = { flex: 1, minWidth: 0 } as const;
const LEFT = { justifyContent: "flex-start" } as const;
const BETWEEN = { justifyContent: "space-between" } as const;
const DIMMED = { opacity: opacity.disabled } as const;
const SAVE_TITLES = ["Save", "Saving…"] as const;
