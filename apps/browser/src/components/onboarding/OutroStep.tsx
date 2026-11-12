import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { addToDock, backgroundInstance, isDefaultBrowser, isInDock, setAsDefaultBrowser } from "../../state/app/appSettings";
import { isSharing, setSharing } from "../../state/telemetry/client";
import { SHARING_COPY } from "../../state/telemetry/copy";
import { PLATFORM_FEATURES } from "../../lib/platformFeatures";
import { Button, Symbol, Text } from "../ui";
import { lineHeight, proseLineHeight, space } from "../ui/tokens";
import { PostageStamp, PostcardPaper } from "../ntp/PostageStamp";
import { customizeMore, finishOnboarding, QUESTION_ORDER, recordDefaultBrowserTrial, setOnboardingExtras, useOnboarding } from "../../state/onboarding/onboarding";
import { SecondaryButton } from "./Buttons";
import { OptionCard } from "./OptionCard";
import { useOnboardingColors } from "./Parts";
import { Receipt } from "./PrivacyStep";
import { StepActions, StepLayout } from "./StepLayout";
import { onboardingType } from "./tokens";

type SystemState = { isDefault: boolean; inDock: boolean };

export function OutroStep() {
  const colors = useOnboardingColors();
  const picked = useOnboarding((s) => s.picked);
  const redo = useOnboarding((s) => s.redo);
  const customizing = useOnboarding((s) => s.customizing);
  const extras = useOnboarding((s) => s.extras);
  const [system, setSystem] = useState<SystemState | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const lines = QUESTION_ORDER.flatMap((q) => picked[q] ?? []);
  const setDefault = extras.setDefault ?? !backgroundInstance;
  const trial = !redo && (extras.trial ?? false);
  const dock = PLATFORM_FEATURES.dock && (extras.dock ?? true);
  const share = extras.share ?? isSharing();

  useEffect(() => {
    void Promise.all([isDefaultBrowser(), isInDock()]).then(([isDefault, inDock]) => setSystem({ isDefault, inDock }));
  }, []);

  const finish = async (tour: boolean) => {
    if (!system) return;
    setBusy(true);
    try {
      if (!system.isDefault && (setDefault || trial) && (await setAsDefaultBrowser()) && !setDefault) recordDefaultBrowserTrial();
      if (dock && !system.inDock) await addToDock();
    } finally {
      if (share !== isSharing() || !redo) setSharing(share, redo ? "settings" : "onboarding");
      setBusy(false);
      finishOnboarding({ tour });
    }
  };

  const defaultOn = !!system?.isDefault || setDefault;
  return (
    <StepLayout
      title={redo ? "All set" : "Welcome to your new\nhome on the internet"}
      subtitle="Everything else is set up for you. Change any of it later in Settings."
      actions={
        <>
          <StepActions icon="arrow.right" continueTitle={busy ? "Setting Up…" : redo ? "Done" : "Get Started"} disabled={!system || busy} onContinue={() => void finish(false)} />
          {redo ? null : <SecondaryButton title="Take the Tour" onPress={() => void finish(true)} />}
        </>
      }
      footer={customizing ? null : <CustomizeMoreLink />}
      preview={receipt ? <Receipt on={share} /> : <Postcard lines={lines} />}
    >
      <View style={{ gap: space.m }}>
        <OptionCard
          control="check"
          icon="globe"
          title={system?.isDefault ? "Ardia is your default browser" : "Make Ardia your default browser"}
          subtitle="Links from everywhere open here"
          selected={defaultOn}
          disabled={!system || system.isDefault}
          onPress={() => setOnboardingExtras(defaultOn ? { setDefault: false } : { setDefault: true, trial: false })}
        />
        {system && !defaultOn && !redo ? (
          <OptionCard control="check" icon="calendar" title="Try it for seven days" subtitle="We'll check in to make sure you love it." selected={trial} onPress={() => setOnboardingExtras({ trial: !trial })} />
        ) : null}
        {PLATFORM_FEATURES.dock && system && !system.inDock ? (
          <OptionCard control="check" icon="dock.rectangle" title="Keep Ardia in the Dock" subtitle="Quick access whenever you need it" selected={dock} onPress={() => setOnboardingExtras({ dock: !dock })} />
        ) : null}
        <OptionCard
          control="check"
          icon="stethoscope"
          title={SHARING_COPY.toggle}
          subtitle={SHARING_COPY.onboarding.row}
          selected={share}
          onHover={setReceipt}
          onPress={() => setOnboardingExtras({ share: !share })}
        />
        <Text size="small" color={colors.rowSubtitle} style={NOTE}>
          {`Off unless you turn it on. ${SHARING_COPY.dailyCountShort}`}
        </Text>
      </View>
    </StepLayout>
  );
}

export function CustomizeMoreLink() {
  return (
    <View mouseDownCanMoveWindow={false} style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <Text size="small" color={useOnboardingColors().rowSubtitle}>
        Tabs, search, pinned apps and more:
      </Text>
      <Button variant="text" look="link" tone="textSecondary" title="Customize more…" label="Customize tabs, search, pinned apps and more" onPress={customizeMore} />
    </View>
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
const NOTE = { lineHeight: proseLineHeight.small, marginTop: space.xs } as const;
