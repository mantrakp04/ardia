import type { ReactNode } from "react";
import { View } from "react-native";
import { Button, space } from "../../ui";
import { APP, DIA_NOT_SHARED } from "../model";
import { ErrorText, Handoff, SettingsSteps, Spacer, TargetPicker, Title } from "../Parts";
import { importLayout } from "../tokens";
import type { ImportFlow } from "../useImportFlow";

function DiaState({ flow }: { flow: ImportFlow }): ReactNode {
  const { api, source, diaStatus } = flow;
  if (diaStatus === "checking" || diaStatus === "reading") return <Title title="Reading Dia's tabs" subtitle="Asking Dia for its profiles, open tabs and pinned tabs..." spinner />;
  if (diaStatus === "notInstalled") return <Title title="Dia isn't installed" subtitle={`Install Dia and open it to import its tabs into ${APP}.`} />;
  if (diaStatus === "notRunning")
    return (
      <>
        <Title title="Open Dia to import its tabs" subtitle={`${APP} asks Dia for its tabs, so Dia has to be running. Open it and this continues on its own.`} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.ml }}>
          <Button title="Open Dia" kind="primary" onPress={() => void flow.openDia()} />
          <Button title="Check Again" onPress={() => void flow.refreshDia()} />
        </View>
      </>
    );
  if (diaStatus === "notDetermined")
    return (
      <>
        <Title title={`Allow ${APP} to read Dia's tabs`} subtitle="Dia shares its tabs through AppleScript, and macOS asks you before an app can use it." />
        <Handoff
          iconPath={source?.iconPath}
          symbol="square.on.square"
          maxWidth={importLayout.diaTextMax}
          lead={`When you continue, macOS asks whether “${APP}” may control “Dia”. Click Allow, and ${APP} asks Dia for its profiles, open tabs and pinned tabs. It only reads them: nothing in Dia changes.`}
          detail={DIA_NOT_SHARED}
        />
      </>
    );
  if (diaStatus === "denied")
    return (
      <>
        <Title title={`${APP} can't read Dia's tabs`} subtitle={`macOS doesn't allow ${APP} to control Dia. You can allow it in System Settings › Privacy & Security › Automation.`} />
        <SettingsSteps
          steps={["Click “Open Automation Settings” below", `Under ${APP}, turn on Dia`, "Come back here: we'll continue automatically"]}
          openTitle="Open Automation Settings"
          onOpen={() => void api?.openAutomationSettings()}
          onRecheck={() => void flow.refreshDia()}
        />
      </>
    );
  return (
    <>
      <Title title="Import tabs from Dia" subtitle={DIA_NOT_SHARED} />
      <Button title="Try Again" onPress={() => void flow.readDia()} />
    </>
  );
}

export function DiaBody({ flow }: { flow: ImportFlow }) {
  if (!flow.source) return null;
  return (
    <>
      <DiaState flow={flow} />
      {flow.error && <ErrorText text={flow.error} />}
    </>
  );
}

export function DiaFooter({ flow }: { flow: ImportFlow }) {
  const { source, diaStatus, asking } = flow;
  if (!source) return null;
  return (
    <>
      <Button title="Back" onPress={() => flow.setStep("choose")} />
      <Spacer />
      <TargetPicker target={flow.target} onChange={flow.setTarget} />
      <Button title="Cancel" onPress={flow.close} />
      {diaStatus === "notDetermined" && <Button title={asking ? "Waiting for macOS..." : "Continue"} kind="primary" disabled={asking} onPress={() => void flow.allowDia()} />}
    </>
  );
}
