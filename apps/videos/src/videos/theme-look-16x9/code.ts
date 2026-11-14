export type Group = 0 | 1 | 2;

export interface CodeLine {
  text: string;
  group: Group;
  commaFrom?: Group;
  lookKey?: "type" | "metrics" | "layout" | "icons";
}

export const FILE_NAME = "themes/demo.json";

export const CODE: CodeLine[] = [
  { text: "{", group: 0 },
  { text: '  "$schema": "../theme.schema.json"', group: 0, commaFrom: 1 },
  { text: '  "dark": {', group: 1 },
  { text: '    "accent": "#FF9F5A",', group: 1 },
  { text: '    "icon": "#FFC08A",', group: 1 },
  { text: '    "textTab": "#F6E7D2",', group: 1 },
  { text: '    "tabSelected": "#FF9F5A38",', group: 1 },
  { text: '    "tabSelectedText": "#FFE2C2",', group: 1 },
  { text: '    "pinnedResting": "#FF9F5A24",', group: 1 },
  { text: '    "pinnedRestingStroke": "#FF9F5A52"', group: 1 },
  { text: "  }", group: 1, commaFrom: 2 },
  { text: '  "type": { "family": "Avenir Next", "scale": 1.08 },', group: 2, lookKey: "type" },
  { text: '  "metrics": {', group: 2, lookKey: "metrics" },
  { text: '    "rowHeight": 42, "rowGap": 5, "pinnedHeight": 52,', group: 2 },
  { text: '    "sidebarWidth": 250,', group: 2 },
  { text: '    "radius": { "row": 16, "pinned": 18 }', group: 2 },
  { text: "  },", group: 2 },
  { text: '  "layout": {', group: 2, lookKey: "layout" },
  { text: '    "hide": ["navButtons"],', group: 2 },
  { text: '    "addressField": "bottom",', group: 2 },
  { text: '    "newTab": "top"', group: 2 },
  { text: "  },", group: 2 },
  { text: '  "icons": {', group: 2, lookKey: "icons" },
  { text: '    "plus": "plus.circle.fill",', group: 2 },
  { text: '    "sidebar.left": "rectangle.lefthalf.inset.filled",', group: 2 },
  { text: '    "chevron.down": "chevron.down.circle"', group: 2 },
  { text: "  }", group: 2 },
  { text: "}", group: 0 },
];

export type Token = { text: string; kind: "key" | "string" | "number" | "punct" | "space" };

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|(\s+)|([{}[\],:])/g;

export function tokenize(line: string): Token[] {
  const out: Token[] = [];
  for (const m of line.matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      out.push({ text: m[1], kind: m[2] ? "key" : "string" });
      if (m[2]) out.push({ text: m[2], kind: "punct" });
    } else if (m[3] !== undefined) out.push({ text: m[3], kind: "number" });
    else if (m[4] !== undefined) out.push({ text: m[4], kind: "space" });
    else if (m[5] !== undefined) out.push({ text: m[5], kind: "punct" });
  }
  return out;
}
