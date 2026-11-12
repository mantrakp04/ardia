import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { Pressable } from "react-native";
import { Box, Checkbox, duration, IconTile, Text, type Space } from "../ui";
import { watchWindowActivation, windowActivatedAt } from "../../state/site/promptGuard";
import { siteLine, useSiteTokens } from "./tokens";

export function PromptIcon({ icon }: { icon: string }) {
  return <IconTile symbol={icon} fill={useSiteTokens().iconTile} />;
}

export function Well({ list = false, gap, fill, children }: { list?: boolean; gap?: Space; fill?: string; children: ReactNode }) {
  const { well } = useSiteTokens();
  return (
    <Box radius="tile" padX={list ? undefined : "ml"} padY={list ? "xs" : "m"} gap={gap} style={{ backgroundColor: fill ?? well }}>
      {children}
    </Box>
  );
}

const CHECK_ROW = { alignItems: "flex-start" } as const;
const CHECK_LABEL = { flex: 1, lineHeight: siteLine.checkLabel } as const;

export function CheckRow({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <Pressable onPress={() => onChange(!value)}>
      <Box row gap="m" style={CHECK_ROW}>
        <Checkbox value={value} onChange={onChange} />
        <Text size="small" style={CHECK_LABEL}>
          {label}
        </Text>
      </Box>
    </Pressable>
  );
}

export const PROMPT_INPUT_DELAY_MS = 500;

export function usePromptInputGuard(promptKey: string | number | null | undefined) {
  const visibleAt = useRef(Number.POSITIVE_INFINITY);
  const lastInputAt = useRef(0);
  useLayoutEffect(() => {
    watchWindowActivation();
    visibleAt.current = promptKey == null ? Number.POSITIVE_INFINITY : Date.now() + duration.base;
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
