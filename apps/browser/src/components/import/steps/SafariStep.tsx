import { Image, View } from "react-native";
import { Button, Checkbox, space, Text } from "../../ui";
import { APP } from "../model";
import { ErrorText, FileDrop, FullDiskAccessSteps, Spacer, TargetPicker, Title } from "../Parts";
import { importLayout } from "../tokens";
import { backTo, closeImport, recheckAccess, setImportTarget, setSafariCookies, type ImportFlow } from "../../../state/import/flow";
import { chooseSafariExport, importSafariDirect, importSafariExport, openFullDiskAccessSettings } from "../../../state/import/fileImports";

const EXPORT_STEPS = ["Open Safari", "File menu › Export Browsing Data to File", `Upload the .zip file to ${APP}`];

export function SafariBody({ flow }: { flow: ImportFlow }) {
  const { source, fullDiskAccess, safariCookies, step } = flow;
  const error = step.name === "safari" ? step.error : null;
  const drop = <FileDrop onFile={(path) => void importSafariExport(path)} onChoose={chooseSafariExport} />;
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
              <Checkbox label="Cookies (stay signed in)" value={safariCookies} onChange={setSafariCookies} />
            </View>
          </View>
          <Button title="Import from Safari" kind="primary" onPress={() => void importSafariDirect()} />
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
      <FullDiskAccessSteps onOpen={openFullDiskAccessSettings} onRecheck={() => void recheckAccess()} />
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
      <Button title="Back" onPress={() => backTo("choose")} />
      <Spacer />
      <TargetPicker target={flow.target} onChange={setImportTarget} />
      <Button title="Cancel" onPress={closeImport} />
    </>
  );
}

export function AccessBody({ flow }: { flow: ImportFlow }) {
  const { source } = flow;
  if (!source) return null;
  return (
    <>
      <Title
        title={`Give ${APP} access to ${source.name}`}
        subtitle={`macOS protects ${source.name}'s data from other apps. To import your bookmarks, history, tabs, passwords and cookies, ${APP} needs Full Disk Access.`}
      />
      <FullDiskAccessSteps onOpen={openFullDiskAccessSettings} onRecheck={() => void recheckAccess()} />
    </>
  );
}

export function AccessFooter({ flow }: { flow: ImportFlow }) {
  if (!flow.source) return null;
  return (
    <>
      <Button title="Back" onPress={() => backTo("choose")} />
      <Spacer />
      <Button title="Cancel" onPress={closeImport} />
    </>
  );
}
