#!/usr/bin/env node
/**
 * meta.mjs — write/read per-output metadata sidecars for the project list.
 *
 * Usage (via `make meta`):
 *   FILE=banner TITLE="Monte-Carlo cloud banner" PROMPT="256 instances of
 *   hec.56.png, iterative stamp + shear/rotate" node scripts/meta.mjs
 *
 * Sidecars live next to the artefact: project/output/<stem>.json.
 * Omit TITLE/PROMPT to just print the current sidecar.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const OUTPUT = path.resolve(import.meta.dirname, "..", "project", "output");
const stem = process.env.FILE;

if (!stem) {
  console.error("usage: make meta FILE=<stem-in-output> TITLE=\"..\" PROMPT=\"..\"");
  process.exit(1);
}

const sidecar = path.join(OUTPUT, `${stem}.json`);

if (!process.env.TITLE && !process.env.PROMPT) {
  if (existsSync(sidecar)) {
    console.log(readFileSync(sidecar, "utf8"));
  } else {
    console.error(`no metadata for ${stem} (project/output/${stem}.json)`);
    process.exit(1);
  }
} else {
  let prev = {};
  try { prev = JSON.parse(readFileSync(sidecar, "utf8")); } catch {}
  const meta = {
    title: process.env.TITLE ?? prev.title ?? stem,
    prompt: process.env.PROMPT ?? prev.prompt ?? "",
    updated: new Date().toISOString(),
  };
  writeFileSync(sidecar, JSON.stringify(meta, null, 2) + "\n");
  console.log(`metadata written: project/output/${stem}.json`);
}
