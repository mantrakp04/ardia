import { permissionWarnings } from "@ardia/core";
import { Image, Pressable, ScrollView } from "react-native";
import { cancelInstall, closePinDialog, confirmInstall, setPinned, useWindowExtensions, type InstallRequest } from "../../state/extensions/actions";
import { useExtensionProfile } from "../../state/extensions/hooks";
import type { InstalledExtension } from "../../state/extensions/store";
import { currentShownPageId } from "../../state/peek/actions";
import { webviews } from "../../state/tabs/webviewHandles";
import { Box, Button, Checkbox, Dialog, Text } from "../ui";
import { space } from "../ui/tokens";
import { DIALOG_TITLE, DIALOG_WIDTH } from "./tokens";

function focusShownPage(windowId: string) {
  const tabId = currentShownPageId(windowId);
  if (tabId) void webviews.get(tabId)?.focus();
}

export function InstallDialog({ request }: { request: InstallRequest }) {
  const pkg = request.status === "ready" || request.status === "installing" ? request.pkg : null;
  const prompt = request.status === "prompt" ? request.prompt : null;
  const name = pkg?.name ?? prompt?.name ?? "Extension";
  const icon = pkg?.icon ?? (prompt?.icon || null);
  const warnings = prompt ? prompt.permissions : pkg ? permissionWarnings(pkg) : [];
  const kind = prompt?.type;
  const title = kind === "re-enable" ? `Turn “${name}” back on?` : kind === "permissions" ? `“${name}” needs new permissions` : `Add “${name}”?`;
  const action = kind === "re-enable" ? "Turn On" : kind === "permissions" ? "Allow" : "Add Extension";
  const busy = request.status === "installing";

  let body;
  if (request.status === "error") {
    body = (
      <>
        <Text weight="semibold" style={DIALOG_TITLE}>Couldn't add the extension</Text>
        <Text tone="textSecondary" style={{ marginTop: space.s }}>{request.error}</Text>
      </>
    );
  } else {
    body = (
      <>
        <Box row gap="l" style={ALIGN_CENTER}>
          {icon ? <Image source={{ uri: icon }} style={{ width: 36, height: 36 }} /> : null}
          <Text weight="semibold" style={[FLEX, DIALOG_TITLE]}>{title}</Text>
        </Box>
        {warnings.length ? (
          <>
            <Text style={{ marginTop: space.lx, marginBottom: space.s }}>It can:</Text>
            <ScrollView style={{ maxHeight: 180 }}>
              {warnings.map((w) => (
                <Box key={w} row gap="sm" style={{ marginBottom: space.xs }}>
                  <Text tone="textSecondary">•</Text>
                  <Text tone="textSecondary" style={FLEX}>{w}</Text>
                </Box>
              ))}
            </ScrollView>
          </>
        ) : (
          <Text tone="textSecondary" style={{ marginTop: space.lx }}>This extension requires no special permissions.</Text>
        )}
        {request.source === "unpacked" ? (
          <Text numberOfLines={2} ellipsizeMode="middle" size="caption" tone="textTertiary" style={{ marginTop: space.ml }}>
            {`Loaded from ${pkg?.path ?? ""}`}
          </Text>
        ) : null}
      </>
    );
  }

  return (
    <Dialog
      width={DIALOG_WIDTH}
      animated
      onDismiss={busy ? undefined : cancelInstall}
      onSubmit={request.status === "error" ? cancelInstall : () => void confirmInstall()}
      restoreFocus={() => focusShownPage(request.windowId)}
    >
      {body}
      <Box row gap="m" style={{ justifyContent: "flex-end", marginTop: space.xlx }}>
        {request.status === "error" ? (
          <Button variant="pill" title="OK" primary onPress={cancelInstall} />
        ) : (
          <>
            <Button variant="pill" title="Cancel" onPress={cancelInstall} />
            <Button variant="pill" title={request.status === "installing" ? "Adding…" : action} primary onPress={() => void confirmInstall()} />
          </>
        )}
      </Box>
    </Dialog>
  );
}

export function PinDialog({ windowId }: { windowId: string }) {
  const profile = useExtensionProfile(windowId);
  const list = useWindowExtensions(windowId);
  const close = closePinDialog;
  return (
    <Dialog width={DIALOG_WIDTH} animated onDismiss={close} onSubmit={close} restoreFocus={() => focusShownPage(windowId)}>
      <Text weight="semibold" style={DIALOG_TITLE}>Pin Extensions</Text>
      <Text tone="textSecondary" style={{ marginTop: space.xs, marginBottom: space.l }}>
        Pinned extensions appear in the toolbar, next to the address.
      </Text>
      {list.length ? (
        <ScrollView style={{ maxHeight: 300 }}>
          {list.map((ext) => (
            <PinRow key={ext.id} ext={ext} onChange={(pinned) => void setPinned(profile, ext.id, pinned)} />
          ))}
        </ScrollView>
      ) : (
        <Text tone="textTertiary">No extensions are turned on.</Text>
      )}
      <Box row style={{ justifyContent: "flex-end", marginTop: space.xl }}>
        <Button variant="pill" title="Done" primary onPress={close} />
      </Box>
    </Dialog>
  );
}

function PinRow({ ext, onChange }: { ext: InstalledExtension; onChange: (pinned: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!ext.pinned)} style={PIN_ROW}>
      <Checkbox value={ext.pinned} onChange={onChange} />
      <Image source={{ uri: ext.actionIcon || ext.icon }} style={{ width: 16, height: 16 }} />
      <Text numberOfLines={1} style={FLEX}>
        {ext.name}
      </Text>
    </Pressable>
  );
}

const FLEX = { flex: 1 } as const;
const ALIGN_CENTER = { alignItems: "center" } as const;
const PIN_ROW = { flexDirection: "row", alignItems: "center", gap: space.ml, paddingVertical: space.s } as const;
