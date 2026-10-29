import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import ICON from "../../browser/assets/app-icon.png";
import { HomeStep as SharedHomeStep } from "../../browser/src/components/onboarding/HomeStep";
import { GlassBacking, solidFill } from "../../browser/src/components/onboarding/GlassBacking";
import { CheckMark, CheckRow, useOnboardingColors } from "../../browser/src/components/onboarding/Parts";
import { StepActions, StepLayout } from "../../browser/src/components/onboarding/StepLayout";
import { Symbol } from "../../browser/src/components/ui";
import { font, weight } from "../../browser/src/components/ui/tokens";
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
      <View style={{ gap: 8 }}>
        {capabilities.defaultBrowser ? (
          <CheckRow
            icon="globe"
            title="Set Ardia as default browser"
            subtitle={system?.isDefault ? "Ardia is already your default browser" : "Open links and web pages in Ardia"}
            value={defaultOn}
            disabled={!system || system.isDefault}
            onChange={(v) => setOnboardingExtras(v ? { setDefault: true } : { setDefault: false, trial: true })}
          />
        ) : (
          <DefaultBrowserNote />
        )}
        {capabilities.defaultBrowser && system && !defaultOn ? (
          <CheckRow icon="calendar" title="Try it for seven days" subtitle="We'll check in to make sure you love it." value={trial} onChange={(v) => setOnboardingExtras({ trial: v })} />
        ) : null}
        {capabilities.launchAtLogin ? <CheckRow icon="power" title="Open Ardia at login" subtitle="Ready when you sign in" value={login} onChange={(v) => setOnboardingExtras({ login: v })} /> : null}
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

function SystemPreview({ capabilities, isDefault, login }: { capabilities: Pick<LinuxCapabilities, "defaultBrowser" | "launchAtLogin">; isDefault: boolean; login: boolean }) {
  const colors = useOnboardingColors();
  const chip = (on: boolean, icon: string, label: string) => (
    <View
      key={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 34,
        paddingLeft: 12,
        paddingRight: 10,
        borderRadius: 17,
        backgroundColor: solidFill(colors.row),
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.rowBorder,
        opacity: on ? 1 : 0.45,
      }}
    >
      <GlassBacking fill={colors.row} radius={17} border={StyleSheet.hairlineWidth * 2} />
      <Symbol name={icon} size={13} color={colors.title} style={{ width: 16, height: 16 }} />
      <Text style={{ ...font.small, fontWeight: weight.medium, color: colors.title }}>{label}</Text>
      <CheckMark on={on} size={16} />
    </View>
  );
  return (
    <View style={{ alignItems: "center", gap: 28 }}>
      <Image source={{ uri: ICON }} style={{ width: 132, height: 132 }} />
      <View style={{ gap: 8, alignItems: "center" }}>
        {capabilities.defaultBrowser ? chip(isDefault, "globe", "Default browser") : null}
        {capabilities.launchAtLogin ? chip(login, "power", "Opens at login") : null}
      </View>
    </View>
  );
}
