export function parseSince(text, now) {
  if (!text) return now - 24 * 3600e3;
  const s = text.trim().toLowerCase();
  let m = /^(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|d|day|days|w)$/.exec(s);
  if (m) {
    const unit = { m: 60e3, min: 60e3, mins: 60e3, h: 3600e3, hr: 3600e3, hrs: 3600e3, d: 864e5, day: 864e5, days: 864e5, w: 6048e5 }[m[2]];
    return now - Number(m[1]) * unit;
  }
  const zoneOffset = (zone) => (zone === "ist" ? 330 : zone === "utc" || zone === "z" ? 0 : null);
  m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(ist|utc|z)?$/.exec(s);
  if (m) {
    let hour = Number(m[1]) % (m[3] ? 12 : 24);
    if (m[3] === "pm") hour += 12;
    const offset = zoneOffset(m[4]) ?? -new Date(now).getTimezoneOffset();
    const shifted = new Date(now + offset * 60e3);
    let at = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), hour, Number(m[2] ?? 0)) - offset * 60e3;
    if (at > now) at -= 864e5;
    return at;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2}))?\s*(ist|utc|z)?$/.exec(s);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", zone] = m;
    const offset = zoneOffset(zone);
    if (offset === null) return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)).getTime();
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - offset * 60e3;
  }
  throw new Error(`can't read --since "${text}"`);
}
