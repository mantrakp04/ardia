import { useMemo, useState } from "react";
import { View } from "react-native";
import { useAirTrafficConfig, useLinkHooks, useRoutableProfiles, useRouteGroupName, type LinkHookRow, type LinkHookState, type RoutableProfile } from "../../../state/airTraffic/hooks";
import { moveAirTrafficRule, removeAirTrafficRule, setAirTrafficFallback, updateAirTrafficRule } from "../../../state/airTraffic/store";
import { previewLink, type LinkPreview } from "../../../state/airTraffic/preview";
import type { OpeningTrace } from "../../../state/automation/decisions";
import type { AirTrafficRule, AirTrafficTarget, SourceApp } from "../../../state/airTraffic/rules";
import { showMenu } from "../../../state/app/system";
import { goToSettingsPane } from "../../../state/settings/settingsWindows";
import { showSettingsSheet } from "../../../state/settings/sheet";
import { Button, PopUp, Symbol, TextField, Toggle, useTheme, type Option } from "../../ui";
import { Group, PaneIntro, Row, SectionHeader } from "../Form";
import { AppPicker, CLOSED_GROUP, conditionLabel, fromLabel, GroupPicker, OPEN_LABELS, OPEN_OPTIONS, profileOptions, RuleSheet, USED_LAST } from "./AirTrafficSheet";

const USUAL = "usual";

function targetLabel(target: AirTrafficTarget, profiles: RoutableProfile[], groupName: string | null): string | null {
  const profile = target.profileId === null ? USED_LAST : profiles.find((p) => p.id === target.profileId)?.name;
  if (!profile) return null;
  return target.groupKey ? `${profile} › ${groupName ?? CLOSED_GROUP}` : `${profile} · ${OPEN_LABELS[target.open]}`;
}

function ruleProblem(target: string | null, groupGone: boolean): string | null {
  if (!target) return "Its profile is gone, so this rule is skipped. Edit it to pick another.";
  return groupGone ? "Its tab group is gone, so this rule is skipped. Edit it to pick another." : null;
}

export function AirTrafficPane() {
  const { rules } = useAirTrafficConfig();
  const profiles = useRoutableProfiles();
  return (
    <View>
      <PaneIntro>
        Send links from other apps to the profile you want, as a new tab, a new window, Little Ardia or into a tab group. A rule for any app can
        also take the links you click and the addresses you type in Ardia.
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
  const groupName = useRouteGroupName(rule.profileId, rule.groupKey);
  const target = targetLabel(rule, profiles, groupName);
  const groupGone = !!rule.groupKey && !groupName;
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
      title={`${fromLabel(rule.from)}${rule.inside ? " and Ardia" : ""} · ${conditionLabel(rule.when)} → ${target ?? "a deleted profile"}`}
      description={ruleProblem(target, groupGone)}
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
  const pick = (choice: string) => setAirTrafficFallback(choice === USUAL ? null : { profileId: choice || null, open: fallback?.open ?? "tab", ...(choice === fallback?.profileId && fallback.groupKey ? { groupKey: fallback.groupKey } : {}) });
  return (
    <Row anchor="airTraffic.fallback" description={fallback ? null : "They open as Settings › General says, in the profile you used last."}>
      <PopUp value={value} options={options} onChange={pick} minWidth={180} />
      {fallback ? <PopUp value={fallback.open} options={OPEN_OPTIONS} onChange={(open) => setAirTrafficFallback({ ...fallback, open })} /> : null}
      {fallback?.profileId && fallback.open === "tab" ? (
        <GroupPicker profileId={fallback.profileId} value={fallback.groupKey ?? ""} onChange={(groupKey) => setAirTrafficFallback({ ...fallback, groupKey: groupKey || undefined })} />
      ) : null}
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
  const where = preview.groupName ? ` › ${preview.groupName}` : "";
  return `Opens in ${preview.profileName}${preview.usedLast ? " (used last)" : ""}${where} · ${OPEN_LABELS[preview.open]}`;
}

function openingNote(opening: OpeningTrace): string {
  if (opening.by === "rewrite") return ` hooks.json: ${opening.hook} changes the link to ${opening.url} first.`;
  if (opening.by === "program") return ` hooks.json: ${opening.hook.name} may change the link first; this shows it unchanged.`;
  return "";
}

function caughtBy(preview: Extract<LinkPreview, { ok: true }>): { title: string; detail: string } {
  const opening = preview.opening;
  if (opening.by === "cancel") return { title: `hooks.json: ${opening.hook} blocks it`, detail: "Nothing opens." };
  const trace = preview.trace!;
  const lands = landing(preview) + openingNote(opening);
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
