import { Image, StyleSheet, Text, View } from "react-native";
import { Symbol } from "../ui";
import { font, weight } from "../ui/tokens";
import { finishOnboarding, QUESTION_ORDER, useOnboarding } from "../../state/onboarding/onboarding";
import { SecondaryButton } from "./Buttons";
import { useOnboardingColors } from "./Parts";
import { StepActions, StepLayout } from "./StepLayout";
import { onboardingType } from "./tokens";

const ICON = require("../../../assets/app-icon.png");

export function OutroStep() {
  const colors = useOnboardingColors();
  const picked = useOnboarding((s) => s.picked);
  const lines = QUESTION_ORDER.flatMap((q) => picked[q] ?? []);
  return (
    <StepLayout
      title={"Welcome to your new\nhome on the internet"}
      subtitle="Everything you set up is saved. Change any of it later in Settings."
      actions={
        <>
          <StepActions icon="arrow.right" continueTitle="Get Started" onContinue={() => finishOnboarding()} />
          <SecondaryButton title="Take the Tour" onPress={() => finishOnboarding({ tour: true })} />
        </>
      }
      preview={<Postcard lines={lines} />}
    >
      <View style={{ gap: 10 }}>
        {[
          ["⌘T", "Open a new tab"],
          ["⌘L", "Go anywhere from the command bar"],
          ["⌘S", "Hide the sidebar for more room"],
        ].map(([keys, label]) => (
          <View key={keys} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ minWidth: 38, height: 24, paddingHorizontal: 7, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.button }}>
              <Text style={{ ...font.small, fontWeight: weight.medium, color: colors.title }}>{keys}</Text>
            </View>
            <Text style={{ ...font.body, color: colors.subtitle }}>{label}</Text>
          </View>
        ))}
      </View>
    </StepLayout>
  );
}

function Postcard({ lines }: { lines: string[] }) {
  const colors = useOnboardingColors();
  const shown = lines.slice(0, 8);
  return (
    <View
      style={{
        width: 340,
        minHeight: 210,
        borderRadius: 6,
        padding: 18,
        flexDirection: "row",
        backgroundColor: colors.card,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.rowBorder,
        transform: [{ rotate: "-3deg" }],
      }}
    >
      <View style={{ flex: 1, gap: 10, paddingRight: 14 }}>
        <Text style={{ ...onboardingType.postcardHello, color: colors.title }}>Hello!</Text>
        {shown.length ? (
          <View style={{ gap: 4 }}>
            <Text style={{ ...font.caption, lineHeight: 15, color: colors.subtitle }}>{"You picked:"}</Text>
            {shown.map((line) => (
              <View key={line} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                <Symbol name="checkmark" size={8} weight="bold" color={colors.title} style={{ width: 10, height: 15 }} />
                <Text style={{ flex: 1, ...font.caption, lineHeight: 15, color: colors.title }}>{line}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ ...font.small, lineHeight: 17, color: colors.subtitle }}>
            {"Glad you're here. Make yourself at home. Your tabs, bookmarks and pins are ready."}
          </Text>
        )}
      </View>
      <View style={{ width: StyleSheet.hairlineWidth * 2, backgroundColor: colors.separator }} />
      <View style={{ width: 96, paddingLeft: 14, justifyContent: "space-between", alignItems: "flex-end" }}>
        <View style={{ padding: 4, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.rowBorder, borderRadius: 3 }}>
          <Image source={ICON} style={{ width: 46, height: 46 }} />
        </View>
        <View style={{ alignSelf: "stretch", gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ height: 1, backgroundColor: colors.separator }} />
          ))}
        </View>
      </View>
      <View
        style={{
          position: "absolute",
          right: 50,
          top: 52,
          width: 44,
          height: 44,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: colors.steps,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ rotate: "-12deg" }],
        }}
      >
        <Text numberOfLines={1} style={{ ...onboardingType.stamp, color: colors.steps }}>
          WELCOME
        </Text>
      </View>
    </View>
  );
}
