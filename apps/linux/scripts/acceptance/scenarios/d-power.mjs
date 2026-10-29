import { setTimeout as delay } from "node:timers/promises";
import { desktopShot, desktopUnavailable, focusShellWindow, openDesktop, startDesktopBrowser, waitFocused } from "../lib/desktopSession.mjs";
import { startPowerProfiles, startUPower } from "../lib/desktopServices.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";

const ACTIVATED = "Battery Saver Mode Activated";
const DEACTIVATED = "Battery Saver Mode Deactivated";
const PROPERTIES = "org.freedesktop.DBus.Properties";

async function systemState(shell) {
  const reply = await shell.call("engine.systemState", {});
  if (!reply.ok) throw new Error(`engine.systemState: ${reply.code} ${reply.message}`);
  return reply.value;
}

async function timed(shell, test, label, timeout = 5000) {
  const started = Date.now();
  const value = await until(async () => {
    const state = await systemState(shell);
    return test(state) ? state : false;
  }, { timeout, interval: 100, label });
  return { state: value, ms: Date.now() - started };
}

const saverOn = (shell) => shell.eval("ardiaLinux.lifecycle.state.getState().batterySaver", { timeout: 3000 });
const hasText = (shell, text) => shell.eval(`document.body.innerText.includes(${JSON.stringify(text)})`, { timeout: 3000 }).catch(() => false);

async function toastsIn(shells, text) {
  const out = [];
  for (const shell of shells) if (await hasText(shell, text)) out.push(shell.windowId);
  return out;
}

export default {
  id: "F18D",
  issue: 28,
  desktop: true,
  title: "UPower and power-profiles-daemon mocks on a private system bus drive onBattery, lowPowerMode and one Battery Saver toast",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["dbusmock"] });
    if (missing) {
      t.manual("Battery transitions", ["With Battery Saver set to When unplugged, unplug: onBattery is reported at once and one Battery Saver toast shows in the focused window only; plugging in turns it off."], missing);
      t.manual("Power profile", ["Switch power-profiles-daemon to power-saver: lowPowerMode turns on at once and Battery Saver activates."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const upower = await startUPower(desktop, { onBattery: false });
    await upower.call("SetupDisplayDevice", [2, 1, 80.0, 40.0, 50.0, 10.0, 0, 3600, true, "battery-good-charging-symbolic", 1], { signature: "uuddddxxbsu" });
    const profiles = await startPowerProfiles(desktop);
    const session = sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }, { id: "second", urls: [t.fixtures.url.page(2)] }], focused: "main", settings: { batterySaverWhen: "unplugged" } });
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "power", session });
    const second = await app.shell("second", { timeout: 25000 });
    const main = await until(async () => (await desktop.windows()).find((w) => w.title.includes("Acceptance page 1")) ?? false, { timeout: 15000, label: "the first window" });
    await focusShellWindow(desktop, shell, main).catch(() => {});
    await waitFocused(desktop, (w) => w.id === main.id, { label: "the first window focused" });
    await t.check("on AC power with a balanced profile Ardia reports UPower, no battery use and no low-power mode", async () => {
      const { state } = await timed(shell, (s) => s.power === "upower" && s.onBattery === false && s.lowPowerMode === false, "UPower on AC");
      if (await saverOn(shell)) throw new Error("Battery Saver is on while plugged in");
      return { power: state.power, batteryLevel: state.batteryLevel };
    }, { critical: true });
    await t.check("unplugging reports onBattery at once and shows one Battery Saver toast, in the focused window only", async () => {
      await upower.call("Set", ["org.freedesktop.UPower", "OnBattery", true], { iface: PROPERTIES, signature: "ssv" });
      await upower.call("SetDeviceProperties", ["/org/freedesktop/UPower/devices/DisplayDevice", { State: 2 }], { signature: "oa{sv}" }).catch(() => {});
      const { ms } = await timed(shell, (s) => s.onBattery === true, "onBattery after unplugging", 5000);
      if (ms > 2000) throw new Error(`onBattery took ${ms} ms`);
      await until(() => saverOn(shell), { timeout: 5000, label: "Battery Saver to turn on" });
      await until(async () => (await toastsIn([shell], ACTIVATED)).length, { timeout: 5000, label: "the Battery Saver toast in the focused window" });
      await delay(1000);
      const shown = await toastsIn([shell, second], ACTIVATED);
      await desktopShot(t, desktop, "battery-saver-on");
      if (shown.length !== 1 || shown[0] !== shell.windowId) throw new Error(`toast shown in ${JSON.stringify(shown)}`);
      return { ms, shown };
    });
    await t.check("plugging back in reports AC at once and turns Battery Saver off", async () => {
      await upower.call("Set", ["org.freedesktop.UPower", "OnBattery", false], { iface: PROPERTIES, signature: "ssv" });
      const { ms } = await timed(shell, (s) => s.onBattery === false, "onBattery off after plugging in", 5000);
      await until(async () => !(await saverOn(shell)), { timeout: 5000, label: "Battery Saver to turn off" });
      const shown = await toastsIn([shell, second], DEACTIVATED);
      if (shown.length > 1) throw new Error(`deactivation toast in ${JSON.stringify(shown)}`);
      return { ms, shown };
    });
    await t.check("switching power-profiles-daemon to power-saver turns lowPowerMode on at once and Battery Saver activates", async () => {
      await profiles.call("Set", ["net.hadess.PowerProfiles", "ActiveProfile", "power-saver"], { iface: PROPERTIES, signature: "ssv" });
      const { ms } = await timed(shell, (s) => s.lowPowerMode === true, "lowPowerMode after power-saver", 5000);
      if (ms > 2000) throw new Error(`lowPowerMode took ${ms} ms`);
      await until(() => saverOn(shell), { timeout: 5000, label: "Battery Saver to turn on in power-saver" });
      await profiles.call("Set", ["net.hadess.PowerProfiles", "ActiveProfile", "balanced"], { iface: PROPERTIES, signature: "ssv" });
      await timed(shell, (s) => s.lowPowerMode === false, "lowPowerMode off after balanced", 5000);
      return { ms };
    });
    await t.check("when UPower leaves the bus the power source becomes unavailable with no battery", async () => {
      await upower.stop();
      const { state } = await timed(shell, (s) => s.power === "unavailable", "power unavailable after UPower left", 8000);
      if (state.onBattery !== false || state.batteryLevel !== null) throw new Error(JSON.stringify(state));
      return { power: state.power };
    });
    await t.stop(app);
  },
};
