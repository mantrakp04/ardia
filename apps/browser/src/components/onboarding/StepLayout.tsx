import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { activeSteps, previousStep, useOnboarding } from "../../state/onboarding/onboarding";
import { BackButton, PrimaryButton, SecondaryButton } from "./Buttons";
import { CONTENT_WIDTH } from "./ChoiceList";
import { Reveal, StepProgress, StepTitle, useOnboardingColors } from "./Parts";

const COLUMN = { width: CONTENT_WIDTH + 56, padding: 28 };

const NARROW = { below: 600, previewShare: 0.3, inset: 12, padding: 20 } as const;

export function StepLayout({
  title,
  subtitle,
  tag,
  pageKey,
  children,
  actions,
  preview,
}: {
  title: string;
  subtitle?: string;
  tag?: ReactNode;
  pageKey?: string | number;
  children?: ReactNode;
  actions: ReactNode;
  preview: ReactNode;
}) {
  const colors = useOnboardingColors();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const narrow = !!size && size.width < NARROW.below;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width < NARROW.below || size) setSize({ width, height });
  };
  const body = (
    <>
      <Reveal delay={60} style={{ gap: 10 }}>
        <StepTitle title={title} subtitle={subtitle} />
        {tag ? <View style={{ flexDirection: "row" }}>{tag}</View> : null}
      </Reveal>
      <Reveal delay={140} style={{ gap: 16, marginTop: 22 }}>
        {children}
      </Reveal>
    </>
  );
  const column = (
    <>
      <Reveal>
        <StepProgress />
      </Reveal>
      <ScrollView key={pageKey} style={{ flex: 1, marginTop: 20 }} showsVerticalScrollIndicator={false}>
        {body}
      </ScrollView>
      <Reveal delay={240} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 14 }}>
        {actions}
      </Reveal>
    </>
  );
  const pane = {
    borderRadius: 14,
    backgroundColor: colors.preview,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.previewBorder,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  } as const;
  if (narrow)
    return (
      <View style={{ flex: 1 }} onLayout={onLayout}>
        <View style={[pane, { height: Math.round(size.height * NARROW.previewShare), margin: NARROW.inset, marginBottom: 0 }]}>
          <Reveal delay={120} style={{ alignSelf: "stretch", flex: 1 }}>
            <FittedPreview>{preview}</FittedPreview>
          </Reveal>
        </View>
        <View style={{ flex: 1, padding: NARROW.padding }}>{column}</View>
      </View>
    );
  return (
    <View style={{ flex: 1, flexDirection: "row" }} onLayout={onLayout}>
      <View style={{ width: COLUMN.width, paddingTop: 34, paddingBottom: 28, paddingHorizontal: COLUMN.padding }}>{column}</View>
      <View style={[pane, { flex: 1, margin: 12, marginLeft: 0 }]}>
        <Reveal delay={120} style={{ alignItems: "center", justifyContent: "center" }}>
          {preview}
        </Reveal>
      </View>
    </View>
  );
}

function FittedPreview({ children }: { children: ReactNode }) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [content, setContent] = useState<{ width: number; height: number } | null>(null);
  const scale = box && content && content.width && content.height ? Math.min(1, box.width / content.width, box.height / content.height) : 1;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      <View style={{ alignItems: "center", justifyContent: "center", transform: [{ scale }] }} onLayout={(e) => setContent(e.nativeEvent.layout)}>
        {children}
      </View>
    </View>
  );
}

export function StepActions({
  onContinue,
  continueTitle = "Continue",
  disabled,
  onSkip,
  icon,
}: {
  onContinue: () => void;
  continueTitle?: string;
  disabled?: boolean;
  onSkip?: () => void;
  icon?: string;
}) {
  const step = useOnboarding((s) => s.step);
  const sub = useOnboarding((s) => s.sub);
  const back = previousStep;
  const steps = activeSteps();
  const first = steps[steps.indexOf(step) - 1] === "intro" && sub === 0;
  return (
    <>
      {first ? null : <BackButton onPress={back} />}
      <PrimaryButton title={continueTitle} icon={icon} onPress={onContinue} disabled={disabled} />
      {onSkip ? <SecondaryButton title="Skip" onPress={onSkip} /> : null}
    </>
  );
}
