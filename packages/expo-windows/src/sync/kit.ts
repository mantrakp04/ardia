import { pdfDocument, PdfPage, wrapped, type PdfFont } from "./pdf";
import { qrCode } from "./qr";

export const KIT_PDF_NAME = "Ardia Recovery Kit.pdf";
export const KIT_TEXT_NAME = "Ardia Recovery Kit.txt";
export const HIDDEN_WORDS: readonly string[] = Array(24).fill("••••••");

const INTRO = "If you don’t have access to the computer on which you first turned on sync, you can still get your synced data on another computer:";
const STEPS = ["Open Ardia › Settings › Sync, and choose the same sync folder.", "Click Enter Recovery Phrase.", "Paste the 24 words below."];
const WARNING =
  "Keep this kit somewhere safe, like a password manager or a printed copy. Anyone with these words and your sync folder can read your synced data. Ardia can’t recover the words for you: there’s no server and no other copy.";
const CODE_TITLE = "Moving to a new computer?";
const CODE_NOTE = "Scan this code with your phone’s camera to copy the words, then enter them on the new computer.";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const PAGE = { width: 612, height: 792, margin: 60 } as const;
const INK = 0.1;
const GREY = 0.4;

export const createdDate = (date: Date) => `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;

export function kitText(words: readonly string[], created: Date, device: string): string {
  const lines = ["Ardia Recovery Kit", `Created ${createdDate(created)} on ${device}`, "", INTRO, ""];
  lines.push(...STEPS.map((step, i) => `${i + 1}. ${step}`));
  lines.push("", "Recovery phrase:", "");
  lines.push(...words.map((word, i) => `${String(i + 1).padStart(2, " ")}. ${word}`));
  lines.push("", WARNING, "");
  return lines.join("\n");
}

export function kitPdf(words: readonly string[], created: Date, device: string): Uint8Array {
  const page = new PdfPage(PAGE.width, PAGE.height);
  const width = PAGE.width - PAGE.margin * 2;
  let y = 64;
  const text = (content: string, font: PdfFont, size: number, gray: number, spacing = 8, x: number = PAGE.margin, boxWidth = width) => {
    const lines = wrapped(content, font, size, boxWidth);
    const lineHeight = size * 1.2 + 3;
    lines.forEach((line, i) => page.text(line, x, y + i * lineHeight, font, size, gray));
    y += lines.length * lineHeight - 3 + spacing;
  };
  text("Ardia Recovery Kit", "bold", 26, INK, 4);
  text(`Created ${createdDate(created)} on ${device}`, "regular", 12, GREY, 26);
  text(INTRO, "regular", 13, INK, 10);
  STEPS.forEach((step, i) => text(`${i + 1}.  ${step}`, "regular", 13, INK, 4, PAGE.margin + 8, width - 8));
  y += 18;

  const box = { x: PAGE.margin, top: y, width, height: 6 * 26 + 30 };
  page.roundedRect(box.x, box.top, box.width, box.height, 12, 0.96, 0.82);
  const column = (box.width - 36) / 4;
  words.forEach((word, i) => {
    const x = box.x + 18 + Math.floor(i / 6) * column;
    const rowTop = box.top + 15 + (i % 6) * 26;
    const label = String(i + 1);
    page.text(label, x + 14 - label.length * 5.56, rowTop + 4, "regular", 10, GREY);
    page.text(word, x + 20, rowTop, "mono", 14, INK);
  });
  y = box.top + box.height + 22;

  const side = 112;
  const code = qrCode(words.join(" "));
  const module = side / (code.size + 2);
  page.rect(PAGE.margin, y, side, side, 1);
  for (let row = 0; row < code.size; row++) {
    for (let col = 0; col < code.size; col++) if (code.dark(col, row)) page.rect(PAGE.margin + (col + 1) * module, y + (row + 1) * module, module + 0.05, module + 0.05, 0);
  }
  const captionTop = y;
  y += 18;
  text(CODE_TITLE, "bold", 12, INK, 4, PAGE.margin + side + 18, width - side - 18);
  text(CODE_NOTE, "regular", 12, GREY, 8, PAGE.margin + side + 18, width - side - 18);
  y = Math.max(y, captionTop + side) + 26;
  text(WARNING, "regular", 11, GREY);
  return pdfDocument(page, "Ardia Recovery Kit");
}
