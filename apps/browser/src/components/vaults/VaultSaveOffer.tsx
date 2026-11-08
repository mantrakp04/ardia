import { View } from "react-native";
import { showMenu } from "../../state/app/system";
import { brandOf } from "../../state/vaults/brands";
import { useVaultProviders, useVaultSaveOffer } from "../../state/vaults/hooks";
import { siteLabel } from "../../state/vaults/originMatch";
import { chooseVaultTarget, dismissVaultOffer, saveVaultOffer } from "../../state/vaults/saveOffer";
import { Favicon } from "../favicon/Favicon";
import { PromptBody } from "../site/Prompts";
import { usePromptInputGuard, Well } from "../site/PromptParts";
import { Box, Button, PanelCloseButton, Popover, POPOVER_WIDTH, PopoverValue, Text } from "../ui";
import { BrandBadge } from "./VaultParts";

export const VAULT_SAVE_OFFER_WIDTH = POPOVER_WIDTH.m;

export function VaultSaveOffer({ tabId, right, top }: { tabId: string; right: number; top: number }) {
  const offer = useVaultSaveOffer(tabId);
  const providers = useVaultProviders();
  const guard = usePromptInputGuard(offer?.seq);
  if (!offer) return null;
  const site = siteLabel(offer.origin);
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.name ?? brandOf(id).name;
  const target = nameOf(offer.target);
  const pickTarget = async () => {
    const choice = await showMenu(offer.targets.map((id) => ({ id, title: nameOf(id), checked: id === offer.target })));
    if (choice) chooseVaultTarget(tabId, choice);
  };
  return (
    <Popover key={offer.seq} width={VAULT_SAVE_OFFER_WIDTH} top={top} right={right} modal={false}>
      <View>
        <PromptBody
          icons={["key.fill"]}
          title={`Save password for ${site}?`}
          message={offer.targets.length > 1 ? null : `Saves to ${target}`}
          detail={
            <>
              <Well>
                <Box row gap="ml" center style={LEFT}>
                  <Favicon url={offer.origin} />
                  <View style={FILL}>
                    <Text lines={1} size="small" weight="medium">
                      {offer.username || "No username"}
                    </Text>
                    <Text lines={1} size="caption" tone="textSecondary">
                      {site}
                    </Text>
                  </View>
                  <BrandBadge provider={offer.target} tooltip={target} />
                </Box>
              </Well>
              {offer.targets.length > 1 ? (
                <Box row center style={BETWEEN}>
                  <Text size="small" tone="textSecondary">
                    Save To
                  </Text>
                  <PopoverValue title={target} onPress={guard(() => void pickTarget())} />
                </Box>
              ) : null}
              {offer.error ? (
                <Text size="caption" tone="destructive">
                  {offer.error}
                </Text>
              ) : null}
            </>
          }
        >
          <Button variant="pill" title="Not Now" onPress={guard(() => dismissVaultOffer(tabId))} />
          <Button variant="pill" title={offer.busy ? "Saving…" : "Save"} primary onPress={guard(() => void saveVaultOffer(tabId))} />
        </PromptBody>
        <PanelCloseButton onPress={guard(() => dismissVaultOffer(tabId))} />
      </View>
    </Popover>
  );
}

const FILL = { flex: 1, minWidth: 0 } as const;
const LEFT = { justifyContent: "flex-start" } as const;
const BETWEEN = { justifyContent: "space-between" } as const;
