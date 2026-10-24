import { getContentBlocker, type ContentBlockerProvider, type ContentBlockerState } from "@ardia/ardiacore";
import { Symbol } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { applyOnboardingBlocker } from "../../lib/contentBlockerOnboarding";
import { PROVIDER_TITLES, providerStatusText, runningStatus } from "../../lib/contentBlockerProvider";
import { getActivatingBlocker, onBlockerSettingsChange } from "../../lib/contentBlockerSelection";
import { AdNauseamPreview } from "./adnauseamPreview";
import { StepLayout } from "./steps";
import { useOnboarding } from "./state";
import { CheckRow, PrimaryButton, Reveal, SecondaryButton, StepTitle, useOnboardingColors } from "./ui";

const OPTIONS: Record<ContentBlockerProvider, { icon: string; subtitle: string }> = {
  ublock: { icon: "hand.raised", subtitle: "Straightforward blocking. Stops ads and trackers before they load. Recommended." },
  adnauseam: { icon: "eye.slash", subtitle: "Active obfuscation. Hides ads and clicks them in the background to muddy ad profiles." },
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function BlockerStep() {
  const colors = useOnboardingColors();
  const [opened] = useState(() => ({ session: useOnboarding.getState().session, windowId: useOnboarding.getState().windowId }));
  const [blocker, setBlocker] = useState<ContentBlockerState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [picked, setPicked] = useState<ContentBlockerProvider | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [activating, setActivating] = useState(getActivatingBlocker);
  const alive = useRef(true);
  const request = useRef(0);
  const inFlight = useRef(false);

  const load = () => {
    const id = ++request.current;
    const pending = getActivatingBlocker();
    setActivating(pending);
    if (pending) return;
    setLoadError("");
    getContentBlocker().then(
      (s) => alive.current && id === request.current && setBlocker(s),
      (e) => {
        if (!alive.current || id !== request.current) return;
        setBlocker(null);
        setLoadError(message(e));
      },
    );
  };

  useEffect(() => {
    alive.current = true;
    load();
    const sub = onBlockerSettingsChange(load);
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, []);

  const isCurrent = () => {
    const { step, session, windowId, leaving } = useOnboarding.getState();
    return alive.current && !leaving && step === "blocker" && session === opened.session && windowId === opened.windowId;
  };
  const leave = () => { if (isCurrent()) useOnboarding.getState().next(); };

  const choice = picked ?? blocker?.selectedProvider ?? null;
  const busy = saving || !!activating;

  const save = async () => {
    if (!blocker || !choice || inFlight.current || busy || !isCurrent()) return;
    inFlight.current = true;
    setPicked(choice);
    setSaving(true);
    setSaveError("");
    try {
      if (await applyOnboardingBlocker(choice, isCurrent, opened.windowId ?? undefined)) leave();
    } catch (e) {
      if (alive.current) {
        setSaveError(message(e));
        load();
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setSaving(false);
    }
  };

  const pick = (p: ContentBlockerProvider) => {
    if (busy || inFlight.current || p === choice) return;
    setPicked(p);
    setSaveError("");
  };

  const loading = !blocker && !loadError;
  const failed = !blocker && !!loadError;
  const options = blocker ? blocker.availableProviders : [];

  const status = activating
    ? `Activating ${PROVIDER_TITLES[activating]}…`
    : failed
    ? `Couldn't check the ad blocker: ${loadError}. Try again, or keep the one you have.`
    : !blocker
      ? "Checking which ad blocker is running…"
      : blocker.provider !== blocker.selectedProvider || runningStatus(blocker) !== "running"
        ? providerStatusText(blocker, "Continue to retry.") : "";

  return (
    <StepLayout
      scrollable
      actions={
        failed ? (
          <>
            <PrimaryButton title="Try Again" onPress={load} />
            <SecondaryButton title="Keep Current" onPress={leave} />
          </>
        ) : (
          <>
            <PrimaryButton
              title={activating ? "Activating…" : saving ? "Saving…" : saveError ? "Try Again" : "Continue"}
              onPress={() => void save()}
              disabled={!blocker || !choice || busy}
            />
            {(loading || saveError) && !busy ? <SecondaryButton title="Keep Current" onPress={leave} /> : null}
          </>
        )
      }
      preview={<BlockerPreview chosen={choice} />}
    >
      <Reveal delay={60}>
        <StepTitle title="Choose your ad blocker" subtitle="Both come with Ardia and run on this Mac. Switch any time in Settings › Privacy." />
      </Reveal>
      <Reveal delay={140} style={{ gap: 12 }}>
        {saveError ? <Text style={{ fontSize: 12, lineHeight: 17, color: colors.title }}>{saveError}</Text> : null}
        {options.length ? (
          <View accessibilityRole="radiogroup" accessibilityLabel="Ad blocker" style={{ gap: 6 }}>
            {options.map((p) => (
              <CheckRow
                key={p}
                role="radio"
                icon={OPTIONS[p].icon}
                title={PROVIDER_TITLES[p]}
                subtitle={OPTIONS[p].subtitle}
                value={choice === p}
                disabled={busy}
                onChange={() => pick(p)}
              />
            ))}
          </View>
        ) : null}
        {choice === "adnauseam" ? (
          <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.footnote }}>
            Choosing AdNauseam includes background ad clicking and uses extra data. You'll be asked to confirm when you continue. Choose uBlock Origin for blocking without clicking.
          </Text>
        ) : null}
        {status ? <Text style={{ fontSize: 12, lineHeight: 17, color: colors.subtitle }}>{status}</Text> : null}
      </Reveal>
    </StepLayout>
  );
}

function BlockerPreview({ chosen }: { chosen: ContentBlockerProvider | null }) {
  const colors = useOnboardingColors();
  const explainClicks = chosen === "adnauseam";
  return (
    <View style={{ width: 300, gap: 18 }}>
      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 10, fontWeight: "600", letterSpacing: 0.8, color: colors.steps }}>PRIVACY, BUILT IN</Text>
        <Text style={{ fontSize: 25, lineHeight: 30, fontWeight: "300", letterSpacing: -0.4, color: colors.title }}>{explainClicks ? "Hide the ads.\nBlur the profile." : "A safer, quieter web."}</Text>
        <Text style={{ fontSize: 13, lineHeight: 19, color: colors.subtitle }}>
          {explainClicks
            ? "Hidden ad clicks add noise to the profile advertisers build about you."
            : "Your privacy comes first. Ardia includes ad and tracker blocking for a less intrusive web. You stay in control of your protection."}
        </Text>
      </View>
      {explainClicks ? <AdNauseamPreview /> : (
        <View style={{ padding: 20, gap: 16, borderRadius: 16, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.rowBorder }}>
          <Symbol name="hand.raised" size={24} color={colors.title} style={{ width: 30, height: 30 }} />
          {["Ads and trackers blocked", "Fewer distractions on the page", "No background ad clicking"].map((text) => (
            <View key={text} style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <Symbol name="checkmark" size={11} color={colors.subtitle} style={{ width: 14, height: 14 }} />
              <Text style={{ fontSize: 12, color: colors.subtitle }}>{text}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
