import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { addToDock, backgroundInstance, isDefaultBrowser, isInDock, setAsDefaultBrowser } from "../../state/app/appSettings";
import { isSharing, setSharing } from "../../state/telemetry/client";
import { SHARING_COPY } from "../../state/telemetry/copy";
import { Button, Symbol, Text } from "../ui";
import { lineHeight, proseLineHeight, space } from "../ui/tokens";
import { PostageStamp, PostcardPaper } from "../ntp/PostageStamp";
import { customizeMore, finishOnboarding, QUESTION_ORDER, recordDefaultBrowserTrial, setOnboardingExtras, useOnboarding } from "../../state/onboarding/onboarding";
import { SecondaryButton } from "./Buttons";
import { OptionCard } from "./OptionCard";
import { OptionRow, useOnboardingColors } from "./Parts";
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
  const dock = extras.dock ?? true;
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

  const defaultChoice: DefaultChoice = setDefault ? "yes" : trial ? "trial" : "no";
  return (
    <StepLayout
      title="Last few choices"
      subtitle="The rest is set up from what you picked. Change any of it later in Settings."
      actions={
        <>
          <StepActions icon="arrow.right" continueTitle={busy ? "Setting Up…" : redo ? "Done" : "Get Started"} disabled={!system || busy} onContinue={() => void finish(false)} />
          {redo ? null : <SecondaryButton title="Take the Tour" onPress={() => void finish(true)} />}
        </>
      }
      preview={receipt ? <Receipt on={share} /> : <Postcard lines={lines} />}
      previewOptional
    >
      {system && (!system.isDefault || !system.inDock) ? (
        <View style={{ gap: space.m }}>
          {!system.isDefault ? (
            <OptionRow
              title="Default browser"
              value={defaultChoice}
              options={redo ? DEFAULT_CHOICES.filter((c) => c.value !== "trial") : DEFAULT_CHOICES}
              onChange={(choice) => setOnboardingExtras({ setDefault: choice === "yes", trial: choice === "trial" })}
            />
          ) : null}
          {!system.inDock ? <OptionRow title="Keep in the Dock" value={dock ? "yes" : "no"} options={DOCK_CHOICES} onChange={(v) => setOnboardingExtras({ dock: v === "yes" })} /> : null}
        </View>
      ) : null}
      <View style={{ gap: space.ml }}>
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
          {SHARING_COPY.onboarding.note}
        </Text>
        {customizing ? null : <CustomizeMoreLink />}
      </View>
    </StepLayout>
  );
}

type DefaultChoice = "yes" | "trial" | "no";

const DEFAULT_CHOICES: { value: DefaultChoice; title: string }[] = [
  { value: "yes", title: "Yes" },
  { value: "trial", title: "Try for 7 days" },
  { value: "no", title: "Not now" },
];

const DOCK_CHOICES: { value: "yes" | "no"; title: string }[] = [
  { value: "yes", title: "Yes" },
  { value: "no", title: "No" },
];

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
const NOTE = { lineHeight: proseLineHeight.small } as const;
