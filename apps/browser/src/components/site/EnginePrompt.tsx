import { useState } from "react";
import { View } from "react-native";
import { acceptEngineOffer, stayOnPage, useEngineOffers, type EngineOffer } from "../../state/engines/actions";
import { Button, PanelCloseButton, Popover } from "../ui";
import { CheckRow } from "./PromptParts";
import { PromptBody } from "./Prompts";

export const ENGINE_OFFER_WIDTH = 320;

export function EngineOfferPrompt({ tabId, left, top }: { tabId: string; left: number; top: number }) {
  const offer = useEngineOffers((offers) => offers[tabId]);
  return offer ? <OfferPopover key={offer.site} tabId={tabId} offer={offer} left={left} top={top} /> : null;
}

function OfferPopover({ tabId, offer, left, top }: { tabId: string; offer: EngineOffer; left: number; top: number }) {
  const [remember, setRemember] = useState(false);
  return (
    <Popover width={ENGINE_OFFER_WIDTH} top={top} left={left} modal={false}>
      <View>
        <PromptBody
          icons={["play.circle.fill", "safari"]}
          title={`Play ${offer.host} in WebKit?`}
          message="This site plays protected video, which Chromium in Ardia can't. The page reloads in WebKit, which keeps its own sign-ins."
          detail={
            offer.canRemember ? <CheckRow value={remember} onChange={setRemember} label="Don't ask again for this site" /> : undefined
          }
        >
          <Button variant="pill" title="Stay on Page" onPress={() => stayOnPage(tabId, remember)} />
          <Button variant="pill" title="Open in WebKit" primary onPress={() => void acceptEngineOffer(tabId)} />
        </PromptBody>
        <PanelCloseButton onPress={() => stayOnPage(tabId)} />
      </View>
    </Popover>
  );
}
