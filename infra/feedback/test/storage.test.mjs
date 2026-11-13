import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.\w+$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const GROUPS = {
  telemetry: "../../telemetry/hexclave.deploy.ts",
  feedback: "../hexclave.deploy.ts",
  site: "../../site/hexclave.deploy.ts",
  dashboard: "../../dashboard/hexclave.deploy.ts",
};

const groups = {};
for (const [name, path] of Object.entries(GROUPS)) {
  const referenced = [];
  const { deploy } = await import(path);
  const config = deploy({
    secret: (secret) => `secret:${secret}`,
    service: (service) => ({
      hostname: () => {
        referenced.push(service);
        return `host:${service}`;
      },
    }),
    hexclave: { projectId: "project", secretServerKey: "key" },
  });
  groups[name] = { services: config.services, referenced };
}

const envOf = (group, service) => groups[group].services[service].env;
const { SERVICES } = await import("../../shared.ts");
const feedbackEnv = envOf("feedback", SERVICES.feedback);
const storeName = feedbackEnv.OBJECTS_HOST.replace(/^host:/, "");
const store = Object.values(groups)
  .map((group) => group.services[storeName])
  .find(Boolean);

test("reports are stored on a service that replays are not written to", () => {
  const replayWriters = [envOf("site", "site").TELEMETRY_OBJECTS_HOST, envOf("dashboard", "dashboard").REPLAYS_HOST];
  for (const replayHost of replayWriters) {
    assert.notEqual(feedbackEnv.OBJECTS_HOST, replayHost, `reports and replays share one store (${replayHost})`);
  }
});

test("the report store keeps reports without expiry and cannot outgrow its disk", () => {
  assert.ok(store, `no deployment group defines the report store ${storeName}`);
  const volumes = Object.values(store.persistentVolumes);
  assert.equal(volumes.length, 1, "the report store has one volume");
  assert.ok(!/-ttl\b/.test(store.startCommand), "reports are kept with no expiry");
  const volumeMax = Number(/-volume\.max=(\d+)/.exec(store.startCommand)?.[1]);
  const volumeMb = Number(/-master\.volumeSizeLimitMB=(\d+)/.exec(store.startCommand)?.[1]);
  assert.ok(volumeMax > 0 && volumeMb > 0, "the volume count and size limit are set");
  assert.ok(volumeMax * volumeMb <= volumes[0].sizeGb * 1024, `${volumeMax} volumes of ${volumeMb} MB do not fit on ${volumes[0].sizeGb} GB`);
});

test("the dashboard reads attachments from the store the report server writes to", () => {
  assert.equal(envOf("dashboard", "dashboard").FEEDBACK_OBJECTS_HOST, feedbackEnv.OBJECTS_HOST);
});

test("every service a group points at is defined by a group", () => {
  const defined = new Set(Object.values(groups).flatMap((group) => Object.keys(group.services)));
  for (const [name, group] of Object.entries(groups)) {
    for (const service of group.referenced) assert.ok(defined.has(service), `${name} points at ${service}, which no group defines`);
  }
});
