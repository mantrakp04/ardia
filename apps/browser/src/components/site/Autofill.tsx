import { Text, View } from "react-native";
import type { CardNetwork } from "../../state/site/autofill";
import { ink, Symbol } from "../ui";
import { CARD_BADGES, cardBadgeType, MASTERCARD_RINGS } from "./tokens";

export function NetworkBadge({ network }: { network: CardNetwork }) {
  const badge = CARD_BADGES[network] ?? CARD_BADGES.card;
  return (
    <View style={{ width: 28, height: 19, borderRadius: 3.5, backgroundColor: badge.fill, alignItems: "center", justifyContent: "center", flexDirection: "row" }}>
      {network === "mastercard" ? (
        <>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: MASTERCARD_RINGS.left, marginRight: -3.5 }} />
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: MASTERCARD_RINGS.right, opacity: 0.9 }} />
        </>
      ) : badge.label ? (
        <Text
          style={{
            ...(badge.label.length > 3 ? cardBadgeType.long : cardBadgeType.short),
            fontWeight: cardBadgeType.weight,
            fontStyle: network === "visa" ? "italic" : "normal",
            color: ink.white,
            letterSpacing: cardBadgeType.letterSpacing,
          }}
        >
          {badge.label}
        </Text>
      ) : (
        <Symbol name="creditcard.fill" size={10} color={ink.white} style={{ width: 14, height: 12 }} />
      )}
    </View>
  );
}
