import { visibleUnsupported } from "../lib/assertions.mjs";
import { startBrowser } from "../lib/flows.mjs";
import { until } from "../lib/util.mjs";

const STARTUP_PROBLEM = /ArdiaSystem|ArdiaApp|ERR_UNAVAILABLE|startup failed|Unhandled|unhandledrejection/;

async function paneText(settings, pane) {
  await settings.clickText(pane, { timeout: 6000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  return settings.text();
}

export default {
  id: "F26",
  issue: 36,
  title: "Unsupported platform settings are hidden and startup has no backend rejections",
  deadline: 180000,
  manual: [
    { name: "Default browser registration and autostart survive restart", steps: ["When Linux default-browser and login-item backends land, the rows reappear in Settings › General.", "Set Ardia as default (xdg-settings get default-web-browser shows ardia.desktop) and enable Open at login (~/.config/autostart/ardia.desktop exists).", "Restart the session; both still hold and a link from another app opens in Ardia."], reason: "the Linux backends are not implemented; the rows are hidden until they are" },
    { name: "Streaming sites keep Chromium's identity", steps: ["Open a DRM streaming site (for example a Widevine test page).", "navigator.userAgent and the Sec-CH-UA brands report Chromium, and playback starts."], reason: "needs Widevine and a real network" },
    { name: "Custom header dragging moves the window", steps: ["On Hyprland and on X11, drag the window by its sidebar header; the window moves and double-click maximizes."], reason: "needs pointer input through the compositor" },
    { name: "Page scroll bar style applies to real pages", steps: ["When the scroll bar choice is supported, switch System/Thin, restart, and scroll a long page; the scroll bar style matches and startup logs no errors."], reason: "the scroll bar backend is not implemented; the row is hidden" },
  ],
  async run(t) {
    const { app, shell } = await startBrowser(t, { name: "settings" });
    let settings;
    await t.check("Settings opens as a utility window", async () => {
      await shell.command("openSettings");
      settings = await app.shell("settings", { timeout: 20000 });
      await until(async () => (await settings.text()).includes("General"), { timeout: 10000, label: "Settings navigation" });
      return true;
    }, { critical: true });
    const texts = {};
    await t.check("the Engines pane is not offered", async () => {
      texts.General = await settings.text();
      if (texts.General.split("\n").some((line) => line.trim() === "Engines")) throw new Error("the Engines pane is listed");
      return true;
    });
    await t.check("no unsupported row is shown in General, Appearance or Advanced", async () => {
      texts.General = await paneText(settings, "General");
      texts.Appearance = await paneText(settings, "Appearance");
      await settings.state("s.updateSettings({ showAdvancedSettings: true }); return true;");
      texts.Advanced = await paneText(settings, "Advanced");
      await t.evidence("settings-panes", texts);
      const shown = visibleUnsupported(texts);
      if (shown.length) throw new Error(`shown: ${shown.join(", ")}`);
      return { panes: Object.keys(texts) };
    });
    await t.check("startup logged no backend rejections", async () => {
      const problems = [...shell.problems, ...settings.problems].filter((p) => STARTUP_PROBLEM.test(p.text ?? ""));
      const log = (await app.logText()).split("\n").filter((line) => line.includes("CONSOLE") && STARTUP_PROBLEM.test(line));
      if (problems.length || log.length) throw new Error(JSON.stringify({ problems, log: log.slice(0, 10) }));
      return { checkedMessages: shell.problems.length + settings.problems.length };
    });
    await t.screenshot(settings, "settings");
  },
};
