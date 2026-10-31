const options = JSON.parse(process.argv[2]);
let captured;
globalThis.window = {
  __ardiaHost: {
    bootstrap: { windowId: "window", profileId: "default" },
    call: async (name, profile, args) => {
      if (name !== "extensions.configure" || profile !== "default") throw new Error("Unexpected domain route");
      captured = args;
      return '{"ok":true}';
    },
    onEvent: () => () => {},
  },
};
const { configureExtension } = await import("../../browser/src/platform/extensions.ts");
await configureExtension("a".repeat(32), "default", options);
console.log(captured);
