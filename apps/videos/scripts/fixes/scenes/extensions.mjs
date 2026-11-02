import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const dir = join(process.env.FIXES_SCRATCH ?? join(process.env.HOME, "ardia-scratch/video-fixes"), "ext", "color-picker");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "Color Picker",
  version: "1.0",
  description: "Picks a colour from the page.",
  action: { default_popup: "popup.html", default_icon: "icon.png" },
  options_page: "options.html",
  icons: { 128: "icon.png" },
}));
writeFileSync(join(dir, "popup.html"), `<!doctype html><meta charset="utf-8"><body style="font:14px -apple-system;padding:14px 18px;width:180px"><b>Color Picker</b><p>#3478F6</p></body>`);
writeFileSync(join(dir, "options.html"), `<!doctype html><meta charset="utf-8"><body style="font:15px -apple-system;padding:24px"><h2>Color Picker options</h2></body>`);

function icon(size = 128) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const inside = (x - 64) ** 2 + (y - 64) ** 2 < 60 * 60;
      const bar = inside && x > 30 && x < 100 && (x - 30) % 22 < 12 && y < 94 && y > 94 - (Math.floor((x - 30) / 22) + 1) * 15;
      row.push(...(!inside ? [0, 0, 0, 0] : bar ? [255, 255, 255, 255] : [52, 120, 246, 255]));
    }
    rows.push(...row);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}
writeFileSync(join(dir, "icon.png"), icon());

export default {
  setup: `st().activate("t3"); return ac.engine.call("extensions.install", { profile: "", path: ${JSON.stringify(dir)} }).catch((e) => ({ error: e.message })).then((r) => ac.extensions.refreshExtensions("").then(() => sleep(2500)).then(() => done({ installed: r })));`,
  act: `return sleep(500).then(() => { mark("⌘T"); return dw("keys:" + CMD + ":t:17"); }).then(() => sleep(900)).then(() => { mark("go"); mark("color"); return typeText("color", 160); }).then(() => sleep(3200)).then(() => done());`,
};
