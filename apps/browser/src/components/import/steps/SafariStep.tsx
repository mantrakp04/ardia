import { Image, View } from "react-native";
import { Button, Checkbox, space, Text } from "../../ui";
import { APP } from "../model";
import { ErrorText, FileDrop, FullDiskAccessSteps, Spacer, TargetPicker, Title } from "../Parts";
import { importLayout } from "../tokens";
import type { ImportFlow } from "../useImportFlow";

const EXPORT_STEPS = ["Open Safari", "File menu › Export Browsing Data to File", `Upload the .zip file to ${APP}`];

export function SafariBody({ flow }: { flow: ImportFlow }) {
  const { api, source, fullDiskAccess, safariCookies, error } = flow;
  const drop = <FileDrop onFile={(path) => void flow.importSafari(path)} onChoose={flow.chooseSafariExport} />;
  if (fullDiskAccess)
    return (
      <>
        <Title title="Import from Safari" subtitle={`Ardia can read Safari directly. Bring your bookmarks, history, Reading List, open tabs and sign-ins into ${APP}.`} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.l, marginBottom: space.xlx }}>
          {source?.iconPath ? <Image source={{ uri: `file://${source.iconPath}` }} style={{ width: importLayout.safariIcon, height: importLayout.safariIcon }} /> : null}
          <View style={{ flex: 1 }}>
            <Text weight="semibold">Bookmarks, history, Reading List and tabs</Text>
            <Text size="small" tone="textSecondary" style={{ marginTop: 1 }}>
              Full Disk Access is granted.
            </Text>
            <View style={{ marginTop: space.m }}>
              <Checkbox label="Cookies (stay signed in)" value={safariCookies} onChange={flow.setSafariCookies} />
            </View>
          </View>
          <Button title="Import from Safari" kind="primary" onPress={() => void flow.importSafariDirect()} />
        </View>
        <Text size="small" weight="semibold" tone="textSecondary" style={{ marginBottom: space.m }}>
          Passwords and payment cards can't be read directly — import them from an export file:
        </Text>
        {drop}
        {error && <ErrorText text={error} />}
      </>
    );
  return (
    <>
      <Title title="Give Ardia access to Safari" subtitle={`To import Safari's bookmarks, history and tabs directly, ${APP} needs Full Disk Access.`} />
      <FullDiskAccessSteps onOpen={() => void api?.openFullDiskAccessSettings()} onRecheck={() => void flow.recheckAccess()} />
      <Text size="small" weight="semibold" tone="textSecondary" style={{ marginBottom: space.m }}>
        Or import everything (including passwords) from an export file:
      </Text>
      <View style={{ gap: space.s, marginBottom: space.l }}>
        {EXPORT_STEPS.map((t, i) => (
          <Text key={t} size="small" tone="textSecondary">{`${i + 1}. ${t}`}</Text>
        ))}
      </View>
      {drop}
      {error && <ErrorText text={error} />}
    </>
  );
}

export function SafariFooter({ flow }: { flow: ImportFlow }) {
  return (
    <>
      <Button title="Back" onPress={() => flow.setStep("choose")} />
      <Spacer />
      <TargetPicker target={flow.target} onChange={flow.setTarget} />
      <Button title="Cancel" onPress={flow.close} />
    </>
  );
}

export function AccessBody({ flow }: { flow: ImportFlow }) {
  const { api, source, error } = flow;
  if (!source) return null;
  return (
    <>
      <Title
        title={`Give ${APP} access to ${source.name}`}
        subtitle={`macOS protects ${source.name}'s data from other apps. To import your bookmarks, history, tabs, passwords and cookies, ${APP} needs Full Disk Access.`}
      />
      <FullDiskAccessSteps onOpen={() => void api?.openFullDiskAccessSettings()} onRecheck={() => void flow.recheckAccess()} />
      {error && <ErrorText text={error} />}
    </>
  );
}

export function AccessFooter({ flow }: { flow: ImportFlow }) {
  if (!flow.source) return null;
  return (
    <>
      <Button title="Back" onPress={() => flow.setStep("choose")} />
      <Spacer />
      <Button title="Cancel" onPress={flow.close} />
    </>
  );
}
