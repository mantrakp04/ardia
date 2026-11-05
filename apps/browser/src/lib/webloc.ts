const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const escapeXml = (text: string) => text.replace(/[&<>]/g, (c) => ESCAPES[c]!);

function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== "#") return NAMED[name.toLowerCase()] ?? whole;
    const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

export function weblocText(url: string, id: string | null = null): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `\t<key>URL</key>`,
    `\t<string>${escapeXml(url)}</string>`,
    ...(id ? [`\t<key>ArdiaLink</key>`, `\t<string>${escapeXml(id)}</string>`] : []),
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
}

const stringFor = (text: string, key: string) => {
  const plain = text.replace(/<!--[\s\S]*?-->/g, "");
  const found = new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`, "i").exec(plain);
  return found ? unescapeXml(found[1]!).trim() || null : null;
};

export const parseWebloc = (text: string): string | null => stringFor(text, "URL");

export const weblocLinkId = (text: string): string | null => stringFor(text, "ArdiaLink");

export const newLinkId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
