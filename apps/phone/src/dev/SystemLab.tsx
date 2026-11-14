import { defaultBrowser, favicons, network, system, type DefaultBrowserStatus, type SystemLink } from "@ardia/phone-native";
import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";

const linkLine = (link: SystemLink | null) => (link ? JSON.stringify(link) : "none");

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function SystemLab({ note }: { note: (line: string) => void }) {
  const [initial, setInitial] = useState<string>("asking…");
  const [links, setLinks] = useState<string[]>([]);
  const [status, setStatus] = useState<DefaultBrowserStatus | null>(null);
  const [hidden, setHidden] = useState(false);

  const refresh = useCallback(() => {
    defaultBrowser.status().then(
      (next) => {
        setStatus(next);
        console.log(`PAGELAB system default browser ${JSON.stringify(next)}`);
      },
      (error: { message?: string }) => note(`default browser status ✗ ${error.message ?? ""}`),
    );
  }, [note]);

  useEffect(() => {
    system.initialLink().then(
      (link) => {
        setInitial(linkLine(link));
        console.log(`PAGELAB system initial ${linkLine(link)}`);
      },
      (error: { message?: string }) => setInitial(`✗ ${error.message ?? ""}`),
    );
    const subscription = system.addLinkListener((link) => {
      const line = linkLine(link);
      console.log(`PAGELAB system link ${line}`);
      note(`system link ${line}`);
      setLinks((all) => [line, ...all].slice(0, 6));
    });
    const online = network.addListener((event) => {
      console.log(`PAGELAB system network ${event.online ? "online again" : "lost"}`);
      note(`network ${event.online ? "online again" : "lost"}`);
    });
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    refresh();
    return () => {
      subscription.remove();
      online.remove();
      foreground.remove();
    };
  }, [note, refresh]);

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>System</Text>
      <Text style={styles.line}>initial link: {initial}</Text>
      <Text style={styles.line}>links: {links.length ? links.join("\n") : "none yet"}</Text>
      <Text style={styles.line}>online now: {String(network.isOnline())}</Text>
      <Text style={styles.line}>default browser: {status ? `isDefault ${status.isDefault} · canAsk ${status.canAsk}` : "-"}</Text>
      <View style={styles.row}>
        <Button label="Refresh" onPress={refresh} />
        <Button label="Request role" onPress={() => defaultBrowser.requestRole().then(
          (granted) => {
            note(`requestRole → ${granted}`);
            console.log(`PAGELAB system requestRole ${granted}`);
            refresh();
          },
          (error: { message?: string }) => note(`requestRole ✗ ${error.message ?? ""}`),
        )} />
        <Button label="Default apps settings" onPress={() => defaultBrowser.openDefaultAppsSettings().catch((error: { message?: string }) => note(`settings ✗ ${error.message ?? ""}`))} />
        <Button label="Favicon looks" onPress={() => {
          const icons = ["https://github.com/favicon.ico", "https://www.apple.com/favicon.ico", "https://www.wikipedia.org/static/favicon/wikipedia.ico"];
          for (const icon of icons) {
            Promise.all([favicons.look(icon, true), favicons.look(icon, false)]).then(([dark, light]) => {
              const line = `favicon ${icon.split("/")[2]}: ${dark?.tone ?? "unreadable"}, backing dark ${dark?.backing ?? "none"}, light ${light?.backing ?? "none"}`;
              console.log(`PAGELAB system ${line}`);
              note(line);
            });
          }
        }} />
        <Button label={hidden ? "Show in Recents" : "Hide from Recents"} onPress={() => system.setHidesFromRecents(!hidden).then((done) => {
          note(`hide from recents ${!hidden} → ${done}`);
          if (done) setHidden(!hidden);
        })} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#e9f2e4", padding: 6, borderRadius: 6, gap: 4 },
  title: { fontSize: 13, fontWeight: "700", color: "#1d1a17" },
  line: { fontSize: 11, color: "#1d1a17" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  button: { backgroundColor: "#cfe0c6", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6 },
  buttonText: { fontSize: 13, color: "#1d1a17" },
});
