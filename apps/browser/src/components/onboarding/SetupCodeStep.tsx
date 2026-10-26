import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useHover } from "../ui";
import { goToStep } from "../../state/onboarding/onboarding";
import { applySetupCodeInOnboarding } from "../../state/presets/actions";
import { SETUP_CODE_PREFIX } from "../../state/presets/setupCode";
import { StepLayout } from "./StepLayout";
import { BackButton, PrimaryButton, SecondaryButton } from "./Buttons";
import { useOnboardingColors } from "./Parts";
import { MONO } from "./tokens";
import { font } from "../ui/tokens";
import { SetupLines } from "./SetupLines";

const BRINGS = ["Where your tabs and address bar go", "What ⌘T and ⌘L open", "Light or dark, and your color", "The apps you pinned"];

export function SetupCodeLink({ onPress }: { onPress: () => void }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ marginLeft: "auto" }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Have a setup code from ardia.dev?">
        <View mouseDownCanMoveWindow={false} style={{ height: 36, justifyContent: "center" }}>
          <Text style={{ ...font.small, color: hovered ? colors.title : colors.subtitle, textDecorationLine: hovered ? "underline" : "none" }}>Have a setup code?</Text>
        </View>
      </Pressable>
    </View>
  );
}

export function SetupCodeStep({ onBack }: { onBack: () => void }) {
  const colors = useOnboardingColors();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[] | null>(null);

  const apply = () => {
    const result = applySetupCodeInOnboarding(code);
    if (result.ok) setApplied(result.lines);
    else setError(result.error);
  };

  if (applied)
    return (
      <StepLayout
        pageKey="setupCodeApplied"
        title="You're set up"
        subtitle="Ardia now looks the way you made it on ardia.dev. Search and privacy are still yours to choose, so those come next."
        actions={
          <>
            <PrimaryButton title="Continue" icon="arrow.right" onPress={() => goToStep("searchPrivacy")} />
            <SecondaryButton title="Review Each Step" onPress={() => goToStep("layout")} />
          </>
        }
        preview={<SetupLines heading="From your code:" lines={applied} />}
      />
    );

  return (
    <StepLayout
      pageKey="setupCode"
      title="Have a setup code from ardia.dev?"
      subtitle="Paste the code from the demo. It brings the layout, look and pinned apps you picked there."
      actions={
        <>
          <BackButton onPress={onBack} />
          <PrimaryButton title="Apply Code" disabled={!code.trim()} onPress={apply} />
        </>
      }
      preview={<SetupLines heading="A code brings over:" lines={BRINGS} />}
    >
      <View
        style={{
          height: 44,
          paddingHorizontal: 14,
          borderRadius: 12,
          justifyContent: "center",
          backgroundColor: colors.row,
          borderWidth: error ? 1.5 : StyleSheet.hairlineWidth * 2,
          borderColor: error ? colors.title : colors.rowBorder,
        }}
      >
        <TextInput
          value={code}
          onChangeText={(text) => {
            setCode(text);
            setError(null);
          }}
          onSubmitEditing={() => code.trim() && apply()}
          placeholder={`${SETUP_CODE_PREFIX}…`}
          placeholderTextColor={colors.steps}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          enableFocusRing={false}
          accessibilityLabel="Setup code"
          style={{ fontFamily: MONO, ...font.body, color: colors.title, paddingVertical: 0 }}
        />
      </View>
      <Text style={{ ...font.small, lineHeight: 17, color: error ? colors.title : colors.rowSubtitle }}>
        {error ?? "Search, privacy and default browser stay yours to pick here."}
      </Text>
    </StepLayout>
  );
}
