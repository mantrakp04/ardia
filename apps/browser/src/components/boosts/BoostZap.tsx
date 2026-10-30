import { useEffect, useRef, useState } from "react";
import { Box, Button, Text } from "../ui";
import { useTab } from "../../state/browser/hooks";
import { setZapRelated, startZap, stopZap, watchZapPicks, type ZapPick } from "../../state/boostUi/zap";
import { BOOST_PANEL } from "./tokens";

export type ZapChip = { selector: string; matches: number };

const plural = (n: number) => `${n} element${n === 1 ? "" : "s"}`;

export function ZapPicker({ tabId, onZap }: { tabId: string; onZap: (chip: ZapChip) => void }) {
  const [pick, setPick] = useState<ZapPick | null>(null);
  const [level, setLevel] = useState(0);
  const asked = useRef(false);
  const mounted = useRef(true);
  const url = useTab(tabId, (t) => t?.url);
  useEffect(() => {
    setPick(null);
    asked.current = false;
    mounted.current = true;
    void startZap(tabId);
    const stop = watchZapPicks(tabId, (next) => {
      if (!asked.current) setLevel(0);
      asked.current = false;
      setPick(next);
    });
    return () => {
      mounted.current = false;
      stop();
      void stopZap(tabId);
    };
  }, [tabId, url]);
  const relate = (to: number) => {
    asked.current = true;
    setLevel(to);
    void setZapRelated(tabId, to);
  };
  return (
    <Box gap="m" padX="l" padY="l" fill="groupFill" border="groupBorder" radius="l">
      {pick ? (
        <>
          <Box row center gap="s">
            <Text weight="medium" style={{ flex: 1 }}>
              {plural(pick.matches)}
            </Text>
            <Button variant="icon" icon="minus" size={11} box={24} tooltip="Fewer related elements" disabled={level <= 0} onPress={() => relate(level - 1)} />
            <Button variant="icon" icon="plus" size={11} box={24} tooltip="All related elements" disabled={level >= pick.levels - 1} onPress={() => relate(level + 1)} />
          </Box>
          <Box row gap="s">
            <Button
              title="Zap"
              kind="primary"
              onPress={() => {
                onZap({ selector: pick.selector, matches: pick.matches });
                setPick(null);
              }}
            />
            <Button
              title="Cancel"
              onPress={() => {
                setPick(null);
                void Promise.resolve(stopZap(tabId)).then(() => (mounted.current ? startZap(tabId) : undefined));
              }}
            />
          </Box>
        </>
      ) : (
        <Text size="small" tone="textSecondary">
          Click an element on the page to hide it.
        </Text>
      )}
    </Box>
  );
}

export function ZapChips({ chips, onUndo }: { chips: ZapChip[]; onUndo: (chip: ZapChip) => void }) {
  return (
    <Box gap="xs">
      {chips.map((chip) => (
        <Box key={chip.selector} row center gap="s" padX="l" fill="groupFill" radius="m" style={{ height: BOOST_PANEL.chipHeight }}>
          <Text size="small" lines={1} style={{ flex: 1 }}>
            {`Hid ${plural(chip.matches)}`}
          </Text>
          <Button variant="text" title="Undo" size="small" onPress={() => onUndo(chip)} />
        </Box>
      ))}
    </Box>
  );
}
