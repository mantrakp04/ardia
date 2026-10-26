import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Image, Pressable, Text as Span, View, type TextStyle } from "react-native";
import { FadeLabel } from "../ui/native";
import { openLiveItem } from "../../state/live/engine";
import { summarizeChecks } from "../../state/live/github";
import { ago } from "../../state/live/meetings";
import { useLive } from "../../state/live/store";
import type { LiveItem, PullRequestCheck } from "../../state/live/types";
import { newTab } from "../../state/tabs/actions";
import { Box, Button, curve, font, hairline, hex, radius, space, Surface, Symbol, Text, useHover, useTheme, weight } from "../ui";
import { cardHoverProps, dismissHover } from "../../state/sidebar/hover";
import { hoverCardOrigin } from "../sidebar/hoverMotion";
import type { Anchor } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "../sidebar/TabIcon";
import { liveMotion, liveShadow, liveType, useLiveColors, type LiveColors } from "./tokens";

const PREVIEW_GAP = 9;
const CI_BAR = 6;
const CHECK_ROW = 24;
const CHECK_PAD = 5;
const CHIP_HEIGHT = 17;

export function HoverSurface({ anchor, width, children }: { anchor: Anchor; width: number; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View onLayout={cardHoverProps.onLayout} style={{ position: "absolute", ...hoverCardOrigin(anchor), width }}>
      <Surface
        onMouseEnter={cardHoverProps.onMouseEnter}
        onMouseLeave={cardHoverProps.onMouseLeave}
        fill={hex(theme.panel)}
        cornerRadius={radius.panel}
        borderColor={hex(theme.panelBorder)}
        borderWidth={hairline.panel}
        shadowColor={liveShadow.hoverCard.color}
        shadowOpacity={theme.panelShadowOpacity * liveShadow.hoverCard.opacityScale}
        shadowRadius={liveShadow.hoverCard.radius}
        shadowOffset={liveShadow.hoverCard.offset}
        style={HOVER_CARD}
      >
        {children}
      </Surface>
    </View>
  );
}

const HOVER_CARD = { padding: space.l } as const;

export function LiveItemCard({ id, windowId, anchor }: { id: string; windowId: string; anchor: Anchor }) {
  const [, folderId = "", itemId = ""] = id.split("|");
  const item = useLive((s) => s.items[folderId]?.find((i) => i.id === itemId));
  if (!item) return null;
  return (
    <HoverSurface anchor={anchor} width={item.pr ? 300 : 280}>
      {item.pr ? <PullRequestPreview item={item} folderId={folderId} windowId={windowId} /> : <DocumentPreview item={item} />}
    </HoverSurface>
  );
}

export function Avatar({ uri, name, size = 20 }: { uri: string | null; name: string; size?: number }) {
  const colors = useLiveColors();
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", backgroundColor: colors.avatarFill, alignItems: "center", justifyContent: "center" }}>
      <Text weight="semibold" style={{ fontSize: size * liveType.avatarScale }}>
        {initials || "?"}
      </Text>
      {uri && !failed ? <Image source={{ uri }} onError={() => setFailed(true)} style={{ position: "absolute", width: size, height: size }} /> : null}
    </View>
  );
}

const open = (windowId: string, url: string) => {
  dismissHover();
  newTab(windowId, { url });
};

function PullRequestPreview({ item, folderId, windowId }: { item: LiveItem; folderId: string; windowId: string }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const pr = item.pr!;
  const summary = summarizeChecks(pr.checks);
  const failing = pr.checks.filter((c) => c.state === "failure");
  const [showAll, setShowAll] = useState(false);
  return (
    <View style={PREVIEW}>
      <Box row gap="sm" style={CENTER}>
        <Avatar uri={pr.authorAvatar} name={pr.author} />
        <Text lines={1} size="small" tone="textSecondary" style={FILL}>
          <Span style={{ fontWeight: weight.semibold, color: theme.textPrimary }}>{pr.author}</Span> · {pr.repo} #{pr.number}
        </Text>
        {pr.draft ? <Chip text="Draft" color={colors.draft} /> : null}
      </Box>
      <Text lines={3} style={liveType.heading}>
        {item.title}
      </Text>

      {summary ? (
        <Box gap="s">
          <CIProgressBar checks={pr.checks} colors={colors} />
          <StatusLine
            symbol={summary.tone === "success" ? "checkmark.circle.fill" : summary.tone === "failure" ? "xmark.circle.fill" : "clock.fill"}
            color={summary.tone === "success" ? colors.success : summary.tone === "failure" ? colors.failure : colors.pending}
            text={summary.text}
          />
          {(showAll ? failing : failing.slice(0, 3)).map((c) => (
            <FailingCheckRow key={c.name} check={c} colors={colors} onPress={() => c.url && open(windowId, c.url)} />
          ))}
          {failing.length > 3 && !showAll ? <LinkText text={`Show all ${failing.length} failures`} onPress={() => setShowAll(true)} /> : null}
        </Box>
      ) : null}

      {pr.mergeable === "conflicting" ? (
        <Box row gap="m" style={CENTER}>
          <View style={FILL}>
            <StatusLine symbol="exclamationmark.triangle.fill" color={colors.conflict} text="This branch has conflicts" />
          </View>
          <Button variant="pill" tone="chip" title="Resolve Conflicts" onPress={() => open(windowId, `${item.url}/conflicts`)} />
        </Box>
      ) : null}

      {pr.review ? (
        <StatusLine
          symbol={pr.review === "approved" ? "checkmark.seal.fill" : pr.review === "changesRequested" ? "arrow.uturn.backward.circle.fill" : "eye"}
          color={pr.review === "approved" ? colors.success : pr.review === "changesRequested" ? colors.failure : theme.textSecondary}
          text={pr.review === "approved" ? "Approved" : pr.review === "changesRequested" ? "Changes Requested" : item.section === "authored" ? "Review required" : "Needs your review"}
        />
      ) : null}

      <View style={[DIVIDER, { backgroundColor: theme.divider }]} />
      <Box row gap="ml" style={FOOTER}>
        <Pressable
          onPress={() => {
            dismissHover();
            openLiveItem(windowId, folderId, item);
          }}
          style={COMMENTS}
        >
          <Symbol name="bubble.left" size={10.5} color={theme.textSecondary} style={GLYPH_14} />
          <Text size="footnote" tone="textSecondary" style={SHRINK}>
            {pr.comments === 1 ? "1 comment" : `${pr.comments} comments`}
            {pr.unresolvedThreads ? ` · ${pr.unresolvedThreads} unresolved` : ""}
          </Text>
        </Pressable>
        {pr.additions || pr.deletions ? (
          <Text size="footnote" tone="textSecondary" style={DIFF_STAT}>
            <Span style={{ color: colors.success }}>+{pr.additions}</Span> <Span style={{ color: colors.failure }}>−{pr.deletions}</Span>
            {pr.changedFiles ? ` · ${pr.changedFiles} ${pr.changedFiles === 1 ? "file" : "files"}` : ""}
          </Text>
        ) : null}
      </Box>
    </View>
  );
}

const FILL = { flex: 1 } as const;
const SHRINK = { flexShrink: 1 } as const;
const CENTER = { alignItems: "center" } as const;
const PREVIEW = { gap: PREVIEW_GAP } as const;
const DIVIDER = { height: hairline.panel } as const;
const FOOTER = { flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" } as const;
const COMMENTS = { flexDirection: "row", alignItems: "center", maxWidth: "100%", gap: space.xs } as const;
const DIFF_STAT: TextStyle = { maxWidth: "100%", fontVariant: ["tabular-nums"] };
const GLYPH_12 = { width: 12, height: 12 } as const;
const GLYPH_14 = { width: 14, height: 14 } as const;

function CIProgressBar({ checks, colors }: { checks: PullRequestCheck[]; colors: LiveColors }) {
  const success = checks.filter((c) => c.state === "success" || c.state === "neutral").length;
  const pending = checks.filter((c) => c.state === "pending" || c.state === "queued").length;
  const failure = checks.filter((c) => c.state === "failure").length;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pending) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: liveMotion.ciPulse, easing: curve.inOutQuad, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: liveMotion.ciPulse, easing: curve.inOutQuad, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pending]);
  return (
    <View style={[CI_TRACK, { backgroundColor: colors.ciTrack }]}>
      {success ? <View style={{ flex: success, backgroundColor: colors.success }} /> : null}
      {pending ? <Animated.View style={{ flex: pending, backgroundColor: colors.pending, opacity: pulse }} /> : null}
      {failure ? <View style={{ flex: failure, backgroundColor: colors.failure }} /> : null}
    </View>
  );
}

const CI_TRACK = { height: CI_BAR, borderRadius: CI_BAR / 2, overflow: "hidden", flexDirection: "row", gap: space.xxs } as const;

function FailingCheckRow({ check, colors, onPress }: { check: PullRequestCheck; colors: LiveColors; onPress(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <Box row radius="m" gap="s" fill={hovered ? "rowHover" : undefined} style={CHECK}>
          <Symbol name="xmark" size={9} weight="bold" color={colors.failure} style={GLYPH_12} />
          <FadeLabel text={check.name} fontSize={font.small.fontSize} color={theme.textPrimary} style={CHECK_LABEL} />
          {hovered ? <Symbol name="arrow.up.forward" size={9} color={theme.textSecondary} style={GLYPH_12} /> : null}
        </Box>
      </Pressable>
    </View>
  );
}

const CHECK = { height: CHECK_ROW, alignItems: "center", paddingHorizontal: CHECK_PAD } as const;
const CHECK_LABEL = { flex: 1, height: 16 } as const;

function StatusLine({ symbol, color, text }: { symbol: string; color: string; text: string }) {
  return (
    <Box row gap="s" style={CENTER}>
      <Symbol name={symbol} size={11} color={color} style={GLYPH_14} />
      <Text lines={1} size="small" style={FILL}>
        {text}
      </Text>
    </Box>
  );
}

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <View style={[CHIP, { borderColor: color }]}>
      <Text style={{ ...liveType.chip, color }}>{text}</Text>
    </View>
  );
}

const CHIP = { height: CHIP_HEIGHT, borderRadius: CHIP_HEIGHT / 2, paddingHorizontal: space.sm, borderWidth: hairline.panel, justifyContent: "center" } as const;

function LinkText({ text, onPress }: { text: string; onPress(): void }) {
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <Text size="small" tone="accent" style={hovered ? UNDERLINE : NO_UNDERLINE}>
          {text}
        </Text>
      </Pressable>
    </View>
  );
}

const UNDERLINE = { textDecorationLine: "underline" } as const;
const NO_UNDERLINE = { textDecorationLine: "none" } as const;

function DocumentPreview({ item }: { item: LiveItem }) {
  const doc = item.doc;
  return (
    <Box gap="s">
      <Box row gap="m" style={CENTER}>
        {item.icon && /^https?:/.test(item.icon) ? <TabIcon url={item.url} favicon={item.icon} direct /> : <TabIcon url={item.url} icon={item.icon} />}
        <Text lines={2} style={[FILL, liveType.heading]}>
          {item.title}
        </Text>
      </Box>
      <Text lines={1} size="small" tone="textSecondary">
        {[doc?.kind, doc?.place ?? item.subtitle].filter(Boolean).join(" · ")}
      </Text>
      {item.updatedAt ? (
        <Text lines={1} size="small" tone="textSecondary">
          Edited {ago(item.updatedAt, Date.now())}
          {doc?.editedBy ? ` by ${doc.editedBy}` : ""}
        </Text>
      ) : null}
    </Box>
  );
}
