import { confirmAnswer, setOnboardingDraft, skipStep } from "../../state/onboarding/onboarding";
import { ChoiceList, useMockFocus, type ChoiceOption } from "./ChoiceList";
import { MockPanel, useScreen } from "./Screen";
import { StepActions, StepLayout } from "./StepLayout";

const LINK_CHOICES: ChoiceOption<boolean>[] = [
  { value: true, preview: "links-little", title: "Little Ardia", subtitle: "A small window that's gone when you're done" },
  { value: false, preview: "links-tab", title: "A new tab", subtitle: "Right in your main window" },
];

export function HomeStep() {
  const { values, mock } = useScreen(["openLinksInLittleArdia"]);
  const focus = useMockFocus("links");
  const little = values.openLinksInLittleArdia;
  return (
    <StepLayout
      pageKey="links"
      title="Where do links from other apps open?"
      subtitle="From Mail, Slack, Notes and the rest."
      actions={
        <StepActions
          onContinue={() =>
            confirmAnswer("links", { openLinksInLittleArdia: little }, [little ? "Links from other apps open in Little Ardia" : "Links from other apps open in a tab"])
          }
          onSkip={() => skipStep()}
        />
      }
      preview={<MockPanel settings={mock} focus={focus.focus} />}
    >
      <ChoiceList options={LINK_CHOICES} value={little} onChange={(v) => setOnboardingDraft({ openLinksInLittleArdia: v })} mock={focus} />
    </StepLayout>
  );
}
