import { View } from "react-native";
import { acceptEngineOffer, stayOnPage, useEngineOffers } from "../../lib/engines";
import { PanelCloseButton, Popover, PromptButton } from "../layout/controls";
import { PromptBody } from "./Prompts";

export function EngineOfferPrompt({ tabId, left, top }: { tabId: string; left: number; top: number }) {
  const offer = useEngineOffers((offers) => offers[tabId]);
  if (!offer) return null;
  return (
    <Popover key={offer.site} width={320} top={top} left={left} modal={false}>
      <View>
        <PromptBody
          icons={["play.circle.fill", "safari"]}
          title={`Play ${offer.host} in WebKit?`}
          message="This site plays protected video, which Chromium in Ardia can't. The page reloads in WebKit, which keeps its own sign-ins."
        >
          <PromptButton title="Stay on Page" onPress={() => stayOnPage(tabId)} />
          <PromptButton title="Open in WebKit" primary onPress={() => void acceptEngineOffer(tabId)} />
        </PromptBody>
        <PanelCloseButton onPress={() => stayOnPage(tabId)} />
      </View>
    </Popover>
  );
}
