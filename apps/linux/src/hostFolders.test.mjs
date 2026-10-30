import assert from "node:assert/strict";
import test from "node:test";
import { createFolderPicker } from "./hostFolders.ts";

function fixture(reply, capabilities = ["ArdiaShell.pickFolder"], answers = []) {
  const calls = [];
  const notices = [];
  const host = {
    bootstrap: { windowId: "settings", profileId: "default", capabilities },
    invoke: async (method, args) => {
      calls.push([method, args]);
      const next = Array.isArray(reply) ? reply.shift() : reply;
      if (next instanceof Error) throw next;
      return next;
    },
    call: async () => "null",
    onEvent: () => () => {},
  };
  const pick = createFolderPicker(host, async ({ title, message, confirmTitle }) => {
    notices.push([title, message, confirmTitle]);
    return answers.shift() ?? false;
  });
  return { pick, calls, notices };
}

const quiet = async (run) => {
  const original = console.error;
  console.error = () => {};
  try { return await run(); } finally { console.error = original; }
};

test("a picked folder comes back as its path and the current folder seeds the dialog", async () => {
  const { pick, calls } = fixture("/home/me/Downloads/new");
  assert.equal(await pick("/home/me/Downloads", "Use Folder"), "/home/me/Downloads/new");
  assert.deepEqual(calls, [["ArdiaShell.pickFolder", { args: ["/home/me/Downloads", "Use Folder"] }]]);
});

test("cancel leaves the setting alone", async () => {
  const { pick, notices } = fixture(null);
  assert.equal(await pick(null), null);
  assert.deepEqual(notices, []);
});

test("a folder the host rejects is reported in the window and never applied", async () => {
  const error = Object.assign(new Error("Ardia can't save downloads in that folder"), { code: "ERR_FOLDER_NOT_WRITABLE" });
  const { pick, notices } = fixture(error);
  assert.equal(await quiet(() => pick("/home/me/Downloads", "Use Folder")), null);
  assert.deepEqual(notices, [["Couldn't Use That Folder", "Ardia can't save downloads in that folder", "Choose Another Folder…"]]);
});

test("choosing another folder after a rejection opens the picker again", async () => {
  const error = Object.assign(new Error("That folder no longer exists"), { code: "ERR_FOLDER_MISSING" });
  const { pick, calls, notices } = fixture([error, "/home/me/Elsewhere"], ["ArdiaShell.pickFolder"], [true]);
  assert.equal(await quiet(() => pick("/home/me/Downloads", "Use Folder")), "/home/me/Elsewhere");
  assert.equal(calls.length, 2);
  assert.equal(notices.length, 1);
});

test("odd replies are treated as cancel, and a host without a picker says so instead of throwing", async () => {
  assert.equal(await fixture(42).pick(null), null);
  assert.equal(await fixture({ path: "/x" }).pick(null), null);
  const old = fixture("/never", []);
  assert.equal(await old.pick(null), null);
  assert.deepEqual(old.calls, []);
  assert.equal(old.notices.length, 1);
});
