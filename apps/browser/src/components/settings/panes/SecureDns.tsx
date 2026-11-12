import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { openUrls } from "../../../state/browser/actions";
import { useResource } from "../../../state/settings/resources";
import {
  checkCustomSecureDns,
  chooseSecureDns,
  reloadSecureDns,
  saveCustomSecureDns,
  secureDns,
  secureDnsChoice,
  secureDnsEditableTemplates,
  secureDnsHosts,
  secureDnsLocked,
  watchSecureDns,
  type SecureDnsChoice,
  type SecureDnsState,
} from "../../../state/settings/secureDns";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { Button, DialogActions, DialogTitle, PopUp, Sheet, space, Text, TextField, Toggle } from "../../ui";
import { FormField, Group, Row, SectionHeader } from "../Form";

const NETWORK = "network";
const CUSTOM = "custom";
const PROVIDER = "provider:";

const onlyThrough = (who: string, many: boolean) =>
  many ? `Only ${who} look up sites. If none of them can be reached, sites don't load.` : `Only ${who} looks up sites. If it can't be reached, sites don't load.`;

function customDescription(templates: string, fallback: boolean): string {
  const hosts = secureDnsHosts(templates);
  const many = hosts.includes(", ");
  if (!fallback) return onlyThrough(hosts, many);
  return many ? `Uses ${hosts} when they answer, and your network's DNS, unencrypted, when they don't.` : `Uses ${hosts} when it answers, and your network's DNS, unencrypted, when it doesn't.`;
}

function toggleDescription(state: SecureDnsState | null | undefined, choice: SecureDnsChoice | null): string | undefined {
  if (state === undefined) return undefined;
  if (state === null) return "Ardia couldn't read this setting. It shows here once it can.";
  if (state.policy) return state.effectiveMode === "off" ? "Turned off by your organization." : "Set by your organization.";
  if (state.override === "managed") return "Off because this Mac has an organization's policies.";
  if (state.override === "parentalControls") return "Off because parental controls are on.";
  if (choice?.kind === "network") return "Uses your network's DNS provider, encrypted when it supports that and unencrypted when it doesn't.";
  if (choice?.kind === "provider") return onlyThrough(choice.provider.name, false);
  if (choice?.kind === "custom") return customDescription(choice.templates, choice.fallback);
  return "Sites are looked up through your network's DNS, unencrypted.";
}

function providerValue(choice: SecureDnsChoice | null): string {
  if (choice?.kind === "provider") return PROVIDER + choice.provider.id;
  if (choice?.kind === "custom") return CUSTOM;
  return NETWORK;
}

export function SecureDnsSection() {
  const [state] = useResource(secureDns);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const sub = watchSecureDns();
    return () => sub.remove();
  }, []);
  const choice = state ? secureDnsChoice(state) : null;
  const locked = !state || secureDnsLocked(state);
  const on = !!state && (locked ? state.effectiveMode !== "off" : choice?.kind !== "off");

  const choose = (next: Exclude<SecureDnsChoice, { kind: "custom" }>) => {
    setBusy(true);
    void chooseSecureDns(next)
      .catch(() => reloadSecureDns())
      .finally(() => setBusy(false));
  };
  const pick = (value: string) => {
    if (value === CUSTOM) return showSettingsSheet(<CustomProviderSheet initial={choice?.kind === "custom" ? secureDnsEditableTemplates(choice.templates) : ""} />);
    const provider = state?.providers.find((p) => PROVIDER + p.id === value);
    choose(provider ? { kind: "provider", provider } : { kind: "network" });
  };
  const customTitle = choice?.kind === "custom" ? `Custom (${secureDnsHosts(choice.templates)})${choice.fallback ? ", with fallback" : ""}` : "Custom…";
  const options = [
    { value: NETWORK, title: "Your network's provider" },
    ...(state?.providers ?? []).map((p, i) => ({ value: PROVIDER + p.id, title: p.name, separatorBefore: i === 0 })),
    { value: CUSTOM, title: customTitle, separatorBefore: true },
  ];

  return (
    <>
      <SectionHeader
        title="Secure DNS"
        description="Looks up sites over an encrypted connection, in every profile and private window on this Mac. Sites that open in WebKit and Ardia's own requests use your Mac's DNS."
      />
      <Group>
        <Row anchor="privacy.secureDns" description={toggleDescription(state, choice)}>
          <Toggle value={on} disabled={locked || busy} onChange={(v) => choose({ kind: v ? "network" : "off" })} />
        </Row>
        <Row anchor="privacy.secureDnsProvider">
          <View style={ACTIONS}>
            {choice?.kind === "provider" && !!choice.provider.privacyPolicy && <Button title="Privacy Policy" onPress={() => openUrls([choice.provider.privacyPolicy])} />}
            {choice?.kind === "custom" && !locked && <Button title="Edit…" disabled={busy} onPress={() => pick(CUSTOM)} />}
            <PopUp value={providerValue(choice)} options={options} disabled={locked || busy || !on} onChange={pick} minWidth={210} />
          </View>
        </Row>
      </Group>
    </>
  );
}

const PROBLEMS = {
  invalid: "That isn't a DNS-over-HTTPS address. It starts with https://, like https://dns.example.com/dns-query.",
  unverified: "Ardia couldn't verify this provider. Check the address, or save it anyway.",
  failed: "Ardia couldn't check or save it. Try again in a moment.",
} as const;

function CustomProviderSheet({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [problem, setProblem] = useState<keyof typeof PROBLEMS | null>(null);
  const [checking, setChecking] = useState(false);
  const attempt = useRef(0);
  useEffect(
    () => () => {
      attempt.current++;
    },
    [],
  );
  const save = async (unchecked: boolean) => {
    if (checking) return;
    const mine = ++attempt.current;
    const current = () => attempt.current === mine;
    setChecking(true);
    const check = unchecked ? "ok" : await checkCustomSecureDns(text);
    if (!current() || check === "cancelled") return;
    if (check !== "ok") {
      setChecking(false);
      return setProblem(check);
    }
    const stored = await saveCustomSecureDns(text).then(
      () => true,
      () => false,
    );
    if (!current()) return;
    setChecking(false);
    if (!stored) return setProblem("failed");
    closeSettingsSheet();
  };
  const edit = (value: string) => {
    attempt.current++;
    setChecking(false);
    setText(value);
    setProblem(null);
  };
  return (
    <Sheet onClose={closeSettingsSheet}>
      <DialogTitle subtitle="Every profile and private window will look up sites only through it, and sites won't load when it can't be reached. Separate several addresses with spaces.">
        Custom DNS Provider
      </DialogTitle>
      <FormField label="DNS-over-HTTPS address">
        <TextField value={text} onChangeText={edit} placeholder="https://dns.example.com/dns-query" onSubmit={() => void save(false)} onEscape={closeSettingsSheet} invalid={problem === "invalid"} autoFocus mono />
      </FormField>
      {problem && (
        <Text size="caption" tone="destructive" style={ERROR}>
          {PROBLEMS[problem]}
        </Text>
      )}
      <DialogActions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        {problem === "unverified" && <Button title="Save Anyway" disabled={checking} onPress={() => void save(true)} />}
        <Button title={checking ? "Checking…" : "Save"} kind="primary" disabled={checking || !text.trim()} onPress={() => void save(false)} />
      </DialogActions>
    </Sheet>
  );
}

const ACTIONS = { flexDirection: "row", alignItems: "center", gap: space.s } as const;
const ERROR = { marginTop: space.ml } as const;
