import { useState } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "../ui/theme";
import { useTab } from "../../state/browser/hooks";
import { navigate } from "../../state/tabs/actions";
import { replaceSplitPane } from "../../state/splits/actions";
import { useSplitSuggestions } from "../../state/splits/hooks";
import { tabLabel } from "../../state/browser/model";
import { Panel, SearchField, shadow, space, Symbol, Text, useHover } from "../ui";
import { EMPTY_STATE_RADIUS, EMPTY_STATE_WIDTH, SPLIT_ROW_HEIGHT, SPLIT_ROW_RADIUS, splitColors } from "./tokens";
import { Favicon } from "../favicon/Favicon";

export function SplitEmptyState({ tabId, focused }: { tabId: string; focused: boolean }) {
  const theme = useTheme();
  const [typing, setTyping] = useState(focused);
  const [text, setText] = useState("");
  const suggestions = useSplitSuggestions(tabId);
  const go = () => {
    if (text.trim()) navigate(tabId, text.trim());
  };

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl }}>
      <Panel
        fill={splitColors(theme.dark).emptyStateFill}
        radius={EMPTY_STATE_RADIUS}
        border={theme.ntpBarBorder}
        shadow={shadow.card}
        style={{ width: "100%", maxWidth: EMPTY_STATE_WIDTH, paddingVertical: space.ml }}
      >
        <Text weight="semibold" style={{ paddingHorizontal: space.xl, paddingTop: space.xs, paddingBottom: space.ml }}>
          Add a tab to this Split View
        </Text>
        {typing ? (
          <View style={{ height: SPLIT_ROW_HEIGHT, marginHorizontal: space.s, paddingHorizontal: space.ml, borderRadius: SPLIT_ROW_RADIUS, justifyContent: "center", backgroundColor: theme.rowHover }}>
            <SearchField
              look="bare"
              autoFocus
              value={text}
              onChangeText={setText}
              placeholder="Search or Ask a Question"
              onSubmit={go}
              onEscape={() => {
                setText("");
                setTyping(false);
              }}
            />
          </View>
        ) : (
          <Row icon={<Symbol name="magnifyingglass" size={13} color={theme.textSecondary} style={{ width: 16, height: 16 }} />} label="Search or Ask a Question" secondary onPress={() => setTyping(true)} />
        )}
        {suggestions.length > 0 && <View style={{ height: space.s }} />}
        {suggestions.map((id) => (
          <Suggestion key={id} tabId={id} onPress={() => replaceSplitPane(tabId, id)} />
        ))}
      </Panel>
    </View>
  );
}

function Suggestion({ tabId, onPress }: { tabId: string; onPress: () => void }) {
  const tab = useTab(tabId);
  if (!tab) return null;
  return <Row icon={<Favicon url={tab.url} favicon={tab.favicon} profileId={tab.profileId} />} label={tabLabel(tab)} detail={tab.title} onPress={onPress} />;
}

function Row({ icon, label, detail, secondary, onPress }: { icon: React.ReactNode; label: string; detail?: string; secondary?: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height: SPLIT_ROW_HEIGHT,
              marginHorizontal: space.s,
              paddingHorizontal: space.ml,
              borderRadius: SPLIT_ROW_RADIUS,
              flexDirection: "row",
              alignItems: "center",
              gap: space.m,
              backgroundColor: pressed ? theme.rowSelected : hovered ? theme.rowHover : undefined,
            }}
          >
            {icon}
            <Text numberOfLines={1} tone={secondary ? "textSecondary" : "textPrimary"} style={SHRINK}>
              {label}
              {detail ? <Text tone="textTertiary">{`  ${detail}`}</Text> : null}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const SHRINK = { flexShrink: 1 } as const;
