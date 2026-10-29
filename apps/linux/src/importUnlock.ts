import type { BrowserSource, ImportKind } from "../../../packages/import/src/index.ts";

type LinuxProfile = BrowserSource["profiles"][number] & { needsPrimaryPassword?: boolean; cardsNeedKeyring?: boolean };

export const APP_NAME = "Ardia";
export const FIREFOX_CARD_KEY = "Firefox Encrypted Storage";

const chosen = (source: BrowserSource, selected: readonly string[]) =>
  (source.profiles as LinuxProfile[]).filter((profile) => selected.length === 0 || selected.includes(profile.id));

export const asksPrimaryPassword = (source: BrowserSource, selected: readonly string[]) =>
  source.family === "firefox" && chosen(source, selected).some((profile) => profile.needsPrimaryPassword === true);

const readsCardKey = (source: BrowserSource, selected: readonly string[], kinds: Iterable<ImportKind>) =>
  source.family === "firefox" && [...kinds].includes("autofill") && chosen(source, selected).some((profile) => profile.cardsNeedKeyring === true);

export type UnlockCopy = { title: string; subtitle: string; lead: string; detail: string; field: boolean; waiting: string };

export function unlockCopy(source: BrowserSource, selected: readonly string[], kinds: Iterable<ImportKind>): UnlockCopy {
  const title = "Unlock your data for import";
  const subtitle = `${APP_NAME} can securely import logins, cookies and cards from your previous browser, so you stay signed in and don't have to enter your passwords again.`;
  if (source.family === "firefox") {
    const field = asksPrimaryPassword(source, selected);
    const cards = readsCardKey(source, selected, kinds);
    const keyring = `${source.name} keeps saved card numbers under “${FIREFOX_CARD_KEY}” in your system keyring, which may ask whether ${APP_NAME} can read it.`;
    return {
      title,
      subtitle,
      field,
      lead: field
        ? `${source.name}'s saved passwords are protected by a primary password. Enter it to bring them securely into ${APP_NAME}.`
        : `Some of ${source.name}'s data is encrypted, so your system keyring may ask for your password to bring it securely into ${APP_NAME}.`,
      detail: [
        field ? `${APP_NAME} uses it only for this import, never saves it, and forgets it after 10 minutes.` : "",
        cards ? keyring : "",
        "Your data stays on this computer.",
      ].filter(Boolean).join(" "),
      waiting: field ? "Unlocking..." : "Waiting for the keyring...",
    };
  }
  const item = source.keychainService ?? `${source.name} Safe Storage`;
  const many = selected.length > 1;
  return {
    title,
    subtitle,
    field: false,
    lead: many
      ? `Some data is encrypted, so your system keyring may ask for your password once for each selected profile.`
      : `Some data is encrypted, so your system keyring may ask for your password to bring it securely into ${APP_NAME}.`,
    detail: `${APP_NAME} asks your system keyring (Secret Service or KWallet) for “${item}”: it's the key ${source.name} encrypts passwords, cookies, cards and open tabs with. Allow it when asked. Your data stays on this computer.`,
    waiting: "Waiting for the keyring...",
  };
}

export function unlockFailure(source: BrowserSource, code: string | undefined): string {
  const retry = "Try again, or skip the encrypted data.";
  const firefox = source.family === "firefox";
  switch (code) {
    case "denied":
      return firefox
        ? `That isn't ${source.name}'s primary password, or the system keyring didn't allow access. ${retry}`
        : `The system keyring didn't allow access to ${source.keychainService ?? `${source.name} Safe Storage`}. ${retry}`;
    case "locked":
      return `The system keyring is locked. Unlock it, then try again, or skip the encrypted data.`;
    case "notFound":
      return firefox
        ? `The system keyring has no “${FIREFOX_CARD_KEY}” key, so ${source.name}'s saved card numbers can't be read. Skip the encrypted data to import the rest.`
        : `The system keyring has no ${source.keychainService ?? `${source.name} Safe Storage`} key, so ${source.name}'s encrypted data can't be read. Skip the encrypted data to import the rest.`;
    case "unavailable":
      return `No system keyring (Secret Service or KWallet) answered. Start one, then try again, or skip the encrypted data.`;
    case "timeout":
      return `The system keyring didn't answer in time. ${retry}`;
    case "cancelled":
      return `The unlock was cancelled. ${retry}`;
    default:
      return `${source.name}'s encrypted data couldn't be unlocked. ${retry}`;
  }
}

export function withoutEncrypted(source: BrowserSource, kinds: ReadonlySet<ImportKind>): Set<ImportKind> {
  const without = new Set(kinds);
  without.delete("passwords");
  if (source.family !== "firefox") without.delete("cookies");
  return without;
}

type Listener = () => void;

export function createSecretSlot() {
  let value = "";
  const listeners = new Set<Listener>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => value,
    set(next: string) {
      value = next;
      notify();
    },
    take() {
      const taken = value;
      value = "";
      notify();
      return taken;
    },
    clear() {
      if (!value) return;
      value = "";
      notify();
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type UnlockApi = {
  unlockBrowser(browserId: string, options?: { primaryPassword?: string; profiles?: readonly string[]; kinds?: readonly string[] }): Promise<void>;
};

export async function unlockSource(
  api: UnlockApi,
  source: BrowserSource,
  selected: readonly string[],
  kinds: Iterable<ImportKind>,
  slot: ReturnType<typeof createSecretSlot>,
) {
  const primaryPassword = asksPrimaryPassword(source, selected) ? slot.take() : "";
  slot.clear();
  try {
    const scope = { profiles: [...selected], kinds: [...kinds] };
    await api.unlockBrowser(source.id, primaryPassword ? { primaryPassword, ...scope } : scope);
    return null;
  } catch (error) {
    return unlockFailure(source, (error as { code?: string } | null)?.code);
  }
}
