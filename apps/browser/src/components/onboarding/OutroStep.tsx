import { StyleSheet, View } from "react-native";
import { KeyCap, Symbol, Text } from "../ui";
import { lineHeight, proseLineHeight, space } from "../ui/tokens";
import { PostageStamp, PostcardPaper } from "../ntp/PostageStamp";
import { finishOnboarding, QUESTION_ORDER, useOnboarding } from "../../state/onboarding/onboarding";
import { SecondaryButton } from "./Buttons";
import { useOnboardingColors } from "./Parts";
import { StepActions, StepLayout } from "./StepLayout";
import { onboardingType } from "./tokens";

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
      <View style={{ gap: space.ml }}>
        {(
          [
            ["⌘T", "Open a new tab"],
            ["⌘L", "Go anywhere from the command bar"],
            ["⌘S", "Hide the sidebar for more room"],
          ] as const
        ).map(([keys, label]) => (
          <View key={keys} style={{ flexDirection: "row", alignItems: "center", gap: space.l }}>
            <KeyCap keys={[keys]} />
            <Text color={colors.subtitle}>{label}</Text>
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
    <PostcardPaper
      fill={colors.card}
      border={colors.rowBorder}
      borderWidth={StyleSheet.hairlineWidth * 2}
      style={{ width: 340, minHeight: 210, padding: space.xl, flexDirection: "row", transform: [{ rotate: "-3deg" }] }}
    >
      <View style={{ flex: 1, gap: space.ml, paddingRight: space.xl }}>
        <Text color={colors.title} style={onboardingType.postcardHello}>
          Hello!
        </Text>
        {shown.length ? (
          <View style={{ gap: space.xs }}>
            <Text size="caption" color={colors.subtitle} style={CAPTION_LINE}>
              {"You picked:"}
            </Text>
            {shown.map((line) => (
              <View key={line} style={{ flexDirection: "row", gap: space.s, alignItems: "flex-start" }}>
                <Symbol name="checkmark" size={8} weight="bold" color={colors.title} style={{ width: 10, height: lineHeight.caption }} />
                <Text size="caption" color={colors.title} style={PICKED_LINE}>
                  {line}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text size="small" color={colors.subtitle} style={GREETING}>
            {"Glad you're here. Make yourself at home. Your tabs, bookmarks and pins are ready."}
          </Text>
        )}
      </View>
      <View style={{ width: StyleSheet.hairlineWidth * 2, backgroundColor: colors.separator }} />
      <View style={{ width: 96, paddingLeft: space.xl, justifyContent: "space-between", alignItems: "flex-end" }}>
        <PostageStamp icon={WELCOME_STAMP.icon} ring={WELCOME_STAMP.ring} label="WELCOME" tilt={WELCOME_STAMP.tilt} ink={{ frame: colors.rowBorder, ring: colors.steps, label: colors.steps }} ringAt={WELCOME_STAMP.ringAt} />
        <View style={{ alignSelf: "stretch", gap: space.l }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ height: 1, backgroundColor: colors.separator }} />
          ))}
        </View>
      </View>
    </PostcardPaper>
  );
}

const WELCOME_STAMP = { icon: 46, ring: 44, tilt: -12, ringAt: { right: 32, top: 34 } } as const;
const CAPTION_LINE = { lineHeight: lineHeight.caption } as const;
const PICKED_LINE = { flex: 1, lineHeight: lineHeight.caption } as const;
const GREETING = { lineHeight: proseLineHeight.small } as const;
