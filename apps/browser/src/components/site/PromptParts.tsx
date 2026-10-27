import { useCallback, useLayoutEffect, useRef } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "../ui/theme";
import { Box, Checkbox, duration, Symbol, Text } from "../ui";
import { watchWindowActivation, windowActivatedAt } from "../../state/site/promptGuard";
import { siteLine, useSiteTokens } from "./tokens";

const ICON_TILE = { width: 30, height: 30, alignItems: "center", justifyContent: "center" } as const;
const ICON_GLYPH = { width: 20, height: 20 } as const;

export function IconTile({ icon }: { icon: string }) {
  const theme = useTheme();
  const site = useSiteTokens();
  return (
    <Box radius="l" style={[ICON_TILE, { backgroundColor: site.iconTile }]}>
      <Symbol name={icon} size={14} color={theme.icon} style={ICON_GLYPH} />
    </Box>
  );
}

const CHECK_ROW = { flexDirection: "row", alignItems: "flex-start", gap: 7 } as const;
const CHECK_BOX = { marginTop: 1 } as const;
const CHECK_LABEL = { flex: 1, lineHeight: siteLine.checkLabel } as const;

export function CheckRow({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={CHECK_ROW}>
      <View style={CHECK_BOX}>
        <Checkbox value={value} onChange={onChange} />
      </View>
      <Text size="small" style={CHECK_LABEL}>
        {label}
      </Text>
    </Pressable>
  );
}

export const PROMPT_INPUT_DELAY_MS = 500;

export function usePromptInputGuard(promptKey: string | number | null | undefined) {
  const visibleAt = useRef(Number.POSITIVE_INFINITY);
  const lastInputAt = useRef(0);
  useLayoutEffect(() => {
    watchWindowActivation();
    visibleAt.current = promptKey == null ? Number.POSITIVE_INFINITY : Date.now() + duration.popoverOpen;
  }, [promptKey]);
  return useCallback(
    <A extends unknown[]>(action: (...args: A) => void) =>
      (...args: A) => {
        const now = Date.now();
        const previousInputAt = lastInputAt.current;
        lastInputAt.current = now;
        const settledAt = Math.max(visibleAt.current, windowActivatedAt()) + PROMPT_INPUT_DELAY_MS;
        if (now < settledAt || now - previousInputAt < PROMPT_INPUT_DELAY_MS) return;
        action(...args);
      },
    [],
  );
}
