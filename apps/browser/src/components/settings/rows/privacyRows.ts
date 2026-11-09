import { type SettingSection } from "./types";
import type { SettingsPane } from "../../../state/settings/settingsWindows";
import { effectivePasswordManager } from "../../../state/site/passwordManager";
import { iCloudPasswordsExtensionSupported } from "../../../state/site/passwords";

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
        anonymousId: {
          title: "Your anonymous ID",
          description: "The name and colours you appear to us as, and resetting the ID.",
          keywords: ["install id", "identity", "reset id", "avatar", "anonymous name", "privacy"],
        },
      },
    },
    {
      section: "Kept on this Mac",
      rows: {
        viewData: {
          title: "The last 7 days",
          description: "Saves the last 7 days Ardia recorded to your Downloads folder.",
          keywords: ["view my data", "local copy", "export", "download my data", "telemetry log", "diagnostics", "events"],
        },
      },
    },
  ],
  passwords: [
    {
      section: "Passwords",
      rows: {
        passwordManager: {
          title: "Autofill passwords and passkeys from",
          description: "Apple Passwords uses your Mac's Passwords app and iCloud Keychain. Ardia's password manager keeps logins separately per profile.",
          keywords: ["password manager", "icloud keychain", "apple passwords", "passkeys"],
        },
        offerToSave: {
          title: "Offer to save and fill passwords",
          description: "Offers to save a login after you sign in, and suggests saved ones when you click a login field.",
          keywords: ["password manager", "logins", "credentials", "keychain"],
          shown: (s) => effectivePasswordManager(s) === "ardia",
        },
        importPasswords: {
          title: "Import passwords",
          description: "From a CSV exported by Chrome, Safari, Firefox, 1Password, Bitwarden…",
          keywords: ["csv", "logins"],
          shown: (s) => effectivePasswordManager(s) === "ardia",
        },
        exportPasswords: {
          advanced: true,
          title: "Export passwords",
          description: "To a CSV file. Anyone who can open the file can read your passwords.",
          keywords: ["csv", "backup", "logins"],
          shown: (s) => effectivePasswordManager(s) === "ardia",
        },
        managerApps: {
          advanced: true,
          title: "Password manager apps",
          keywords: ["1password", "bitwarden", "keepassxc", "proton pass"],
          shown: (s) => effectivePasswordManager(s) !== "apple",
        },
        otherManager: {
          title: "Using another password manager",
          description: "Install the 1Password, Bitwarden, Proton Pass or KeePassXC extension from Extensions. Both Apple Passwords and Ardia's built-in prompts stay out of its way.",
          keywords: ["extension", "third party", "disable prompts"],
          shown: (s) => effectivePasswordManager(s) === "none",
        },
      },
    },
    {
      section: "Apple Passwords",
      rows: {
        openPasswords: {
          title: "Passwords app",
          description: "Manage saved passwords, passkeys, verification codes and Wi-Fi passwords in macOS Passwords.",
          keywords: ["apple passwords", "icloud keychain", "passkeys", "totp", "2fa"],
          shown: (s) => effectivePasswordManager(s) === "apple",
        },
        iCloudExtension: {
          title: "iCloud Passwords",
          description: "Apple's Chrome extension can't connect to its helper app in browsers outside Apple's allowlist — use the built-in Key button in login fields instead.",
          keywords: ["icloud passwords", "chrome web store", "extension", "verification codes", "helper application"],
          shown: (s) => effectivePasswordManager(s) === "apple" && iCloudPasswordsExtensionSupported(),
        },
        fillLogin: {
          title: "Filling a login",
          description: "Click the Key button inside any username or password field, or right-click the field and choose AutoFill › Passwords, then approve with Touch ID.",
          keywords: ["autofill", "touch id", "key icon", "context menu"],
          shown: (s) => effectivePasswordManager(s) === "apple",
        },
        verificationCodes: {
          title: "Verification codes",
          description: "Click the Key button in a 2FA code field to fill a code from Passwords. Right-click a 2FA QR code on a page to add it to Passwords.",
          keywords: ["totp", "2fa", "two factor", "one time code", "otp", "qr code", "authenticator"],
          shown: (s) => effectivePasswordManager(s) === "apple",
        },
        newLogins: {
          title: "Saving new logins",
          description: "Ardia offers to open Passwords with the site and username copied when you sign in, or click + in Passwords anytime.",
          keywords: ["save password", "add password", "icloud keychain"],
          shown: (s) => effectivePasswordManager(s) === "apple",
        },
      },
    },
    {
      section: "Saved in Ardia",
      rows: {
        moveFromArdia: {
          title: "Move passwords to Apple Passwords",
          description: "Export a CSV here, then in the Passwords app choose File › Import Passwords…",
          keywords: ["migrate", "export csv", "import to apple passwords", "icloud keychain"],
          shown: (s) => effectivePasswordManager(s) !== "ardia",
        },
        showSavedInArdia: {
          title: "View passwords saved in Ardia",
          description: "See or edit passwords that were saved in Ardia before switching.",
          keywords: ["saved logins", "ardia keychain"],
          shown: (s) => effectivePasswordManager(s) !== "ardia",
        },
      },
    },
  ],
  autofill: [
    {
      section: "Autofill",
      rows: {
        addresses: { title: "Save and fill addresses", description: "Names, addresses, email addresses and phone numbers.", keywords: ["forms", "contact", "phone", "email"] },
        cards: { title: "Save and fill credit cards", description: "Filling in or showing a card number asks for Touch ID or your password.", keywords: ["payment", "debit card", "forms"] },
        fromMac: {
          title: "Contacts and Passwords from this Mac",
          description: "Right-click any field and choose AutoFill › Contacts or Passwords to fill from macOS Contacts and the Passwords app.",
          keywords: ["apple passwords", "contacts", "icloud keychain", "context menu"],
          shown: (s) => effectivePasswordManager(s) === "apple",
        },
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
