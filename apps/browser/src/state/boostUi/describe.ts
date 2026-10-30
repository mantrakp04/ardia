import type { Boost } from "../boosts/types";

const CASES = { none: "", lower: "lowercase", upper: "UPPERCASE", title: "Title Case" } as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function siteLine(boost: Pick<Boost, "domain" | "subdomains">): string {
  return boost.subdomains ? `${boost.domain} and every subdomain` : `${boost.domain} and www.${boost.domain}`;
}

export function boostChanges(boost: Boost): string[] {
  const lines: string[] = [];
  if (boost.colors) lines.push(boost.colors.invert ? "Recolours the page with inverted lightness" : "Recolours the page");
  if (boost.font) lines.push(`Sets the font to ${boost.font}`);
  if (boost.size !== 100) lines.push(`Sets the page zoom to ${boost.size}%`);
  if (boost.textCase !== "none") lines.push(`Shows text in ${CASES[boost.textCase]}`);
  if (boost.zaps.length) lines.push(`Hides ${plural(boost.zaps.length, "element")}`);
  const css = boost.css.trim();
  if (css) lines.push(`Adds ${plural(css.split("\n").length, "line")} of CSS`);
  if (boost.js.trim()) lines.push("Runs JavaScript");
  return lines;
}
