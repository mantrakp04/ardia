import { execFile } from "node:child_process";
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { currentRect, desktopShot, desktopUnavailable, openDesktop, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { openDownloadsPopover } from "../lib/desktopUi.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";

const run = promisify(execFile);
const exists = (path) => stat(path).then(() => true, () => false);

async function which(name) {
  return run("sh", ["-c", `command -v ${name}`]).then(({ stdout }) => stdout.trim() || null, () => null);
}

async function subordinate() {
  const user = (await run("id", ["-un"])).stdout.trim();
  const range = async (file) => {
    const line = (await readFile(file, "utf8").catch(() => "")).split("\n").find((l) => l.startsWith(`${user}:`));
    if (!line) return null;
    const [, start, count] = line.split(":").map((v, i) => (i ? Number(v) : v));
    return count >= 2 ? start : null;
  };
  const uid = await range("/etc/subuid");
  const gid = await range("/etc/subgid");
  return uid !== null && gid !== null ? { uid, gid } : null;
}

export const OTHER_UID = 2000;
const REFUSED = "Couldn't Move the File to the Trash";

export function driveWrapper({ executable, drive, foreign, uid, gid, sub }) {
  const maps = (kind, own, start) => [`--map-${kind}=0:${start}:1`, `--map-${kind}=${own}:${own}:1`, `--map-${kind}=${OTHER_UID}:${start + 1}:1`].join(" ");
  const prepare = foreign
    ? `mkdir -p '${drive}/.Trash-${uid}' && chown ${OTHER_UID}:${OTHER_UID} '${drive}/.Trash-${uid}' && chmod 777 '${drive}/.Trash-${uid}' || exit 4`
    : "true";
  return `#!/bin/sh
exec unshare ${maps("users", uid, sub.uid)} ${maps("groups", gid, sub.gid)} --setgroups allow --mount --setuid 0 --setgid 0 sh -c "mount -t tmpfs -o mode=0777,size=64m ardia-drive '${drive}' || exit 3; ${prepare}; exec setpriv --reuid=${uid} --regid=${gid} --clear-groups '${executable}' \\"\\$@\\"" ardia "$@"
`;
}

async function trashFromPopover(desktop, shell, name) {
  const window = await desktop.focused();
  let row = await shell.rectByText(name, { exact: true });
  if (!row) {
    await openDownloadsPopover(desktop, window, shell);
    row = await until(() => shell.rectByText(name, { exact: true }), { timeout: 8000, label: "the download row in the popover" });
  }
  const frame = await currentRect(desktop, window);
  await desktop.click(frame.x + row.x, frame.y + row.y, "right");
  const item = await until(() => shell.rectByText("Move to Trash", { exact: true }), { timeout: 5000, label: "Move to Trash in the row's menu" });
  await desktop.click(frame.x + item.x, frame.y + item.y);
}

async function onDrive(t, desktop, { foreign }) {
  const sub = await subordinate();
  const uid = process.getuid();
  const gid = process.getgid();
  const work = await t.scratch(foreign ? "drive-foreign" : "drive");
  const drive = join(work, "drive");
  await mkdir(drive, { recursive: true });
  const wrapper = join(work, "ardia-on-drive");
  await writeFile(wrapper, driveWrapper({ executable: t.options.executable, drive, foreign, uid, gid, sub }));
  await chmod(wrapper, 0o755);
  const executable = t.options.executable;
  t.options.executable = wrapper;
  let launched;
  try {
    launched = await startDesktopBrowser(t, desktop, { name: foreign ? "foreign" : "own", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }), preferences: { downloads: drive } });
  } finally {
    t.options.executable = executable;
  }
  const { app, shell } = launched;
  const seen = (path) => join("/proc", String(app.child.pid), "root", path.replace(/^\//, ""));
  const mounts = await readFile(join("/proc", String(app.child.pid), "mountinfo"), "utf8");
  if (!mounts.split("\n").some((l) => l.includes(` ${drive} `) && l.includes("tmpfs"))) throw new Error(`the drive isn't a separate mount for Ardia: ${drive}`);
  const name = `${foreign ? "foreign" : "drive"}-${Date.now()}.bin`;
  await shell.navigate(await shell.activeTabId(), t.fixtures.url.download(name));
  const download = await until(async () => {
    const reply = await shell.call("downloads.list", {});
    return (reply.ok ? reply.value : []).find((d) => (d.path ?? "").endsWith(name) && d.state === "finished") ?? false;
  }, { timeout: 30000, label: `${name} to finish on the drive` });
  if (!download.path.startsWith(drive) || !(await exists(seen(download.path)))) throw new Error(`the download isn't on the drive: ${download.path}`);
  return { app, shell, drive, name, download, seen, uid };
}

export default {
  id: "W156R",
  issue: 156,
  desktop: true,
  title: "Move to Trash from the downloads popover on a removable drive (a mode-0777, non-sticky tmpfs mounted in a user namespace): it lands in the drive's .Trash-<uid>, and another user's .Trash-<uid> is refused",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable();
    const tools = { unshare: await which("unshare"), setpriv: await which("setpriv"), newuidmap: await which("newuidmap") };
    const sub = await subordinate();
    const absent = Object.entries(tools).filter(([, p]) => !p).map(([n]) => n);
    if (missing || absent.length || !sub) {
      t.manual("Trash on a writable removable drive", ["Mount a drive whose top folder is writable by everyone and not sticky and download a file to it: Move to Trash puts it in that drive's .Trash-<uid>/files with a .trashinfo record; another user's .Trash-<uid> is refused."], missing ?? (absent.length ? `${absent.join(", ")} not found` : "no /etc/subuid and /etc/subgid range for this user"));
      return;
    }
    const desktop = await openDesktop(t);
    await t.check("Move to Trash from the row's menu puts the file in the drive's .Trash-<uid>/files with a relative .trashinfo record", async () => {
      const env = await onDrive(t, desktop, { foreign: false });
      try {
        await trashFromPopover(desktop, env.shell, env.name);
        const trash = join(env.drive, `.Trash-${env.uid}`);
        await until(() => exists(env.seen(join(trash, "files", env.name))), { timeout: 10000, label: `${env.name} in ${trash}/files` }).catch(async (error) => {
          await desktopShot(t, desktop, "drive-trash-missing");
          throw new Error(`${error.message}; drive ${JSON.stringify(await readdir(env.seen(env.drive)).catch((e) => e.message))}`);
        });
        const info = await readFile(env.seen(join(trash, "info", `${env.name}.trashinfo`)), "utf8");
        const owner = (await stat(env.seen(trash))).uid;
        const mode = (await stat(env.seen(trash))).mode & 0o777;
        if (await exists(env.seen(env.download.path))) throw new Error("the original file is still there");
        if (!info.includes(`Path=${env.name}\n`) || !/DeletionDate=\d{4}-\d\d-\d\dT/.test(info)) throw new Error(`trashinfo ${JSON.stringify(info)}`);
        if (owner !== process.getuid() || mode !== 0o700) throw new Error(`${trash} is owned by ${owner} with mode ${mode.toString(8)}`);
        await desktopShot(t, desktop, "drive-trashed");
        return { trash: `.Trash-${env.uid}`, info: info.trim().split("\n"), mode: "700" };
      } finally {
        await t.stop(env.app);
      }
    });
    await t.check("with a .Trash-<uid> created there by another user, Move to Trash refuses it and leaves the file", async () => {
      const env = await onDrive(t, desktop, { foreign: true });
      try {
        await trashFromPopover(desktop, env.shell, env.name);
        const notice = await until(async () => {
          const lines = (await env.shell.text()).split("\n").map((l) => l.trim());
          return lines.includes(REFUSED) ? lines.filter((l) => l === REFUSED || /trash/i.test(l)).slice(0, 3) : false;
        }, { timeout: 10000, label: `Ardia's "${REFUSED}" notice` });
        await desktopShot(t, desktop, "drive-foreign-trash");
        const trash = join(env.drive, `.Trash-${env.uid}`);
        const inside = await readdir(env.seen(trash)).catch(() => []);
        if (!(await exists(env.seen(env.download.path)))) throw new Error(`the file left its folder; the foreign trash holds ${JSON.stringify(inside)}`);
        if (inside.length) throw new Error(`Ardia wrote into another user's trash: ${JSON.stringify(inside)}`);
        const reply = await env.shell.call("downloads.list", {});
        const row = (reply.ok ? reply.value : []).find((d) => d.path === env.download.path);
        if (!row) throw new Error("the download's row was removed although the file wasn't trashed");
        return { notice, kept: true, row: row.state };
      } finally {
        await t.stop(env.app);
      }
    });
  },
};
