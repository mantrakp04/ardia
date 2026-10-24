import { userFullName } from "@ardia/shell";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useNtpBackdrop } from "./Backdrop";
import { greetingFor, greetingName, homeHistory, recentSites, suggestedForNow, type SiteSuggestion } from "../../lib/ntpSuggestions";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { isIncognitoProfile } from "../../store/model";
import { Favicon, useHover } from "../primitives";

const TILE = 76;
const ICON_BOX = 52;
const GAP = 14;
const NO_HISTORY: never[] = [];

export function Greeting({ left, top, width }: { left: number; top: number; width: number }) {
  const theme = useTheme();
  const custom = useBrowser((s) => s.settings.greetingName);
  const byName = useBrowser((s) => s.settings.ntpGreetingName);
  const onArt = !!useNtpBackdrop();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const name = greetingName(byName, custom, userFullName);
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left,
        top,
        width,
        alignItems: "center",
        opacity: rise,
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
      }}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          { fontSize: 30, fontWeight: "700", letterSpacing: -0.4 },
          { color: onArt ? "#FFFFFF" : theme.textPrimary },
          onArt ? { textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: 14, textShadowOffset: { width: 0, height: 2 } } : null,
        ]}
      >
        {greetingFor(now, name)}
      </Text>
    </Animated.View>
  );
}

export function HomeSections({ tabId, left, top, width }: { tabId: string; left: number; top: number; width: number }) {
  const profileId = useBrowser((s) => s.tabs[tabId]?.profileId ?? "");
  const enabled = useBrowser((s) => s.settings.ntpSuggestions);
  const history = useBrowser((s) => homeHistory(s.history[profileId], { enabled, incognito: isIncognitoProfile(profileId) }) as typeof NO_HISTORY);
  const sections = useMemo(() => {
    const now = new Date();
    const suggested = suggestedForNow(history, now);
    const shown = new Set(suggested.map((s) => s.host));
    return [
      { title: "Suggested now", sites: suggested },
      { title: "Recently visited", sites: recentSites(history, shown) },
    ].filter((s) => s.sites.length);
  }, [history]);
  if (!sections.length) return null;
  const perRow = Math.max(1, Math.floor((width + GAP) / (TILE + GAP)));
  const open = (url: string) => useBrowser.getState().navigate(tabId, url);
  let index = 0;
  return (
    <View style={{ position: "absolute", left, top, width, gap: 22 }} pointerEvents="box-none">
      {sections.map((section) => (
        <View key={section.title} style={{ gap: 10 }}>
          <SectionTitle title={section.title} />
          <View style={{ flexDirection: "row", gap: GAP }}>
            {section.sites.slice(0, perRow).map((site) => (
              <SiteTile key={site.host} site={site} profileId={profileId} index={index++} onOpen={open} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  const theme = useTheme();
  const onArt = !!useNtpBackdrop();
  return (
    <Text style={[{ fontSize: 13, fontWeight: "700", color: onArt ? "rgba(255,255,255,0.92)" : theme.textSecondary, marginLeft: 2 }, onArt ? { textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 8 } : null]}>
      {title}
    </Text>
  );
}

const SiteTile = memo(function SiteTile({ site, profileId, index, onOpen }: { site: SiteSuggestion; profileId: string; index: number; onOpen: (url: string) => void }) {
  const theme = useTheme();
  const onArt = !!useNtpBackdrop();
  const { hovered, hoverProps } = useHover();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, delay: 120 + index * 28, speed: 16, bounciness: 5, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={{ width: TILE, opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }] }}>
      <Pressable {...hoverProps} onPress={() => onOpen(site.url)} tooltip={site.url} style={{ alignItems: "center", gap: 6 }}>
        <View
          style={{
            width: ICON_BOX,
            height: ICON_BOX,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: onArt
              ? hovered
                ? "rgba(255,255,255,0.95)"
                : "rgba(255,255,255,0.82)"
              : hovered
                ? theme.dark
                  ? "rgba(255,255,255,0.16)"
                  : "rgba(0,0,0,0.09)"
                : theme.dark
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(0,0,0,0.045)",
          }}
        >
          <Favicon url={site.url} favicon={site.favicon} profileId={profileId} size={28} />
        </View>
        <Text
          numberOfLines={1}
          style={[
            { width: TILE, textAlign: "center", fontSize: 11.5, color: onArt ? "#FFFFFF" : theme.textSecondary },
            onArt ? { textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 6 } : null,
          ]}
        >
          {siteLabel(site)}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

function siteLabel(site: SiteSuggestion): string {
  const title = site.title.split(/\s[-–—|·:]\s/)[0]!.replace(/^\(\d+\)\s*/, "").trim();
  if (title && title.length <= 14 && !/^https?:/.test(title)) return title;
  const name = site.host.split(".").slice(-2, -1)[0] ?? site.host;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
