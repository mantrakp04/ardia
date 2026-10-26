import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { finishOnboarding } from "../../state/onboarding/onboarding";
import { copySetupCode, onboardingSetupCode } from "../../state/presets/actions";
import { StepActions, StepLayout } from "./StepLayout";
import { SecondaryButton } from "./Buttons";
import { useOnboardingColors } from "./Parts";
import { MONO } from "./tokens";
import { font } from "../ui/tokens";
import { SetupLines } from "./SetupLines";

const COPIED_FOR_MS = 1800;

export function SetupCodeOutro() {
  const colors = useOnboardingColors();
  const { code, lines } = useMemo(onboardingSetupCode, []);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    copySetupCode(code);
    setCopied(true);
  };

  return (
    <StepLayout
      title="Your setup code"
      subtitle="Paste it into Ardia after you download it, on its first screen or in Settings › General. Ardia sets itself up just like this."
      actions={
        <>
          <StepActions icon="arrow.right" continueTitle="Done" onContinue={() => finishOnboarding()} />
          <SecondaryButton title={copied ? "Copied" : "Copy Code"} filled onPress={copy} />
        </>
      }
      preview={<SetupLines heading="You picked:" lines={lines} />}
    >
      <View
        style={{
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderRadius: 12,
          backgroundColor: colors.row,
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: colors.rowBorder,
        }}
      >
        <Text selectable accessibilityLabel={`Setup code ${code}`} style={{ fontFamily: MONO, ...font.body, lineHeight: 19, color: colors.title }}>
          {code}
        </Text>
      </View>
      <Text style={{ ...font.small, lineHeight: 17, color: colors.rowSubtitle }}>
        It holds your layout, look and pinned apps. Search and privacy you pick in Ardia itself.
      </Text>
    </StepLayout>
  );
}
