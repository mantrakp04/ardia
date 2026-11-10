import { type SettingSection } from "./types";
import type { SettingsPane } from "../../../state/settings/settingsWindows";

export const privacyRows = {
  privacy: [
    {
      section: "Content blocking",
      rows: {
        blockAds: { title: "Block ads", keywords: ["ad blocker", "adblock", "ublock origin", "easylist"] },
        blockTrackers: { title: "Block trackers", keywords: ["tracking", "easyprivacy", "fingerprinting"] },
        blockCookieBanners: { title: "Block cookie banners", keywords: ["cookies", "consent", "gdpr", "popups"] },
        filterLists: {
          advanced: true,
          title: "Advanced Settings",
          description: "Block common components found across the web by using additional rules and filters.",
          keywords: ["filter lists", "annoyances", "malware", "regional", "ad block settings"],
        },
      },
    },
    {
      section: "Site permissions",
      rows: {
        sitePermissions: {
          title: "Site permissions",
          description: "Pop-ups, camera, location and other permissions you've set for sites.",
          keywords: ["camera", "microphone", "location", "notifications", "popups", "cookies", "javascript", "clear site data", "website settings"],
        },
      },
    },
    { section: "Apps allowed to open links", rows: { appLinks: { advanced: true, title: "Apps allowed to open links", description: "Sites that open another app without asking first.", keywords: ["external apps", "protocol handlers", "zoom links"] } } },
    {
      section: "Zoom",
      rows: {
        commandScrollZoom: {
          title: "Zoom with ⌘ and the mouse wheel",
          description: "Sites that use ⌘-scroll themselves, like maps, still get it. ⌘+, ⌘− and ⌘0 zoom either way.",
          keywords: ["scroll wheel", "command scroll", "cmd scroll", "mouse zoom", "accidental zoom", "page zoom"],
        },
      },
    },
    {
      section: "Crash reports and usage",
      rows: {
        shareDiagnostics: { title: "Share anonymous crash reports and usage stats", keywords: ["telemetry", "analytics", "diagnostics", "crash"] },
        whatsSent: { title: "What's Sent", description: "Every field, and what never leaves this Mac.", keywords: ["telemetry", "data collection", "ardia command", "cli"] },
      },
    },
  ],
  passwords: [
    {
      section: "Password Managers",
      rows: {
        managers: {
          title: "Password Managers",
          keywords: ["1password", "bitwarden", "proton pass", "vaultwarden", "self-hosted", "vault", "connect", "one-time codes", "totp", "2fa"],
        },
        ardia: {
          title: "Ardia",
          keywords: ["offer to save and fill passwords", "import passwords", "export passwords", "csv", "built-in", "saved passwords", "logins", "credentials", "keychain", "chrome"],
        },
        vaultSuggest: { title: "Suggest", description: "What the fill menu and the right-click menu offer.", keywords: ["autofill", "fill menu", "suggestions", "right click", "context menu"] },
        vaultSuggestLogins: { title: "Saved Logins", keywords: ["username", "password", "autofill", "fill menu", "right click", "suggestions"] },
        vaultSuggestCodes: { title: "Verification Codes", keywords: ["one-time codes", "totp", "2fa", "authenticator", "otp"] },
        vaultSuggestUsernames: { title: "Previous Usernames", keywords: ["email", "sign up", "username suggestions", "used before"] },
        vaultSuggestNewPasswords: { title: "New Passwords", keywords: ["suggest new password", "generate password", "strong password", "sign up", "right click"] },
        vaultContextGenerate: { title: "New Passwords in Any Text Field", keywords: ["context menu", "right click", "generate password", "strong password", "new password", "text field"] },
        vaultSuggestGenerated: { title: "Generated Passwords", keywords: ["kept", "unsaved", "generated passwords", "other passwords"] },
        vaultSuggestOnFocus: { title: "When a Login Field Is Focused", keywords: ["suggest on focus", "autofill", "fill menu", "suggestions", "login field", "automatically"] },
        vaultAskBeforeFilling: { title: "Ask Before Filling", keywords: ["touch id", "fingerprint", "password", "screen lock", "authenticate", "biometrics"] },
        vaultMenuGlass: { title: "Glass Menu", keywords: ["fill menu", "liquid glass", "translucent", "look"] },
        vaultSaveOffer: { title: "Offer to Save", keywords: ["save login", "new password", "save prompt"] },
        vaultAutoSave: { title: "Save New Passwords Automatically", keywords: ["auto save", "new password", "sign up", "generated password", "strong password"] },
        vaultSaveTarget: { title: "Save New Logins To", keywords: ["default manager", "save to", "destination"] },
        vaultIdleLockMinutes: { title: "Lock After", keywords: ["auto lock", "timeout", "idle", "touch id"] },
        vaultLockOnQuit: { title: "Lock When Ardia Quits", keywords: ["auto lock", "quit", "relaunch", "restart", "touch id", "stay unlocked"] },
        vaultLockOnScreenLock: { title: "Lock When Screen Locks", keywords: ["auto lock", "sleep", "screen saver", "lock screen", "touch id", "stay unlocked"] },
        vaultKeepGenerated: { title: "Keep Generated Passwords", keywords: ["generated passwords", "unsaved", "sign up", "new account", "forgot to save", "retention"] },
        vaultSync: { title: "Sync", keywords: ["refresh", "update", "reload", "pull", "fetch", "password manager"] },
        vaultICloudSync: { title: "Sync with iCloud", keywords: ["icloud", "keychain", "other macs", "devices", "encrypted", "backup"] },
      },
    },
  ],
  autofill: [
    {
      section: "Autofill",
      rows: {
        addresses: { title: "Save and fill addresses", description: "Names, addresses, email addresses and phone numbers.", keywords: ["forms", "contact", "phone", "email"] },
        cards: { title: "Save and fill credit cards", description: "Filling in or showing a card number asks for Touch ID or your password.", keywords: ["payment", "debit card", "forms"] },
      },
    },
    { section: "Addresses", rows: { addressList: { title: "Addresses", keywords: ["add address", "saved addresses"] } } },
    { section: "Credit Cards", rows: { cardList: { title: "Credit Cards", keywords: ["add card", "saved cards", "payment"] } } },
  ],
  extensions: [
    { section: "Extensions", rows: { installed: { title: "Extensions", description: "Add features to Ardia with extensions from the Chrome Web Store. Each profile has its own.", keywords: ["add ons", "plugins", "installed"] } } },
    {
      section: "Add extensions",
      rows: {
        webStore: { title: "Chrome Web Store", description: "Browse the store; its Add to Ardia button installs here.", keywords: ["install extension"] },
        addLink: { advanced: true, title: "Add from a link", description: "Paste a Chrome Web Store link or extension ID.", keywords: ["install extension", "url"] },
        unpacked: { advanced: true, title: "Load unpacked extension", description: "For developers: load an extension folder with a manifest.json.", keywords: ["developer mode"] },
      },
    },
  ],
  search: [
    { section: "Default search engine", rows: { defaultEngine: { title: "Default search engine", description: "Used by the command bar and the New Tab page.", keywords: ["google", "duckduckgo", "bing", "kagi", "ecosia"] } } },
    {
      section: "Other search engines",
      rows: { otherEngines: { advanced: true, title: "Other search engines", description: "Type a shortcut and press Tab in the command bar to search a site directly.", keywords: ["custom search", "site search", "keyword"] } },
    },
    { section: "Suggestions", rows: { suggestions: { title: "Show search suggestions", description: "Sends what you type to your search engine to suggest searches.", keywords: ["autocomplete"] } } },
    {
      section: "Text selection",
      rows: {
        showSelectionSearch: {
          advanced: true,
          title: "Show search button when selecting text",
          description: "Shows a Search button above text you select on a page.",
          keywords: ["selection", "selected text", "popover", "popup", "highlight"],
        },
      },
    },
  ],
} satisfies Pick<Record<SettingsPane, SettingSection[]>, "privacy" | "passwords" | "autofill" | "extensions" | "search">;
