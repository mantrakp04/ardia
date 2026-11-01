import { useEffect, useMemo, useState } from "react";
import { finishOnboarding } from "../../state/onboarding/onboarding";
import { copySetupCode, onboardingSetupCode } from "../../state/presets/actions";
import { StepActions, StepLayout } from "./StepLayout";
import { SecondaryButton } from "./Buttons";
import { useOnboardingColors } from "./Parts";
import { MONO } from "./tokens";
import { Text } from "../ui";
import { proseLineHeight, radius, space } from "../ui/tokens";
import { ChoiceCard } from "./ChoiceCard";
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
      <ChoiceCard dashed radius={radius.panel} style={{ paddingVertical: space.xl, paddingHorizontal: space.xl }}>
        <Text selectable accessibilityLabel={`Setup code ${code}`} color={colors.title} style={{ fontFamily: MONO, lineHeight: proseLineHeight.body }}>
          {code}
        </Text>
      </ChoiceCard>
      <Text size="small" color={colors.rowSubtitle} style={{ lineHeight: proseLineHeight.small }}>
        It holds your layout, look and pinned apps. Search and privacy you pick in Ardia itself.
      </Text>
    </StepLayout>
  );
}
