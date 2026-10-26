import { Button } from "../../ui";
import { APP } from "../model";
import { ErrorText, Handoff, Spacer, Title } from "../Parts";
import { importLayout } from "../tokens";
import type { ImportFlow } from "../useImportFlow";

export function UnlockBody({ flow }: { flow: ImportFlow }) {
  const { source, sourceProfiles, error } = flow;
  if (!source) return null;
  const many = sourceProfiles.length > 1;
  return (
    <>
      <Title
        title="Unlock your data for import"
        subtitle={`${APP} can securely import logins, cookies and cards from your previous browser, so you stay signed in and don't have to enter your passwords again.`}
      />
      <Handoff
        iconPath={source.iconPath}
        symbol="lock.fill"
        maxWidth={importLayout.textMax}
        lead={
          many
            ? `Some data is encrypted, so macOS will ask for your computer password once for each selected profile.`
            : `Some data is encrypted, so macOS will ask for your computer password to bring it securely into ${APP}.`
        }
        detail={`macOS may ask whether ${APP} can use “${source.keychainService ?? `${source.name} Safe Storage`}” from your keychain: it's the key ${source.name} encrypts passwords, cookies, cards and open tabs with. Click Allow. Your data stays on this Mac.`}
      />
      {error && <ErrorText text={error} />}
    </>
  );
}

export function UnlockFooter({ flow }: { flow: ImportFlow }) {
  const { source, bySpaces, kinds, unlocking } = flow;
  if (!source) return null;
  return (
    <>
      <Button title="Back" onPress={() => flow.setStep(source.profiles.length > 1 || bySpaces ? "profiles" : "choose")} />
      <Spacer />
      <Button
        title="Skip Encrypted Data"
        onPress={() => {
          const without = new Set(kinds);
          without.delete("passwords");
          without.delete("cookies");
          flow.setKinds(without);
          void flow.run(without, true);
        }}
      />
      <Button title={unlocking ? "Waiting for password..." : "Continue"} kind="primary" disabled={unlocking} onPress={() => void flow.unlock()} />
    </>
  );
}
