import { useMemo, useState } from "react";
import { View } from "react-native";
import { useAirTrafficConfig, useLinkHooks, useRoutableProfiles, type LinkHookRow, type LinkHookState, type RoutableProfile } from "../../../state/airTraffic/hooks";
import { moveAirTrafficRule, removeAirTrafficRule, setAirTrafficFallback, updateAirTrafficRule } from "../../../state/airTraffic/store";
import { previewLink, type LinkPreview } from "../../../state/airTraffic/preview";
import type { AirTrafficRule, AirTrafficTarget, SourceApp } from "../../../state/airTraffic/rules";
import { showMenu } from "../../../state/app/system";
import { goToSettingsPane } from "../../../state/settings/settingsWindows";
import { showSettingsSheet } from "../../../state/settings/sheet";
import { Button, PopUp, Symbol, TextField, Toggle, useTheme, type Option } from "../../ui";
import { Group, PaneIntro, Row, SectionHeader } from "../Form";
import { AppPicker, conditionLabel, fromLabel, OPEN_LABELS, OPEN_OPTIONS, profileOptions, RuleSheet, USED_LAST } from "./AirTrafficSheet";

const USUAL = "usual";

function targetLabel(target: AirTrafficTarget, profiles: RoutableProfile[]): string | null {
  const profile = target.profileId === null ? USED_LAST : profiles.find((p) => p.id === target.profileId)?.name;
  return profile ? `${profile} · ${OPEN_LABELS[target.open]}` : null;
}

export function AirTrafficPane() {
  const { rules } = useAirTrafficConfig();
  const profiles = useRoutableProfiles();
  return (
    <View>
      <PaneIntro>
        Send links from other apps to the profile you want, as a new tab, a new window or Little Ardia. Links you click inside Ardia stay where they
        are.
      </PaneIntro>

      <SectionHeader anchor="airTraffic.rules" action={<Button title="Add Rule…" icon="plus" onPress={() => showSettingsSheet(<RuleSheet />)} />} />
      <Group of="airTraffic.rules">
        {rules.length === 0 ? (
          <Row title="No rules yet" description="Add one to send links from an app, or links to a site, to a profile." />
        ) : (
          rules.map((rule, i) => <RuleRow key={rule.id} rule={rule} index={i} last={i === rules.length - 1} profiles={profiles} />)
        )}
      </Group>

      <SectionHeader anchor="airTraffic.fallback" description={null} />
      <Group of="airTraffic.fallback">
        <FallbackRow profiles={profiles} />
      </Group>

      <HooksSection />

      <SectionHeader anchor="airTraffic.tryLink" description={null} />
      <TryLink />
    </View>
  );
}

function RuleRow({ rule, index, last, profiles }: { rule: AirTrafficRule; index: number; last: boolean; profiles: RoutableProfile[] }) {
  const target = targetLabel(rule, profiles);
  const more = async () => {
    const choice = await showMenu([
      { id: "edit", title: "Edit…" },
      { separator: true },
      { id: "up", title: "Move Up", enabled: index > 0 },
      { id: "down", title: "Move Down", enabled: !last },
      { separator: true },
      { id: "delete", title: "Delete" },
    ]);
    if (choice === "edit") showSettingsSheet(<RuleSheet rule={rule} />);
    else if (choice === "up" || choice === "down") moveAirTrafficRule(rule.id, choice === "up" ? -1 : 1);
    else if (choice === "delete") removeAirTrafficRule(rule.id);
  };
  return (
    <Row
      title={`${fromLabel(rule.from)} · ${conditionLabel(rule.when)} → ${target ?? "a deleted profile"}`}
      description={target ? null : "Its profile is gone, so this rule is skipped. Edit it to pick another."}
    >
      <Toggle value={rule.enabled} accessibilityLabel="Use this rule" onChange={(enabled) => updateAirTrafficRule(rule.id, { enabled })} />
      <Button variant="icon" icon="pencil" size="m" onPress={() => showSettingsSheet(<RuleSheet rule={rule} />)} tooltip="Edit" />
      <Button variant="icon" icon="ellipsis.circle" size="m" onPress={() => void more()} tooltip="Move or Delete" />
      <Button variant="icon" icon="trash" size="m" onPress={() => removeAirTrafficRule(rule.id)} tooltip="Delete" />
    </Row>
  );
}

function FallbackRow({ profiles }: { profiles: RoutableProfile[] }) {
  const { fallback } = useAirTrafficConfig();
  const options: Option<string>[] = [{ value: USUAL, title: "Ardia's usual routing" }, ...profileOptions(profiles).map((o, i) => ({ ...o, separatorBefore: i <= 1 }))];
  const value = !fallback ? USUAL : (fallback.profileId ?? "");
  const pick = (choice: string) => setAirTrafficFallback(choice === USUAL ? null : { profileId: choice || null, open: fallback?.open ?? "tab" });
  return (
    <Row anchor="airTraffic.fallback" description={fallback ? null : "They open as Settings › General says, in the profile you used last."}>
      <PopUp value={value} options={options} onChange={pick} minWidth={180} />
      {fallback ? <PopUp value={fallback.open} options={OPEN_OPTIONS} onChange={(open) => setAirTrafficFallback({ ...fallback, open })} /> : null}
    </Row>
  );
}

const HOOK_STATES: Record<LinkHookState, string> = { active: "On", approved: "Approved", waiting: "Waiting for approval", off: "Off" };

function hookSummary(hook: LinkHookRow): string {
  const from = hook.from.length ? `From ${hook.from.join(", ")}` : "Any app";
  const links = hook.patterns.length ? hook.patterns.join(", ") : "any link";
  return `${from} · ${links} → ${hook.answer} · ${HOOK_STATES[hook.state]}`;
}

function HooksSection() {
  const hooks = useLinkHooks();
  return (
    <>
      <SectionHeader anchor="airTraffic.hooks" action={<Button title="Automation…" onPress={() => goToSettingsPane("advanced")} />} />
      <Group of="airTraffic.hooks">
        {hooks.length === 0 ? <Row anchor="airTraffic.hooks" description="hooks.json has no link.opening hooks." /> : hooks.map((h) => <Row key={h.name} title={h.name} description={hookSummary(h)} />)}
      </Group>
    </>
  );
}

function landing(preview: Extract<LinkPreview, { ok: true }>): string {
  if (preview.dropped) return "Dropped: nothing opens.";
  return `Opens in ${preview.profileName}${preview.usedLast ? " (used last)" : ""} · ${OPEN_LABELS[preview.open]}`;
}

function caughtBy(preview: Extract<LinkPreview, { ok: true }>): { title: string; detail: string } {
  const trace = preview.trace;
  const lands = landing(preview);
  if (trace.by === "rule") return { title: `Rule ${trace.index + 1}: ${fromLabel(trace.rule.from)} · ${conditionLabel(trace.rule.when)}`, detail: lands };
  if (trace.by === "hook") return { title: `hooks.json: ${trace.hook}`, detail: lands };
  if (trace.by === "program") return { title: `hooks.json: ${trace.hook.name} asks ${trace.hook.program?.[0] ?? "a program"}`, detail: `If it doesn't answer: ${lands}` };
  if (trace.by === "fallback") return { title: "Everything Else", detail: lands };
  return { title: "No rule catches it", detail: `Ardia's usual routing. ${lands}` };
}

function TryLink() {
  const theme = useTheme();
  const { rules } = useAirTrafficConfig();
  const [app, setApp] = useState<SourceApp | null>(null);
  const [typed, setTyped] = useState("");
  const extras = useMemo(() => rules.map((r) => r.from), [rules]);
  const preview = typed.trim() ? previewLink(typed, app ? { bundleId: app.bundleId, appName: app.name } : null) : null;
  const result = preview?.ok ? caughtBy(preview) : null;
  return (
    <Group of="airTraffic.tryLink">
      <Row anchor="airTraffic.tryLink">
        <AppPicker value={app} onChange={(a) => setApp(a === "other" ? null : a)} anyTitle="An unknown app" extras={extras} />
      </Row>
      <Row title={<TextField value={typed} onChangeText={setTyped} placeholder="Paste a link, like github.com/ardia" />} />
      <Row
        icon={<Symbol name={result ? "airplane" : "link"} size={13} color={theme.icon} />}
        title={result?.title ?? (preview ? "That isn't a link Ardia can open." : "Type a link to see where it lands.")}
        description={result?.detail ?? null}
      />
    </Group>
  );
}
