export type PdfFont = "regular" | "bold" | "mono";

const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722,
  667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222,
  222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722,
  667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278,
  278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
const WIN_ANSI: Record<string, { code: number; regular: number; bold: number }> = {
  "’": { code: 0x92, regular: 222, bold: 278 },
  "“": { code: 0x93, regular: 333, bold: 500 },
  "”": { code: 0x94, regular: 333, bold: 500 },
  "•": { code: 0x95, regular: 350, bold: 350 },
  "–": { code: 0x96, regular: 556, bold: 556 },
  "›": { code: 0x9b, regular: 333, bold: 333 },
};
const FONT_NAMES: Record<PdfFont, string> = { regular: "F1", bold: "F2", mono: "F3" };
const MONO_WIDTH = 600;
const FALLBACK_WIDTH = 556;

function encode(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (WIN_ANSI[char]) out.push(WIN_ANSI[char]!.code);
    else if ((code >= 32 && code <= 126) || (code >= 0xa0 && code <= 0xff)) out.push(code);
    else out.push(0x3f);
  }
  return out;
}

export function textWidth(text: string, font: PdfFont, size: number): number {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (font === "mono") units += MONO_WIDTH;
    else if (WIN_ANSI[char]) units += WIN_ANSI[char]![font];
    else if (code >= 32 && code <= 126) units += (font === "bold" ? HELVETICA_BOLD : HELVETICA)[code - 32]!;
    else units += FALLBACK_WIDTH;
  }
  return (units * size) / 1000;
}

export function wrapped(text: string, font: PdfFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, font, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const literal = (bytes: number[]) => `(${bytes.map((b) => (b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : String.fromCharCode(b))).join("")})`;
const number = (n: number) => (Math.round(n * 100) / 100).toString();

export class PdfPage {
  readonly width: number;
  readonly height: number;
  private readonly ops: string[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  text(text: string, x: number, top: number, font: PdfFont, size: number, gray: number) {
    const baseline = this.height - top - size * 0.93;
    this.ops.push(`${number(gray)} g BT /${FONT_NAMES[font]} ${number(size)} Tf ${number(x)} ${number(baseline)} Td ${literal(encode(text))} Tj ET`);
  }

  rect(x: number, top: number, width: number, height: number, gray: number) {
    this.ops.push(`${number(gray)} g ${number(x)} ${number(this.height - top - height)} ${number(width)} ${number(height)} re f`);
  }

  roundedRect(x: number, top: number, width: number, height: number, radius: number, fill: number, stroke: number) {
    const k = radius * 0.5523;
    const left = x;
    const right = x + width;
    const bottom = this.height - top - height;
    const upper = this.height - top;
    const path = [
      `${number(left + radius)} ${number(bottom)} m`,
      `${number(right - radius)} ${number(bottom)} l`,
      `${number(right - radius + k)} ${number(bottom)} ${number(right)} ${number(bottom + radius - k)} ${number(right)} ${number(bottom + radius)} c`,
      `${number(right)} ${number(upper - radius)} l`,
      `${number(right)} ${number(upper - radius + k)} ${number(right - radius + k)} ${number(upper)} ${number(right - radius)} ${number(upper)} c`,
      `${number(left + radius)} ${number(upper)} l`,
      `${number(left + radius - k)} ${number(upper)} ${number(left)} ${number(upper - radius + k)} ${number(left)} ${number(upper - radius)} c`,
      `${number(left)} ${number(bottom + radius)} l`,
      `${number(left)} ${number(bottom + radius - k)} ${number(left + radius - k)} ${number(bottom)} ${number(left + radius)} ${number(bottom)} c h`,
    ];
    this.ops.push(`${number(fill)} g ${number(stroke)} G 1 w ${path.join(" ")} B`);
  }

  content(): string {
    return this.ops.join("\n");
  }
}

export function pdfDocument(page: PdfPage, title: string): Uint8Array {
  const content = page.content();
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Title ${literal(encode(title))} /Producer (Ardia) >>`,
  ];
  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xff;
  return bytes;
}
