import { useContext, useRef, useState, type ReactNode } from "react";
import { Animated, ScrollView, View, type LayoutChangeEvent } from "react-native";
import { ChoiceCard } from "./ChoiceCard";
import { activeSteps, previousStep, useOnboarding } from "../../state/onboarding/onboarding";
import { BackButton, PrimaryButton, SecondaryButton } from "./Buttons";
import { CONTENT_WIDTH } from "./tokens";
import { ONBOARDING_CARD, OnboardingCardContext, Reveal, StepProgress, StepTitle, Tag, useOnboardingCard, useOnboardingColors } from "./Parts";
import { radius, space } from "../ui/tokens";
import { curve, duration } from "../ui/motion";
import { ScrollEdgeLine } from "../sidebar/ScrollEdge";

const COLUMN = { width: CONTENT_WIDTH + space.xxxl * 2, padding: space.xxxl, top: 34 };

const NARROW = { below: 600, previewShare: 0.3, inset: space.l, padding: space.xxl } as const;

const COMPACT = { padding: space.huge, vertical: space.xxl, maxWidth: 720, previewMin: 260, hidePreviewBelow: 900 } as const;

export function StepLayout({
  title,
  subtitle,
  tag,
  pageKey,
  children,
  actions,
  footer,
  preview,
  previewOptional,
}: {
  title: string;
  subtitle?: string;
  tag?: string;
  pageKey?: string | number;
  children?: ReactNode;
  actions: ReactNode;
  footer?: ReactNode;
  preview: ReactNode;
  previewOptional?: boolean;
}) {
  const outer = useContext(OnboardingCardContext);
  const [crowded, setCrowded] = useState(!!outer.crowded);
  const scoped = crowded === !!outer.crowded ? outer : { ...outer, crowded };
  return (
    <OnboardingCardContext.Provider value={scoped}>
      <StepColumns
        title={title}
        subtitle={subtitle}
        tag={tag}
        pageKey={pageKey}
        actions={actions}
        footer={footer}
        preview={preview}
        previewOptional={previewOptional}
        onOverflow={() => setCrowded(true)}
      >
        {children}
      </StepColumns>
    </OnboardingCardContext.Provider>
  );
}

function StepColumns({
  title,
  subtitle,
  tag,
  pageKey,
  children,
  actions,
  footer,
  preview,
  previewOptional,
  onOverflow,
}: {
  title: string;
  subtitle?: string;
  tag?: string;
  pageKey?: string | number;
  children?: ReactNode;
  actions: ReactNode;
  footer?: ReactNode;
  preview: ReactNode;
  previewOptional?: boolean;
  onOverflow: () => void;
}) {
  const colors = useOnboardingColors();
  const card = useOnboardingCard();
  const { compact } = card;
  const more = useMoreBelow(compact ? undefined : onOverflow);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const narrow = !!size && size.width < NARROW.below;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width < NARROW.below || size) setSize({ width, height });
  };
  const body = (
    <>
      <Reveal delay={60} style={{ gap: compact ? space.m : space.ml }}>
        <StepTitle title={title} subtitle={subtitle} />
        {tag ? (
          <View style={{ flexDirection: "row" }}>
            <Tag title={tag} />
          </View>
        ) : null}
      </Reveal>
      <Reveal delay={140} style={compact ? { gap: space.l, marginTop: space.l } : { gap: space.xl, marginTop: space.xxxl }}>
        {children}
      </Reveal>
    </>
  );
  const column = (
    <>
      <Reveal>
        <StepProgress />
      </Reveal>
      <ScrollView
        key={pageKey}
        style={{ flex: 1, marginTop: compact ? space.l : space.xxl }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onLayout={(e) => more.measure({ viewport: e.nativeEvent.layout.height })}
        onContentSizeChange={(_, height) => more.measure({ content: height })}
        onScroll={(e) => more.measure({ offset: e.nativeEvent.contentOffset.y })}
      >
        {body}
      </ScrollView>
      <ScrollEdgeLine opacity={more.opacity} />
      {footer ? <Reveal style={{ paddingTop: compact ? space.m : space.l }}>{footer}</Reveal> : null}
      <Reveal delay={240} style={{ flexDirection: "row", alignItems: "center", gap: space.ml, paddingTop: compact ? space.l : space.xl }}>
        {actions}
      </Reveal>
    </>
  );
  const pane = { overflow: "hidden", alignItems: "center", justifyContent: "center" } as const;
  const paneCard = { plain: true, radius: radius.sheet, fill: colors.preview, border: colors.previewBorder };
  if (narrow)
    return (
      <View style={{ flex: 1 }} onLayout={onLayout}>
        <ChoiceCard {...paneCard} style={[pane, { height: Math.round(size.height * NARROW.previewShare), margin: NARROW.inset, marginBottom: 0 }]}>
          <Reveal delay={120} style={{ alignSelf: "stretch", flex: 1 }}>
            <FittedPreview>{preview}</FittedPreview>
          </Reveal>
        </ChoiceCard>
        <View style={{ flex: 1, padding: NARROW.padding }}>{column}</View>
      </View>
    );
  const hidePreview = previewOptional && card.height < ONBOARDING_CARD.compactBelow && card.width < COMPACT.hidePreviewBelow;
  const columnStyle = compact
    ? {
        width: hidePreview ? undefined : Math.min(COMPACT.maxWidth, Math.max(COLUMN.width, card.width - COMPACT.previewMin - space.l)),
        flex: hidePreview ? 1 : undefined,
        paddingTop: Math.max(COMPACT.vertical, card.clearTop),
        paddingBottom: COMPACT.vertical,
        paddingHorizontal: COMPACT.padding,
      }
    : { width: COLUMN.width, paddingTop: Math.max(COLUMN.top, card.clearTop), paddingBottom: COLUMN.padding, paddingHorizontal: COLUMN.padding };
  return (
    <View style={{ flex: 1, flexDirection: "row" }} onLayout={onLayout}>
      <View style={columnStyle}>{column}</View>
      {hidePreview ? null : (
        <ChoiceCard {...paneCard} style={[pane, { flex: 1, margin: space.l, marginLeft: 0 }]}>
          <Reveal delay={120} style={{ alignSelf: "stretch", flex: 1 }}>
            <FittedPreview>{preview}</FittedPreview>
          </Reveal>
        </ChoiceCard>
      )}
    </View>
  );
}

function useMoreBelow(onOverflow?: () => void) {
  const overflow = useRef(onOverflow);
  overflow.current = onOverflow;
  const [more] = useState(() => {
    const opacity = new Animated.Value(0);
    const at = { viewport: 0, content: 0, offset: 0 };
    let shown = false;
    return {
      opacity,
      measure(next: Partial<typeof at>) {
        Object.assign(at, next);
        if (overflow.current && at.viewport > 0 && at.content > at.viewport + 1) return overflow.current();
        const below = at.viewport > 0 && at.offset + at.viewport < at.content - 1;
        if (below === shown) return;
        shown = below;
        Animated.timing(opacity, { toValue: below ? 1 : 0, duration: duration.fast, easing: curve.fade, useNativeDriver: true }).start();
      },
    };
  });
  return more;
}

function FittedPreview({ children }: { children: ReactNode }) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [content, setContent] = useState<{ width: number; height: number } | null>(null);
  const scale = box && content && content.width && content.height ? Math.min(1, box.width / content.width, box.height / content.height) : 1;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      <View style={{ alignItems: "center", justifyContent: "center", transform: [{ scale }] }} onLayout={(e) => setContent(e.nativeEvent.layout)}>
        {children}
      </View>
    </View>
  );
}

export function StepActions({
  onContinue,
  continueTitle = "Continue",
  disabled,
  onSkip,
  icon,
}: {
  onContinue: () => void;
  continueTitle?: string;
  disabled?: boolean;
  onSkip?: () => void;
  icon?: string;
}) {
  const step = useOnboarding((s) => s.step);
  const sub = useOnboarding((s) => s.sub);
  const back = previousStep;
  const steps = activeSteps();
  const first = steps[steps.indexOf(step) - 1] === "intro" && sub === 0;
  return (
    <>
      {first ? null : <BackButton onPress={back} />}
      <PrimaryButton title={continueTitle} icon={icon} onPress={onContinue} disabled={disabled} />
      {onSkip ? <SecondaryButton title="Skip" onPress={onSkip} /> : null}
    </>
  );
}
