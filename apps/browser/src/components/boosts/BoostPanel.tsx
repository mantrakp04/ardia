import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { layout } from "../ui/theme";
import { Box, Button, Symbol, Text, TextField, useTheme } from "../ui";
import { updateBoost } from "../../state/boosts/actions";
import { closeBoostEditor, type BoostEditor } from "../../state/boosts/editor";
import { useProfileBoosts } from "../../state/boosts/hooks";
import type { Boost } from "../../state/boosts/types";
import { useTab } from "../../state/browser/hooks";
import { copyShareCode, showBoostMenu } from "../../state/boostUi/actions";
import { endPreview, previewDraft } from "../../state/boostUi/preview";
import { BoostCode } from "./BoostCode";
import { BoostColorsSection } from "./BoostColors";
import { BoostFonts, BoostTextControls } from "./BoostText";
import { ZapChips, ZapPicker, type ZapChip } from "./BoostZap";
import { BOOST_PANEL } from "./tokens";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box gap="m">
      <Text size="small" weight="semibold" tone="textSecondary">
        {title}
      </Text>
      {children}
    </Box>
  );
}

function useDraft(profileId: string, tabId: string, boost: Boost) {
  const [draft, setDraft] = useState<Partial<Boost>>({});
  const edit = (patch: Partial<Boost>, settle = true) => {
    const merged = { ...draft, ...patch };
    if (settle) {
      setDraft({});
      updateBoost(profileId, boost.id, merged);
      endPreview(tabId);
    } else {
      setDraft(merged);
      previewDraft(tabId, { ...boost, ...merged });
    }
  };
  return { boost: { ...boost, ...draft }, edit };
}

export function BoostPanel({ windowId, editor }: { windowId: string; editor: BoostEditor }) {
  const profileId = useTab(editor.tabId, (t) => t?.profileId) ?? "";
  const stored = useProfileBoosts(profileId).find((b) => b.id === editor.boostId);
  const gone = !stored;
  useEffect(() => {
    if (gone) closeBoostEditor(windowId);
  }, [gone, windowId]);
  if (!stored) return null;
  return <Panel windowId={windowId} tabId={editor.tabId} profileId={profileId} stored={stored} />;
}

function Panel({ windowId, tabId, profileId, stored }: { windowId: string; tabId: string; profileId: string; stored: Boost }) {
  const theme = useTheme();
  const { boost, edit } = useDraft(profileId, tabId, stored);
  const [name, setName] = useState(stored.name);
  const [zapping, setZapping] = useState(false);
  const [chips, setChips] = useState<ZapChip[]>([]);
  const [copied, setCopied] = useState(false);
  const typed = useRef<Partial<Boost>>({});
  const zaps = useRef(stored.zaps);
  zaps.current = stored.zaps;
  useEffect(() => setName(stored.name), [stored.name]);
  const nameRef = useRef({ name, stored: stored.name });
  nameRef.current = { name, stored: stored.name };
  const commitName = () => {
    const next = name.trim();
    if (next && next !== stored.name) updateBoost(profileId, stored.id, { name: next });
  };
  useEffect(
    () => () => {
      const next = nameRef.current.name.trim();
      if (next && next !== nameRef.current.stored) updateBoost(profileId, stored.id, { name: next });
    },
    [],
  );
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const hasJs = !!stored.js.trim();
  const zap = ({ selector, matches }: ZapChip) => {
    if (!zaps.current.includes(selector)) updateBoost(profileId, stored.id, { zaps: [...zaps.current, selector] });
    setChips((list) => [...list.filter((c) => c.selector !== selector), { selector, matches }]);
  };
  const undo = (chip: ZapChip) => {
    updateBoost(profileId, stored.id, { zaps: zaps.current.filter((s) => s !== chip.selector) });
    setChips((list) => list.filter((c) => c.selector !== chip.selector));
  };
  const share = () => setCopied(copyShareCode({ ...stored, ...typed.current }, true));
  return (
    <View style={{ flex: 1, borderRadius: layout.cardRadius, overflow: "hidden", backgroundColor: theme.card }}>
      <Box row center gap="m" style={{ height: BOOST_PANEL.headerHeight, paddingLeft: BOOST_PANEL.pad, paddingRight: 8 }}>
        <Symbol name="paintbrush.fill" size={13} color={theme.icon} style={{ width: 18, height: 18 }} />
        <TextField value={name} onChangeText={setName} placeholder={stored.domain} onBlur={commitName} onSubmit={commitName} style={{ flex: 1 }} />
        <Button variant="icon" icon="ellipsis" size={13} tooltip="More" onPress={() => void showBoostMenu(profileId, stored, windowId)} />
      </Box>
      <Divider />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: BOOST_PANEL.pad, gap: BOOST_PANEL.sectionGap }}>
        <Section title="Colors">
          <BoostColorsSection colors={boost.colors} onChange={(colors, settle) => edit({ colors }, settle)} />
        </Section>
        <Section title="Text">
          <BoostFonts font={boost.font} onChange={(font) => edit({ font })} />
          <BoostTextControls
            size={boost.size}
            textCase={boost.textCase}
            zapping={zapping}
            onSize={(size) => edit({ size })}
            onCase={(textCase) => edit({ textCase })}
            onZap={() => setZapping(!zapping)}
          />
        </Section>
        {zapping || chips.length ? (
          <Section title="Zap">
            {zapping ? <ZapPicker tabId={tabId} onZap={zap} /> : null}
            <ZapChips chips={chips} onUndo={undo} />
          </Section>
        ) : null}
        <Section title="Code">
          <BoostCode
            css={stored.css}
            js={stored.js}
            onPreview={(patch) => {
              typed.current = { ...typed.current, ...patch };
              previewDraft(tabId, { ...boost, ...patch });
            }}
            onCommit={(patch) => {
              typed.current = {};
              edit(patch);
            }}
          />
        </Section>
      </ScrollView>
      <Divider />
      <Box gap="s" style={{ padding: BOOST_PANEL.pad }}>
        <Box row center gap="m">
          <Button title={copied ? "Link Copied" : "Share"} disabled={hasJs} onPress={share} />
          <View style={{ flex: 1 }} />
          <Button title="Done" kind="primary" onPress={() => closeBoostEditor(windowId)} />
        </Box>
        {hasJs ? (
          <Text size="caption" tone="textSecondary">
            Boosts with JavaScript can't be shared.
          </Text>
        ) : null}
      </Box>
    </View>
  );
}

function Divider() {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.divider }} />;
}
