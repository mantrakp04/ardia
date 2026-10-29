import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

const FAKE_EDS = new URL("../../../../../engine/ardiacore-linux/tests/fixtures/fake_eds.py", import.meta.url);

export const CALENDAR_SOURCES = [
  { uid: "acceptance-work", data: "[Data Source]\nDisplayName=Acceptance Work\nEnabled=true\nParent=acceptance-account\n\n[Calendar]\nBackendName=caldav\nColor=#62a0ea\n\n[WebDAV Backend]\nEmailAddress=me@ardia.test\n" },
  { uid: "acceptance-personal", data: "[Data Source]\nDisplayName=Acceptance Personal\nEnabled=true\nParent=local-stub\n\n[Calendar]\nBackendName=local\nColor=#becedd\n" },
  { uid: "acceptance-account", data: "[Data Source]\nDisplayName=me@ardia.test\nEnabled=true\n\n[Collection]\nBackendName=google\nIdentity=me@ardia.test\n" },
  { uid: "local-stub", data: "[Data Source]\nDisplayName=On This Computer\nEnabled=true\n" },
  { uid: "acceptance-chores", data: "[Data Source]\nDisplayName=Chores\nEnabled=true\nParent=local-stub\n\n[Task List]\nBackendName=local\n" },
];

const utc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const date = (ms) => utc(ms).slice(0, 8);

function zonedWall(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { stamp: `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`, year: +parts.year, month: +parts.month, day: +parts.day };
}

const vevent = (lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT", ""].join("\r\n");

export function calendarFixture(now = Date.now()) {
  const minute = Math.floor(now / 60000) * 60000;
  const standup = minute + 60000 + 20000;
  const recurringToday = minute + 2 * 3600000;
  const today = zonedWall(recurringToday, "America/New_York");
  const tenDaysEarlier = new Date(Date.UTC(today.year, today.month - 1, today.day - 10));
  const firstStamp = `${tenDaysEarlier.getUTCFullYear()}${String(tenDaysEarlier.getUTCMonth() + 1).padStart(2, "0")}${String(tenDaysEarlier.getUTCDate()).padStart(2, "0")}${today.stamp.slice(8)}`;
  const localToday = new Date(now);
  const allDayStart = Date.UTC(localToday.getFullYear(), localToday.getMonth(), localToday.getDate());
  const work = [
    vevent(["UID:acceptance-standup", "SUMMARY:Acceptance standup", `DTSTART:${utc(standup)}`, `DTEND:${utc(standup + 15 * 60000)}`, "LOCATION:https://meet.google.com/abc-defg-hij",
      "ORGANIZER;CN=Ana:mailto:ana@ardia.test", "ATTENDEE;CN=Me;PARTSTAT=ACCEPTED:mailto:me@ardia.test", "ATTENDEE;CN=Ana;PARTSTAT=ACCEPTED:mailto:ana@ardia.test"]),
    vevent(["UID:acceptance-declined", "SUMMARY:Declined review", `DTSTART:${utc(standup - 10000)}`, `DTEND:${utc(standup + 30 * 60000)}`, "LOCATION:https://meet.google.com/xyz-abcd-efg",
      "ATTENDEE;CN=Me;PARTSTAT=DECLINED:mailto:ME@ardia.test"]),
    vevent(["UID:acceptance-cancelled", "SUMMARY:Cancelled sync", "STATUS:CANCELLED", `DTSTART:${utc(standup - 5000)}`, `DTEND:${utc(standup + 30 * 60000)}`, "LOCATION:https://meet.google.com/qrs-tuvw-xyz"]),
    vevent(["UID:acceptance-daily", "SUMMARY:Daily planning", `DTSTART;TZID=America/New_York:${firstStamp}`, `DURATION:PT30M`, "RRULE:FREQ=DAILY;COUNT=30"]),
    vevent(["UID:acceptance-allday", "SUMMARY:Acceptance offsite", `DTSTART;VALUE=DATE:${date(allDayStart)}`, `DTEND;VALUE=DATE:${date(allDayStart + 86400000)}`]),
  ];
  const personal = [vevent(["UID:acceptance-dentist", "SUMMARY:Dentist", `DTSTART:${utc(minute + 3 * 3600000)}`, `DTEND:${utc(minute + 4 * 3600000)}`])];
  return {
    config: { sources: CALENDAR_SOURCES, objects: { "acceptance-work": work, "acceptance-personal": personal } },
    expected: { standup, recurringToday, allDayStart: new Date(localToday.getFullYear(), localToday.getMonth(), localToday.getDate()).getTime() },
    added: (title, startMs) => vevent([`UID:acceptance-added-${startMs}`, `SUMMARY:${title}`, `DTSTART:${utc(startMs)}`, `DTEND:${utc(startMs + 30 * 60000)}`]),
    work,
  };
}

async function ready(test, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} didn't start`);
}

function run(command, args, env, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`${command} failed: ${stderr.trim()}`)); });
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

export async function startFakeEds(dir, config) {
  const bus = join(dir, `calendar-bus-${Date.now()}`);
  const address = `unix:path=${bus}`;
  const env = { ...process.env, DBUS_SESSION_BUS_ADDRESS: address };
  const daemon = spawn("dbus-daemon", ["--session", "--nofork", `--address=${address}`], { stdio: "ignore" });
  await ready(() => access(bus).then(() => true, () => false), "dbus-daemon");
  let service = null;
  const serve = async () => {
    service = spawn("python3", ["-I", FAKE_EDS.pathname, "--serve", JSON.stringify(config)], { stdio: ["ignore", "pipe", "pipe"], env });
    let output = "";
    service.stdout.on("data", (chunk) => { output += chunk; });
    await ready(async () => output.includes("ready"), "the fake Evolution Data Server");
  };
  await serve();
  return {
    address,
    async control(method, ...args) {
      return JSON.parse(await run("python3", ["-I", FAKE_EDS.pathname, "--control", method, ...args], env));
    },
    async stopService() {
      if (service) await stopChild(service);
    },
    async stop() {
      if (service) await stopChild(service);
      await stopChild(daemon);
    },
  };
}
