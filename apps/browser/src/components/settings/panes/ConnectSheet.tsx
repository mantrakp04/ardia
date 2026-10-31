import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { live } from "../../../state/live/store";
import { settingsBrowserWindow } from "../../../state/settings/settingsWindows";
import { focusWindow } from "../../../state/windows/nativeWindow";
import { Button, font, Sheet, TextField, weight } from "../../ui";
import { Favicon } from "../../favicon/Favicon";
import { SheetTitle } from "../Form";
import { closeSettingsSheet } from "../../../state/settings/sheet";

export type ConnectProps = { busy: boolean; run(task: () => Promise<void>): Promise<void> };

export function ConnectSheet({ name, site, children }: { name: string; site: string; children(props: ConnectProps): ReactNode }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      closeSettingsSheet();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet width={460} onClose={closeSettingsSheet}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Favicon url={site} size={22} />
        <SheetTitle style={{ flex: 1 }}>Connect {name}</SheetTitle>
      </View>
      {children({ busy, run })}
      {error ? <Text style={{ marginTop: 10, ...font.small, color: theme.destructive }}>{error}</Text> : null}
    </Sheet>
  );
}

export function Help({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={{ ...font.small, lineHeight: 17, color: theme.textSecondary, marginBottom: 10 }}>{children}</Text>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4, marginBottom: 10 }}>
      <Text style={{ ...font.small, fontWeight: weight.medium, color: theme.textPrimary }}>{label}</Text>
      {children}
    </View>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>{children}</View>;
}

type GoogleConnectProps = ConnectProps & {
  api: string;
  reads: string;
  connect(windowId: string, clientId: string, clientSecret: string): Promise<void>;
};

export function GoogleConnect({ busy, run, api, reads, connect }: GoogleConnectProps) {
  const [clientId, setClientId] = useState(live().config.googleClientId);
  const [secret, setSecret] = useState("");
  const go = () =>
    void run(async () => {
      const windowId = settingsBrowserWindow();
      if (!windowId) throw new Error("Open a browser window first");
      void focusWindow(windowId);
      await connect(windowId, clientId, secret);
    });
  return (
    <View>
      <Help>
        In Google Cloud Console, enable the {api} API and create an OAuth client of type "Desktop app" (add yourself as a test user). Ardia opens Google's consent page in a tab and reads the result from its redirect; it asks only to {reads}.
      </Help>
      <Field label="Client ID">
        <TextField value={clientId} onChangeText={setClientId} placeholder="…apps.googleusercontent.com" />
      </Field>
      <Field label="Client secret">
        <TextField value={secret} onChangeText={setSecret} secure />
      </Field>
      <Actions>
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title={busy ? "Waiting for Google…" : "Sign In with Google…"} kind="primary" disabled={!clientId.trim() || !secret.trim() || busy} onPress={go} />
      </Actions>
    </View>
  );
}
