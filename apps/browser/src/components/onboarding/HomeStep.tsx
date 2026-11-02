import {
  addToDock,
  backgroundInstance,
  isDefaultBrowser,
  isInDock,
  launchAtLoginStatus,
  setAsDefaultBrowser,
  setLaunchAtLogin,
} from "../../state/app/appSettings";
import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { Checkbox, Symbol, Text } from "../ui";
import { capsule, space } from "../ui/tokens";
import { ChoiceCard } from "./ChoiceCard";
import { OptionCard } from "./OptionCard";
import { confirmAnswer, recordDefaultBrowserTrial, setOnboardingDraft, setOnboardingExtras, skipStep, useOnboarding } from "../../state/onboarding/onboarding";
import { ChoiceList, useMockFocus, type ChoiceOption } from "./ChoiceList";
import { useOnboardingColors } from "./Parts";
import { MockPanel, useScreen } from "./Screen";
import { StepActions, StepLayout } from "./StepLayout";

const ICON = require("../../../assets/app-icon.png");

type SystemState = { isDefault: boolean; inDock: boolean; loginEnabled: boolean };

const LINK_CHOICES: ChoiceOption<boolean>[] = [
  { value: true, preview: "links-little", title: "Little Ardia", subtitle: "A small window that's gone when you're done" },
  { value: false, preview: "links-tab", title: "A new tab", subtitle: "Right in your main window" },
];

export function HomeStep() {
  const sub = useOnboarding((s) => s.sub);
  return sub === 0 ? <DefaultBrowserQuestion /> : <LinksQuestion />;
}

function DefaultBrowserQuestion() {
  const extras = useOnboarding((s) => s.extras);
  const [system, setSystem] = useState<SystemState | null>(null);
  const [busy, setBusy] = useState(false);
  const setDefault = extras.setDefault ?? !backgroundInstance;
  const trial = extras.trial ?? false;
  const dock = extras.dock ?? true;
  const login = extras.login ?? system?.loginEnabled ?? false;
  const setExtras = setOnboardingExtras;

  useEffect(() => {
    void Promise.all([isDefaultBrowser(), isInDock(), launchAtLoginStatus()]).then(([isDefault, inDock, login]) =>
      setSystem({ isDefault, inDock, loginEnabled: login === "enabled" }),
    );
  }, []);

  const apply = async () => {
    if (!system) return;
    setBusy(true);
    const picked: string[] = [];
    try {
      if (!system.isDefault && (setDefault || trial) && (await setAsDefaultBrowser())) {
        if (!setDefault) recordDefaultBrowserTrial();
        picked.push(setDefault ? "Ardia is your default browser" : "A week as your default browser");
      }
      if (login !== system.loginEnabled) await setLaunchAtLogin(login).catch(() => {});
      if (dock && !system.inDock) await addToDock();
    } finally {
      setBusy(false);
      confirmAnswer("default", {}, picked);
    }
  };

  const defaultOn = system?.isDefault || setDefault;
  const trying = !defaultOn && trial;
  return (
    <StepLayout
      pageKey="default"
      title="Make Ardia your default?"
      subtitle="Links from everywhere open here."
      actions={
        <StepActions
          continueTitle={busy ? "Setting Up…" : "Continue"}
          disabled={!system || busy}
          onContinue={() => void apply()}
          onSkip={() => skipStep()}
        />
      }
      preview={<SystemPreview isDefault={!!(defaultOn || trying)} dock={!!(system?.inDock || dock)} login={login} />}
    >
      <View style={{ gap: space.m }}>
        <OptionCard
          control="check"
          icon="globe"
          title="Set Ardia as default browser"
          subtitle={system?.isDefault ? "Ardia is already your default browser" : "Open links and web pages in Ardia"}
          selected={!!defaultOn}
          disabled={!system || system.isDefault}
          onPress={() => setExtras(defaultOn ? { setDefault: false, trial: true } : { setDefault: true })}
        />
        {system && !defaultOn ? (
          <OptionCard control="check" icon="calendar" title="Try it for seven days" subtitle="We'll check in to make sure you love it." selected={trial} onPress={() => setExtras({ trial: !trial })} />
        ) : null}
        {system && !system.inDock ? (
          <OptionCard control="check" icon="dock.rectangle" title="Add Ardia to Dock" subtitle="Quick access whenever you need it" selected={dock} onPress={() => setExtras({ dock: !dock })} />
        ) : null}
        <OptionCard control="check" icon="power" title="Open Ardia at login" subtitle="Ready when you sign in" selected={login} onPress={() => setExtras({ login: !login })} />
      </View>
    </StepLayout>
  );
}

function LinksQuestion() {
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

const CHIP_HEIGHT = 34;

function SystemPreview({ isDefault, dock, login }: { isDefault: boolean; dock: boolean; login: boolean }) {
  const colors = useOnboardingColors();
  const chip = (on: boolean, icon: string, label: string) => (
    <ChoiceCard
      key={label}
      radius={capsule(CHIP_HEIGHT)}
      style={{ flexDirection: "row", alignItems: "center", gap: space.m, height: CHIP_HEIGHT, paddingLeft: space.l, paddingRight: space.ml, opacity: on ? 1 : 0.45 }}
    >
      <Symbol name={icon} size={13} color={colors.title} style={{ width: 16, height: 16 }} />
      <Text size="small" weight="medium" color={colors.title}>
        {label}
      </Text>
      <Checkbox look="ring" size="s" value={on} />
    </ChoiceCard>
  );
  return (
    <View style={{ alignItems: "center", gap: space.xxxl }}>
      <Image source={ICON} style={{ width: 132, height: 132 }} />
      <View style={{ gap: space.m, alignItems: "center" }}>
        {chip(isDefault, "globe", "Default browser")}
        {chip(dock, "dock.rectangle", "In your Dock")}
        {chip(login, "power", "Opens at login")}
      </View>
    </View>
  );
}
