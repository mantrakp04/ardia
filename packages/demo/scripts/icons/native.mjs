import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { HERE, NATIVE, SCRATCH } from "./paths.mjs";

const SOURCE = `${HERE}native.swift`;
const BINARY = `${SCRATCH}/native-render`;

function renderer() {
  if (!existsSync(BINARY) || statSync(BINARY).mtimeMs < statSync(SOURCE).mtimeMs) {
    mkdirSync(SCRATCH, { recursive: true });
    execFileSync("swiftc", ["-O", SOURCE, "-o", BINARY], { stdio: ["ignore", "ignore", "inherit"] });
  }
  return BINARY;
}

export function renderNative(jobs, label) {
  if (!jobs.length) return;
  for (const dir of new Set(jobs.map((job) => dirname(`${NATIVE}/${job.file}`)))) mkdirSync(dir, { recursive: true });
  const list = `${SCRATCH}/jobs-${label}.json`;
  writeFileSync(list, JSON.stringify(jobs));
  execFileSync(renderer(), [list, NATIVE], { stdio: "inherit" });
}

export const nativePath = (file) => `${NATIVE}/${file}`;
