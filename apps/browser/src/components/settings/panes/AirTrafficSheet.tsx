import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { addAirTrafficRule, removeAirTrafficRule, updateAirTrafficRule, type RuleDraft } from "../../../state/airTraffic/store";
import { patternProblem, siteHost, type AirTrafficRule, type LinkCondition, type OpenAs, type SourceApp } from "../../../state/airTraffic/rules";
import { pickableApps, sourceAppKey } from "../../../state/airTraffic/sourceApps";
import { useRecentSourceApps, useRoutableProfiles, type RoutableProfile } from "../../../state/airTraffic/hooks";
import { closeSettingsSheet } from "../../../state/settings/sheet";
import { Button, DialogActions, DialogTitle, PopUp, Sheet, space, Text, TextField, type Option } from "../../ui";

export const OPEN_LABELS: Record<OpenAs, string> = { tab: "New tab", window: "New window", littleArdia: "Little Ardia" };
export const OPEN_OPTIONS: Option<OpenAs>[] = [
  { value: "tab", title: OPEN_LABELS.tab },
  { value: "window", title: OPEN_LABELS.window },
  { value: "littleArdia", title: OPEN_LABELS.littleArdia },
];
export const USED_LAST = "Profile you used last";
const USED_LAST_VALUE = "";
const ANY = "any";
const OTHER = "other";

export const conditionLabel = (when: LinkCondition) => (when.kind === "any" ? "any link" : when.kind === "site" ? when.host : when.pattern);
export const fromLabel = (from: SourceApp | null) => (from ? `From ${from.name}` : "Any app");

export function profileOptions(profiles: RoutableProfile[], usedLast = USED_LAST): Option<string>[] {
  return [{ value: USED_LAST_VALUE, title: usedLast }, ...profiles.map((p, i) => ({ value: p.id, title: p.name, separatorBefore: i === 0 }))];
}

export function AppPicker({ value, onChange, anyTitle = "Any app", other, extras = [] }: { value: SourceApp | null; onChange: (app: SourceApp | null | "other") => void; anyTitle?: string; other?: boolean; extras?: readonly (SourceApp | null)[] }) {
  const lists = pickableApps(useRecentSourceApps(), [value, ...extras]);
  const byKey = new Map([...lists.recent, ...lists.common].map((a) => [sourceAppKey(a), a]));
  const options: Option<string>[] = [
    { value: ANY, title: anyTitle },
    ...lists.recent.map((a, i) => ({ value: sourceAppKey(a), title: a.name, separatorBefore: i === 0 })),
    ...lists.common.map((a, i) => ({ value: sourceAppKey(a), title: a.name, separatorBefore: i === 0 })),
    ...(other ? [{ value: OTHER, title: "Other…", separatorBefore: true }] : []),
  ];
  const pick = (key: string) => onChange(key === ANY ? null : key === OTHER ? "other" : (byKey.get(key) ?? null));
  return <PopUp value={value ? sourceAppKey(value) : ANY} options={options} onChange={pick} minWidth={180} />;
}

const KIND_OPTIONS: Option<LinkCondition["kind"]>[] = [
  { value: "any", title: "Any link" },
  { value: "site", title: "Links to a site" },
  { value: "pattern", title: "Links matching a pattern" },
];

function typedApp(text: string): SourceApp | null {
  const typed = text.trim();
  if (!typed) return null;
  return /^[\w-]+(\.[\w-]+)+$/.test(typed) ? { bundleId: typed, name: typed } : { bundleId: null, name: typed };
}

export function RuleSheet({ rule }: { rule?: AirTrafficRule }) {
  const profiles = useRoutableProfiles();
  const [from, setFrom] = useState<SourceApp | null>(rule?.from ?? null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [kind, setKind] = useState<LinkCondition["kind"]>(rule?.when.kind ?? "any");
  const [text, setText] = useState(rule?.when.kind === "site" ? rule.when.host : rule?.when.kind === "pattern" ? rule.when.pattern : "");
  const [profileId, setProfileId] = useState(rule?.profileId ?? profiles[0]?.id ?? USED_LAST_VALUE);
  const [open, setOpen] = useState<OpenAs>(rule?.open ?? "tab");
  const [error, setError] = useState<string | null>(null);

  const pickApp = (app: SourceApp | null | "other") => {
    setTyping(app === "other");
    if (app !== "other") setFrom(app);
  };
  const save = () => {
    const app = typing ? typedApp(typed) : from;
    if (typing && !app) return setError("Type the app's name or bundle ID, like com.tinyspeck.slackmacgap.");
    let when: LinkCondition = { kind: "any" };
    if (kind === "site") {
      const host = siteHost(text);
      if (!host) return setError("Enter a site, like github.com. Its subdomains count too.");
      when = { kind: "site", host };
    } else if (kind === "pattern") {
      const problem = patternProblem(text);
      if (problem) return setError(`That pattern doesn't work: ${problem}.`);
      when = { kind: "pattern", pattern: text.trim() };
    }
    const draft: RuleDraft = { enabled: rule?.enabled ?? true, from: app, when, profileId: profileId || null, open };
    if (rule) updateAirTrafficRule(rule.id, draft);
    else if (!addAirTrafficRule(draft)) return setError("That's the most rules Ardia keeps. Remove one first.");
    closeSettingsSheet();
  };

  return (
    <Sheet onClose={closeSettingsSheet}>
      <DialogTitle subtitle="Links from other apps that fit this rule open where you choose.">{rule ? "Edit Rule" : "Add Rule"}</DialogTitle>
      <Line label="From">
        <AppPicker value={typing ? null : from} onChange={pickApp} other />
      </Line>
      {typing ? (
        <View style={FIELD_BELOW}>
          <TextField value={typed} onChangeText={setTyped} placeholder="App name or bundle ID" autoFocus onSubmit={save} onEscape={closeSettingsSheet} />
        </View>
      ) : null}
      <Line label="Links">
        <PopUp value={kind} options={KIND_OPTIONS} onChange={(k) => (setKind(k), setError(null))} minWidth={180} />
      </Line>
      {kind !== "any" ? (
        <View style={FIELD_BELOW}>
          <TextField value={text} onChangeText={setText} placeholder={kind === "site" ? "github.com" : "https://*.example.com/docs/*"} mono={kind === "pattern"} onSubmit={save} onEscape={closeSettingsSheet} />
        </View>
      ) : null}
      <Line label="Open in">
        <PopUp value={profileId} options={profileOptions(profiles)} onChange={setProfileId} minWidth={180} />
      </Line>
      <Line label="As">
        <PopUp value={open} options={OPEN_OPTIONS} onChange={setOpen} minWidth={180} />
      </Line>
      {error ? (
        <Text size="caption" tone="destructive" style={ERROR}>
          {error}
        </Text>
      ) : null}
      <DialogActions
        leading={rule ? <Button title="Remove" kind="destructive" onPress={() => (removeAirTrafficRule(rule.id), closeSettingsSheet())} /> : null}
      >
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={rule ? "Save" : "Add"} kind="primary" onPress={save} />
      </DialogActions>
    </Sheet>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={LINE}>
      <Text size="caption" tone="textSecondary" style={LINE_LABEL}>
        {label}
      </Text>
      {children}
    </View>
  );
}

const LINE = { marginTop: space.l, flexDirection: "row", alignItems: "center", gap: space.ml } as const;
const LABEL_WIDTH = 52;
const LINE_LABEL = { width: LABEL_WIDTH, textAlign: "right" } as const;
const ERROR = { marginTop: space.ml } as const;
const FIELD_BELOW = { marginTop: space.s, marginLeft: LABEL_WIDTH + space.ml } as const;
