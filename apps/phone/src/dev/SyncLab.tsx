import { sync, syncLab, type PhoneInbox, type ReceivedTab, type SyncedView, type SyncStatus } from "@ardia/phone-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

const localTime = (at: number) => {
  const time = new Date(at);
  return [time.getHours(), time.getMinutes(), time.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
};

const countBookmarks = (items: { url: string | null; children: unknown[] | null }[]): number =>
  items.reduce((sum, item) => sum + (item.url ? 1 : 0) + countBookmarks((item.children ?? []) as never), 0);

const viewLine = (view: SyncedView | null) => {
  if (!view) return "view: -";
  const macs = view.devices.filter((device) => device.kind === "mac" && !device.isCurrent);
  const profile = view.profiles.find((p) => p.syncId === view.shownProfileId);
  const macTabs = profile ? profile.deviceTabs.reduce((sum, device) => sum + device.tabs.length, 0) : 0;
  const pinned = profile ? profile.pinned.tiles.length + profile.pinned.sections.length : 0;
  return [
    `devices ${view.devices.length} (Macs ${macs.map((mac) => mac.name).join(", ") || "none"})`,
    `profiles ${view.profiles.length}: ${view.profiles.map((p) => `${p.syncId === view.shownProfileId ? "›" : ""}${p.name}${p.isDefault ? " (default)" : ""}`).join(", ")}, picked ${view.selectedProfileId ?? "none"}`,
    `shown ${profile?.name ?? "-"}: open tabs ${macTabs}, pinned ${pinned}, bookmarks ${profile ? countBookmarks(profile.bookmarks) : 0}, history ${profile?.history.length ?? 0}`,
    `receivers ${view.receivers.map((device) => device.name).join(", ") || "none"}, search ${view.search?.engineId ?? "-"}, synced ${view.syncedAt ? localTime(view.syncedAt) : "-"}`,
  ].join("\n");
};

const statusLine = (status: SyncStatus | null) =>
  status
    ? `${status.phase}${status.isSyncing ? " (cycling)" : ""} · ${status.statusText} · attention ${status.attention}${status.stalledMessage ? ` · ${status.stalledMessage}` : ""}\nfolder ${status.folderName ?? "-"} · device "${status.deviceName}" · pending ${status.pendingDownloads} · last ${status.lastSynced ? `${localTime(status.lastSynced)} (${Math.round((Date.now() - status.lastSynced) / 1000)} s ago)` : "-"}${status.showsResetNotice ? " · RESET NOTICE" : ""}\ninboxProblem ${status.inboxProblem ?? "none"}`
    : "status: -";

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function SyncLab({ note }: { note: (line: string) => void }) {
  const [phrase, setPhrase] = useState("");
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [view, setView] = useState<SyncedView | null>(null);
  const [incoming, setIncoming] = useState<ReceivedTab[]>([]);
  const [inbox, setInbox] = useState<PhoneInbox[]>([]);
  const check = phrase.trim() ? sync.check(phrase) : null;
  const [, setClock] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setClock((tick) => tick + 1), 5_000);
    return () => clearInterval(timer);
  }, []);

  const run = useCallback(
    (label: string, work: () => Promise<unknown>) => {
      note(`sync ${label}…`);
      work().then(
        (result) => note(`sync ${label} → ${JSON.stringify(result ?? null).slice(0, 140)}`),
        (error: { code?: string; message?: string }) => note(`sync ${label} ✗ ${error.code ?? ""} ${error.message ?? ""}`),
      );
    },
    [note],
  );

  const refreshInbox = useCallback(() => {
    sync.inbox().then(setInbox, () => undefined);
  }, []);

  useEffect(() => {
    const subscription = sync.addListener((event) => {
      if (event.name === "sync.status") setStatus(event.status);
      else if (event.name === "sync.view") setView(event.view);
      else if (event.name === "sync.incoming") {
        setIncoming(event.tabs);
        note(`sync incoming ${event.tabs.map((tab) => `${tab.title} from ${tab.fromDevice}`).join(", ")}`);
      } else refreshInbox();
    });
    sync.status().then(setStatus, () => undefined);
    sync.view().then(setView, () => undefined);
    sync.incoming().then(setIncoming, () => undefined);
    refreshInbox();
    return () => subscription.remove();
  }, [note, refreshInbox]);

  const firstReceiver = view?.receivers[0];

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Sync</Text>
      <Text style={styles.line}>{statusLine(status)}</Text>
      <TextInput
        style={styles.input}
        value={phrase}
        onChangeText={setPhrase}
        placeholder="24-word recovery phrase"
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        accessibilityLabel="Recovery phrase"
      />
      <Text style={styles.line}>{check ? `${check.counterText}${check.problem ? ` · ${check.problem}` : ""}${check.isValid ? " · valid" : ""}` : "type or paste the phrase"}</Text>
      <View style={styles.row}>
        <Button label="Connect" onPress={() => run("connect", () => sync.connect(phrase))} />
        <Button label="Change folder" onPress={() => run("change folder", () => sync.changeFolder())} />
        <Button label="Sync now" onPress={() => run("sync now", () => sync.syncNow())} />
        <Button label="Stop syncing" onPress={() => run("stop", () => sync.stopSyncing())} />
      </View>
      <View style={styles.row}>
        <Button label="Ack reset" onPress={() => run("acknowledge reset", () => sync.acknowledgeReset())} />
        <Button label="Rename device" onPress={() => run("rename", () => sync.setDeviceName(`Lab ${localTime(Date.now()).slice(0, 5)}`))} />
        <Button label="Damage inbox" onPress={() => run("damage inbox", async () => {
          const result = await syncLab.damageInbox();
          const after = await sync.status();
          setStatus(after);
          console.log(`PAGELAB sync inbox damaged: status inboxProblem ${after.inboxProblem ?? "none"}`);
          return { inboxProblem: after.inboxProblem };
        })} />
        <Button label="Runtime checks" onPress={() => {
          note("runtime checks: running in a second sync runtime");
          syncLab.runtimeChecks().then(
            (checks) => {
              for (const check of checks) {
                const line = `PAGELAB ${check.pass ? "PASS" : "FAIL"} sync runtime ${check.name}${check.pass ? "" : `: device ${check.actual} · node ${check.expected}`}`;
                console.log(line);
                note(line.replace("PAGELAB ", "").slice(0, 400));
              }
              note(`runtime checks: ${checks.filter((check) => check.pass).length} of ${checks.length} pass`);
            },
            (error: { message?: string }) => note(`runtime checks ✗ ${error.message ?? ""}`),
          );
        }} />
        <Button label="Next profile" onPress={() => {
          const profiles = view?.profiles ?? [];
          if (!profiles.length) return;
          const index = profiles.findIndex((p) => p.syncId === view?.shownProfileId);
          const next = profiles[(index + 1) % profiles.length]!;
          run(`select ${next.name}`, () => sync.selectProfile(next.syncId));
        }} />
        <Button label="Edited" onPress={() => {
          sync.localDidChange();
          note("sync localDidChange sent");
        }} />
      </View>
      <View style={styles.row}>
        <Button label={firstReceiver ? `Send to ${firstReceiver.name}` : "Send (no Mac)"} onPress={() => {
          if (!firstReceiver) return note("sync send: no device receives tabs in this profile");
          run("send", () => sync.send({ url: "https://example.com/?from=page-lab", title: "From the page lab", deviceId: firstReceiver.id, profileSyncId: view?.selectedProfileId ?? null }));
        }} />
        <Button label="Pin to Mac" onPress={() => run("pin", () => sync.pinToMac({ url: "https://example.org/?pinned=page-lab", title: "Pinned from the page lab", profileSyncId: view?.selectedProfileId ?? null }))} />
        <Button label="Clear incoming" onPress={() => run("clear incoming", () => sync.clearIncoming().then(() => setIncoming([])))} />
        <Button label="Apply inbox" onPress={() => run("inbox applied", () => sync.inboxApplied(inbox.map((entry) => entry.id)).then(refreshInbox))} />
      </View>
      <Text style={styles.line}>{viewLine(view)}</Text>
      <Text style={styles.line}>
        incoming {incoming.length} · inbox {inbox.length} entries: {inbox.reduce((n, entry) => n + entry.received.length, 0)} received tabs,{" "}
        {inbox.reduce((n, entry) => n + entry.removals.reduce((m, removal) => m + removal.urls.length, 0), 0)} removed history urls
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#e4ecf7", padding: 6, borderRadius: 6, gap: 4 },
  title: { fontSize: 13, fontWeight: "700", color: "#1d1a17" },
  line: { fontSize: 11, color: "#1d1a17" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  button: { backgroundColor: "#c9d6ea", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6 },
  buttonText: { fontSize: 13, color: "#1d1a17" },
  input: { minHeight: 44, borderWidth: 1, borderColor: "#999", borderRadius: 6, paddingHorizontal: 6, fontSize: 12, color: "#1d1a17", backgroundColor: "#fff" },
});
