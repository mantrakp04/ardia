const DRAW = "ProxyImpl::ScheduledActionDraw";
const MAIN = "ProxyMain::BeginMainFrame";
const ACTIVATE = "ProxyImpl::DidActivateSyncTreeOnImplThread";
const EXTENSION_FRAME = /^chrome-extension:\/\/[a-p]{32}\//;

const gaps = (ts) => ts.slice(1).map((t, i) => t - ts[i]).filter((g) => g < 100);
const rate = (ts) => (ts.length > 1 ? +((1000 * (ts.length - 1)) / (ts.at(-1) - ts[0])).toFixed(1) : null);

function pageContent(index) {
  const hue = (index * 37) % 360;
  const shade = (offset, lightness) => {
    const c = (1 - Math.abs(2 * lightness - 1)) * 0.6;
    const h = ((hue + offset) % 360) / 60;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h) % 6];
    const m = lightness - c / 2;
    return [r + m, g + m, b + m].map((v) => v.toFixed(3)).join(" ");
  };
  const bands = Array.from({ length: 24 }, (_, i) => `${shade(i * 6, 0.62)} rg 72 ${96 + i * 6} 468 6 re f`).join("\n");
  const text = Array.from({ length: 36 }, (_, i) =>
    `BT /F1 11 Tf 72 ${700 - i * 16} Td (Page ${index + 1} line ${i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.) Tj ET`).join("\n");
  return `${shade(0, 0.93)} rg 0 0 612 792 re f\n${bands}\n0 g\nBT /F1 28 Tf 72 740 Td (Page ${index + 1}) Tj ET\n${text}`;
}

export function pdfDocument(pageCount = 300) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, i) => `${4 + 2 * i} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < pageCount; i++) {
    const content = pageContent(i);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

let document = null;
export function servePdf(res) {
  document ??= pdfDocument();
  res.writeHead(200, { "content-type": "application/pdf", "content-length": document.length, "cache-control": "no-store" });
  res.end(document);
}

export function frameOrigin(url) {
  if (!URL.canParse(url)) return "unparsable";
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

export function pdfFrameTargets(list) {
  const frames = list.filter((t) => t.type === "iframe");
  const viewer = frames.find((t) => EXTENSION_FRAME.test(t.url));
  const others = frames.filter((t) => t !== viewer);
  const content = viewer && (others.find((t) => t.parentId === viewer.id) ?? others[0]);
  return { viewer, content, seen: list.map((t) => ({ type: t.type, origin: frameOrigin(t.url), hasParent: !!t.parentId })) };
}

export function frameRates(events, pid, t0, t1, refreshMs) {
  const named = (name, phases = ["X", "B"]) =>
    events.filter((e) => e.pid === pid && e.name === name && e.ts >= t0 && e.ts <= t1 && phases.includes(e.ph)).map((e) => e.ts / 1000).sort((a, b) => a - b);
  const draws = named(DRAW);
  const mains = named(MAIN);
  const activations = named(ACTIVATE, ["X", "B", "I"]);
  let stale = 0;
  for (let i = 1, a = 0; i < draws.length; i++) {
    let fresh = false;
    for (; a < activations.length && activations[a] <= draws[i]; a++) if (activations[a] > draws[i - 1]) fresh = true;
    if (!fresh) stale++;
  }
  return {
    mains: mains.length,
    draws: draws.length,
    mainHz: rate(mains),
    drawHz: rate(draws),
    drawsLate: gaps(draws).filter((g) => g > refreshMs * 1.5).length,
    stalePct: draws.length > 1 ? Math.round((100 * stale) / (draws.length - 1)) : null,
  };
}

export function pdfRates(events, rep, refreshMs) {
  if (rep.error) return [{ error: rep.error }];
  const markOf = (name) => events.find((e) => e.name === name);
  const start = markOf(rep.start);
  const end = markOf(rep.end);
  if (!start || !end) return [{ role: "viewer", error: `the ${start ? "end" : "start"} mark is missing from the trace` }];
  const t0 = start.ts;
  const t1 = end.ts + 30000;
  const ms = Math.round((end.ts - start.ts) / 1000);
  const rows = rep.frames.map(({ role, mark, origin, error }) => {
    if (error) return { role, origin, error };
    const m = markOf(mark);
    if (!m) return { role, origin, error: `the ${role} mark is missing from the trace` };
    return { role, origin, pid: m.pid, ms, ...frameRates(events, m.pid, t0, t1, refreshMs) };
  });
  const named = new Set(rows.map((r) => r.pid));
  const drawing = events.filter((e) => e.ts >= t0 && e.ts <= t1 && (e.name === DRAW || e.name === MAIN)).map((e) => e.pid);
  const others = [...new Set(drawing)].filter((pid) => !named.has(pid)).sort((a, b) => a - b);
  return [...rows, ...others.map((pid) => ({ role: "other", pid, ms, ...frameRates(events, pid, t0, t1, refreshMs) }))];
}
