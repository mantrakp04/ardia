import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import ICON from "../../browser/assets/app-icon.png";
import { HomeStep as SharedHomeStep } from "../../browser/src/components/onboarding/HomeStep";
import { ChoiceCard } from "../../browser/src/components/onboarding/ChoiceCard";
import { OptionCard } from "../../browser/src/components/onboarding/OptionCard";
import { useOnboardingColors } from "../../browser/src/components/onboarding/Parts";
import { StepActions, StepLayout } from "../../browser/src/components/onboarding/StepLayout";
import { Checkbox, Symbol, Text as UIText } from "../../browser/src/components/ui";
import { capsule, font, space } from "../../browser/src/components/ui/tokens";
import { backgroundInstance, isDefaultBrowser, launchAtLoginStatus, setAsDefaultBrowser, setLaunchAtLogin } from "../../browser/src/state/app/appSettings";
import { confirmAnswer, recordDefaultBrowserTrial, setOnboardingExtras, skipStep, useOnboarding } from "../../browser/src/state/onboarding/onboarding";
import { linuxCapabilities, type LinuxCapabilities } from "./hostCapabilities";
import { DEFAULT_BROWSER_ELSEWHERE, readOnboardingSystem, type OnboardingSystem } from "./onboardingSystem";

export function HomeStep() {
  const sub = useOnboarding((s) => s.sub);
  return sub === 0 ? <DefaultBrowserQuestion /> : <SharedHomeStep />;
}

function DefaultBrowserQuestion() {
  const [capabilities] = useState(() => linuxCapabilities());
  const extras = useOnboarding((s) => s.extras);
  const [system, setSystem] = useState<OnboardingSystem | null>(null);
  const [busy, setBusy] = useState(false);
  const setDefault = capabilities.defaultBrowser && (extras.setDefault ?? !backgroundInstance);
  const trial = capabilities.defaultBrowser && (extras.trial ?? false);
  const login = capabilities.launchAtLogin && (extras.login ?? system?.loginEnabled ?? false);

  useEffect(() => {
    let live = true;
    void readOnboardingSystem(capabilities, { isDefaultBrowser, launchAtLoginStatus }).then((state) => live && setSystem(state));
    return () => {
      live = false;
    };
  }, [capabilities]);

  const apply = async () => {
    if (!system) return;
    setBusy(true);
    const picked: string[] = [];
    try {
      if (!system.isDefault && (setDefault || trial) && (await setAsDefaultBrowser().catch(() => false))) {
        if (!setDefault) recordDefaultBrowserTrial();
        picked.push(setDefault ? "Ardia is your default browser" : "A week as your default browser");
      }
      if (capabilities.launchAtLogin && login !== system.loginEnabled) await setLaunchAtLogin(login).catch(() => {});
    } finally {
      setBusy(false);
      confirmAnswer("default", {}, picked);
    }
  };

  const defaultOn = !!system?.isDefault || setDefault;
  const trying = !defaultOn && trial;
  return (
    <StepLayout
      pageKey="default"
      title="Make Ardia your default?"
      subtitle="Links from everywhere open here."
      actions={<StepActions continueTitle={busy ? "Setting Up…" : "Continue"} disabled={!system || busy} onContinue={() => void apply()} onSkip={() => skipStep()} />}
      preview={<SystemPreview capabilities={capabilities} isDefault={defaultOn || trying} login={login} />}
    >
      <View style={{ gap: space.m }}>
        {capabilities.defaultBrowser ? (
          <OptionCard
            control="check"
            icon="globe"
            title="Set Ardia as default browser"
            subtitle={system?.isDefault ? "Ardia is already your default browser" : "Open links and web pages in Ardia"}
            selected={defaultOn}
            disabled={!system || system.isDefault}
            onPress={() => setOnboardingExtras(defaultOn ? { setDefault: false, trial: true } : { setDefault: true })}
          />
        ) : (
          <DefaultBrowserNote />
        )}
        {capabilities.defaultBrowser && system && !defaultOn ? (
          <OptionCard control="check" icon="calendar" title="Try it for seven days" subtitle="We'll check in to make sure you love it." selected={trial} onPress={() => setOnboardingExtras({ trial: !trial })} />
        ) : null}
        {capabilities.launchAtLogin ? <OptionCard control="check" icon="power" title="Open Ardia at login" subtitle="Ready when you sign in" selected={login} onPress={() => setOnboardingExtras({ login: !login })} /> : null}
      </View>
    </StepLayout>
  );
}

function DefaultBrowserNote() {
  const colors = useOnboardingColors();
  return (
    <View accessibilityRole="text" style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingHorizontal: 4 }}>
      <Symbol name="globe" size={13} color={colors.title} style={{ width: 18, height: 18 }} />
      <Text style={{ ...font.body, color: colors.title, flex: 1 }}>{DEFAULT_BROWSER_ELSEWHERE}</Text>
    </View>
  );
}

const CHIP_HEIGHT = 34;

function SystemPreview({ capabilities, isDefault, login }: { capabilities: Pick<LinuxCapabilities, "defaultBrowser" | "launchAtLogin">; isDefault: boolean; login: boolean }) {
  const colors = useOnboardingColors();
  const chip = (on: boolean, icon: string, label: string) => (
    <ChoiceCard
      key={label}
      radius={capsule(CHIP_HEIGHT)}
      style={{ flexDirection: "row", alignItems: "center", gap: space.m, height: CHIP_HEIGHT, paddingLeft: space.l, paddingRight: space.ml, opacity: on ? 1 : 0.45 }}
    >
      <Symbol name={icon} size={13} color={colors.title} style={{ width: 16, height: 16 }} />
      <UIText size="small" weight="medium" color={colors.title}>
        {label}
      </UIText>
      <Checkbox look="ring" size="s" value={on} />
    </ChoiceCard>
  );
  return (
    <View style={{ alignItems: "center", gap: space.xxxl }}>
      <Image source={{ uri: ICON }} style={{ width: 132, height: 132 }} />
      <View style={{ gap: space.m, alignItems: "center" }}>
        {capabilities.defaultBrowser ? chip(isDefault, "globe", "Default browser") : null}
        {capabilities.launchAtLogin ? chip(login, "power", "Opens at login") : null}
      </View>
    </View>
  );
}
