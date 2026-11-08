import { useState } from "react";
import { closeSettingsSheet } from "../../../state/settings/sheet";
import { configureProvider, signInError, signInProvider, type VaultProviderState, type VaultSignInFields } from "../../../state/vaults/actions";
import { bitwardenServer, serverChoiceOf, type ServerChoice } from "../../../state/vaults/servers";
import { Button, DialogActions, PopUp, Sheet, TextField } from "../../ui";
import { FormField } from "../Form";
import { SheetError, SheetHead, SheetText, TouchIdRow, Waiting } from "../../vaults/VaultSheetParts";

const SERVER_OPTIONS: { value: ServerChoice; title: string }[] = [
  { value: "us", title: "Bitwarden.com" },
  { value: "eu", title: "Bitwarden.eu" },
  { value: "self", title: "Self-Hosted" },
];

type Step = { kind: "login" } | { kind: "code"; methods: { id: string; name: string }[] };

export function BitwardenSheet({ provider }: { provider: VaultProviderState }) {
  const [choice, setChoice] = useState<ServerChoice>(() => serverChoiceOf(provider.server));
  const [url, setUrl] = useState(() => (serverChoiceOf(provider.server) === "self" ? (provider.server ?? "") : ""));
  const [apiKey, setApiKey] = useState(false);
  const [email, setEmail] = useState(provider.account ?? "");
  const [password, setPassword] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [code, setCode] = useState("");
  const [method, setMethod] = useState("");
  const [step, setStep] = useState<Step>({ kind: "login" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const server = bitwardenServer(choice, url);
  const ready =
    !busy &&
    !!password &&
    (choice !== "self" || !!server) &&
    (apiKey ? !!clientId.trim() && !!clientSecret.trim() : !!email.trim()) &&
    (step.kind !== "code" || !!code.trim());

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError("");
    if (step.kind === "login" && (server ?? null) !== (provider.server ?? null)) await configureProvider(provider.id, server);
    const fields: VaultSignInFields = apiKey
      ? { clientId: clientId.trim(), clientSecret: clientSecret.trim(), password, ...(server ? { server } : {}) }
      : { email: email.trim(), password, ...(server ? { server } : {}) };
    if (step.kind === "code") Object.assign(fields, { code: code.trim(), ...(method ? { method } : {}) });
    const result = await signInProvider(provider.id, fields);
    setBusy(false);
    if (result.ok) {
      setPassword("");
      setClientSecret("");
      return closeSettingsSheet();
    }
    if (result.needs === "code") {
      const methods = result.methods ?? [];
      setMethod((m) => m || methods[0]?.id || "");
      setCode("");
      setError(step.kind === "code" ? signInError(result, provider.name) : "");
      return setStep({ kind: "code", methods });
    }
    setError(signInError(result, provider.name));
  };

  const back = () => {
    setStep({ kind: "login" });
    setError("");
  };

  return (
    <Sheet onClose={closeSettingsSheet}>
      <SheetHead provider={provider.id} title={step.kind === "code" ? "Two-Step Login" : `Connect ${provider.name}`} />
      {step.kind === "code" ? (
        <>
          <SheetText>Enter the code from your two-step login method.</SheetText>
          {step.methods.length > 1 ? (
            <FormField label="Method">
              <PopUp value={method} options={step.methods.map((m) => ({ value: m.id, title: m.name }))} onChange={setMethod} />
            </FormField>
          ) : null}
          <FormField label="Code">
            <TextField value={code} onChangeText={setCode} autoFocus mono width="100%" onSubmit={() => void submit()} />
          </FormField>
        </>
      ) : (
        <>
          <FormField label="Server">
            <PopUp value={choice} options={SERVER_OPTIONS} onChange={setChoice} />
          </FormField>
          {choice === "self" ? (
            <FormField label="Server URL">
              <TextField value={url} onChangeText={setUrl} placeholder="https://vault.example.com" width="100%" />
            </FormField>
          ) : null}
          {apiKey ? (
            <>
              <FormField label="Client ID">
                <TextField value={clientId} onChangeText={setClientId} placeholder="user.…" autoFocus width="100%" />
              </FormField>
              <FormField label="Client Secret">
                <TextField value={clientSecret} onChangeText={setClientSecret} secure width="100%" />
              </FormField>
            </>
          ) : (
            <FormField label="Email">
              <TextField value={email} onChangeText={setEmail} placeholder="name@example.com" autoFocus={!email} width="100%" />
            </FormField>
          )}
          <FormField label="Master Password">
            <TextField value={password} onChangeText={setPassword} secure autoFocus={!!email && !apiKey} width="100%" onSubmit={() => void submit()} />
          </FormField>
          <TouchIdRow provider={provider} />
        </>
      )}
      {busy ? <Waiting text={`Signing in to ${provider.name}…`} /> : <SheetError text={error} />}
      <DialogActions
        leading={
          step.kind === "code" ? (
            <Button title="Back" kind="plain" onPress={back} />
          ) : (
            <Button title={apiKey ? "Use Email" : "Use API Key"} kind="plain" onPress={() => (setError(""), setApiKey(!apiKey))} />
          )
        }
      >
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={step.kind === "code" ? "Continue" : "Sign In"} kind="primary" disabled={!ready} onPress={() => void submit()} />
      </DialogActions>
    </Sheet>
  );
}
