import { TurboModuleRegistry } from "react-native";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

type Subscription = { remove(): void };
type AppEvent = { type: string; dark?: boolean };

type Shell = {
  addListener(name: "onAppEvent", listener: (event: AppEvent) => void): Subscription;
  setAppearance(mode: "auto" | "light" | "dark"): Promise<void>;
  isDarkAppearance(): Promise<boolean>;
  copyText(text: string): void;
  readText(): Promise<string>;
};

type Dialogs = {
  confirm(options: { title: string; message?: string; confirmTitle?: string; cancelTitle?: string; destructive?: boolean; suppression?: string }): Promise<{ confirmed: boolean; suppressed: boolean }>;
  prompt(options: { title: string; message?: string; value?: string; placeholder?: string; confirmTitle?: string }): Promise<string | null>;
  pickFiles(): Promise<string[]>;
  pickFolder(current: string | null, prompt: string | null): Promise<string | null>;
};

type Notifications = {
  notificationPermission(): Promise<string>;
  requestNotificationPermission(): Promise<boolean>;
  postNotification(options: { title: string; body?: string }): Promise<string | null>;
  removeNotifications(ids: string[]): Promise<void>;
};

const shell = () => requireNativeModule<Shell>("ArdiaShell");
const dialogs = () => requireNativeModule<Dialogs>("ArdiaDialogs");
const notifications = () => requireNativeModule<Notifications>("ArdiaNotifications");
const settled = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, ms: number) {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline) await settled(25);
}

export const checks: Check[] = [
  {
    name: "shell: the shell, dialogs and notifications modules are native",
    run() {
      for (const name of ["ArdiaShell", "ArdiaDialogs", "ArdiaNotifications"]) expectTrue(TurboModuleRegistry.get(name), `${name} has no native module`);
    },
  },
  {
    name: "shell: the appearance follows setAppearance and reports each change",
    async run() {
      const system = await shell().isDarkAppearance();
      expectEqual(typeof system, "boolean", "isDarkAppearance");
      const seen: boolean[] = [];
      const subscription = shell().addListener("onAppEvent", (event) => {
        if (event.type === "appearance" && typeof event.dark === "boolean") seen.push(event.dark);
      });
      try {
        await shell().setAppearance("dark");
        expectEqual(await shell().isDarkAppearance(), true, "dark mode");
        await shell().setAppearance("light");
        expectEqual(await shell().isDarkAppearance(), false, "light mode");
        await shell().setAppearance("auto");
        expectEqual(await shell().isDarkAppearance(), system, "auto mode");
        const wanted = system ? [false, true] : [true, false];
        await waitFor(() => seen.length >= wanted.length, 2000);
        expectEqual(seen, wanted, "appearance events");
      } finally {
        subscription.remove();
        await shell().setAppearance("auto");
      }
    },
  },
  {
    name: "shell: copied text reads back from the clipboard",
    async run() {
      const text = `ardia self-check ${Date.now()} ✓ ünïcödé 日本語 🚀`;
      shell().copyText(text);
      expectEqual(await shell().readText(), text, "clipboard text");
    },
  },
  {
    name: "shell: a confirm in background mode answers its Cancel button",
    async run() {
      expectEqual(await dialogs().confirm({ title: "Self check", message: "Background confirm", suppression: "Don't ask again" }), { confirmed: false, suppressed: false }, "confirm with Cancel");
      expectEqual(await dialogs().confirm({ title: "Self check", destructive: true, confirmTitle: "Delete", cancelTitle: "Keep" }), { confirmed: true, suppressed: false }, "confirm without a Cancel button");
    },
  },
  {
    name: "shell: a prompt and the file panels in background mode answer cancelled",
    async run() {
      expectEqual(await dialogs().prompt({ title: "Self check", value: "typed", confirmTitle: "Save" }), null, "prompt");
      expectEqual(await dialogs().pickFiles(), [], "pickFiles");
      expectEqual(await dialogs().pickFolder(null, "Use Folder"), null, "pickFolder");
    },
  },
  {
    name: "shell: notifications answer as not set up yet",
    async run() {
      expectEqual(await notifications().notificationPermission(), "notDetermined", "notificationPermission");
      expectEqual(await notifications().requestNotificationPermission(), false, "requestNotificationPermission");
      expectEqual(await notifications().postNotification({ title: "Self check", body: "not shown" }), null, "postNotification");
      await notifications().removeNotifications(["self-check"]);
    },
  },
];
