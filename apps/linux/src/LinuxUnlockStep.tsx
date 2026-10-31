import { useEffect, useSyncExternalStore } from "react";
import { View } from "react-native";
import { Button, TextField } from "../../browser/src/components/ui";
import { ErrorText, Handoff, Spacer, Title } from "../../browser/src/components/import/Parts";
import { importLayout } from "../../browser/src/components/import/tokens";
import { backTo, importNow, importsBySpaces, patchImport, type ImportFlow } from "../../browser/src/state/import/flow";
import { importModule } from "../../browser/src/state/import/importApi";
import { runImport } from "../../browser/src/state/import/runImport";
import { asksPrimaryPassword, createSecretSlot, unlockCopy, unlockSource, withoutEncrypted } from "./importUnlock";

const primaryPassword = createSecretSlot();

function useTypedSecret() {
  return useSyncExternalStore(primaryPassword.subscribe, primaryPassword.get);
}

const unlockStep = (unlocking: boolean, error: string | null) => patchImport({ step: { name: "unlock", unlocking, error } });

async function unlock() {
  const { source, sourceProfiles, kinds, step } = importNow();
  if (!source || step.name !== "unlock" || step.unlocking) return;
  if (asksPrimaryPassword(source, sourceProfiles) && !primaryPassword.get()) return;
  unlockStep(true, null);
  const failure = await unlockSource(importModule(), source, sourceProfiles, kinds, primaryPassword);
  if (importNow().step.name !== "unlock") return;
  unlockStep(false, failure);
  if (!failure) void runImport(importNow().kinds);
}

function skipEncrypted(source: NonNullable<ImportFlow["source"]>) {
  primaryPassword.clear();
  const without = withoutEncrypted(source, importNow().kinds);
  patchImport({ kinds: without });
  void runImport(without, true);
}

export function UnlockBody({ flow }: { flow: ImportFlow }) {
  const { source, sourceProfiles, kinds, step } = flow;
  const typed = useTypedSecret();
  useEffect(() => () => primaryPassword.clear(), []);
  if (!source || step.name !== "unlock") return null;
  const { error } = step;
  const copy = unlockCopy(source, sourceProfiles, kinds);
  return (
    <>
      <Title title={copy.title} subtitle={copy.subtitle} />
      <Handoff iconPath={source.iconPath} symbol="lock.fill" maxWidth={importLayout.textMax} lead={copy.lead} detail={copy.detail} />
      {copy.field && (
        <View style={{ alignSelf: "center", width: 260, marginTop: 16 }}>
          <TextField
            value={typed}
            onChangeText={primaryPassword.set}
            placeholder="Primary password"
            secure
            autoFocus
            onSubmit={() => void unlock()}
          />
        </View>
      )}
      {error && <ErrorText text={error} />}
    </>
  );
}

export function UnlockFooter({ flow }: { flow: ImportFlow }) {
  const { source, kinds, sourceProfiles, step } = flow;
  const typed = useTypedSecret();
  if (!source || step.name !== "unlock") return null;
  const { unlocking } = step;
  const copy = unlockCopy(source, sourceProfiles, kinds);
  return (
    <>
      <Button title="Back" onPress={() => backTo(source.profiles.length > 1 || importsBySpaces(source) ? "profiles" : "choose")} />
      <Spacer />
      <Button title="Skip Encrypted Data" onPress={() => skipEncrypted(source)} />
      <Button
        title={unlocking ? copy.waiting : "Continue"}
        kind="primary"
        disabled={unlocking || (copy.field && !typed)}
        onPress={() => void unlock()}
      />
    </>
  );
}
