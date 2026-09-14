#!/usr/bin/env node
/**
 * Exports boundary ground truth from manual corrections in a local app database.
 *
 * Every dealership whose boundary the user corrected by hand gives us a matched
 * pair: the polygon the engine produced (`boundaryBeforeManualEdit`) and the
 * polygon a human decided was right (`boundary`). That is the only real ground
 * truth this project has.
 *
 * CAVEAT, and it matters: this sample is biased. Users correct the boundaries
 * they *noticed* were wrong, so it over-represents visible failures and says
 * nothing about boundaries that were quietly wrong. Report metrics from it
 * separately from the public fixture set; never use it alone to claim an
 * improvement.
 *
 * Output carries a hashed id and coordinates only — no dealership name, no
 * address, no portfolio metadata. The script refuses to write anywhere inside
 * the git working tree, because this file must never be committed.
 *
 * Usage:
 *   node scripts/export-boundary-groundtruth.mjs --db <path/to/dealership-risk.db>
 *   node scripts/export-boundary-groundtruth.mjs --db <path> --out <file.json>
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = { db: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--db") args.db = argv[i + 1];
    else if (argv[i] === "--out") args.out = argv[i + 1];
    else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
  }
  return args;
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function defaultDbPath() {
  // Mirrors app.getPath("userData") for the packaged app on each platform.
  const name = "dealership-risk-desktop";
  if (process.platform === "darwin") {
    return resolve(homedir(), "Library/Application Support", name, "dealership-risk.db");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? resolve(homedir(), "AppData/Roaming");
    return resolve(appData, name, "dealership-risk.db");
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config");
  return resolve(configHome, name, "dealership-risk.db");
}

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Refuses any destination inside the repository. Customer geometry stays out. */
function assertOutsideRepo(outPath) {
  const root = repoRoot();
  if (!root) return;
  const target = resolve(outPath);
  if (target === root || target.startsWith(root + sep)) {
    fail(
      `refusing to write ground truth inside the repository (${target}).\n` +
        "This file contains customer-derived geometry and must never be committed.\n" +
        "Pass --out with a path outside the working tree, or omit it to use the default.",
    );
  }
}

function hashId(lat, lon) {
  return createHash("sha256")
    .update(`${lat.toFixed(6)}|${lon.toFixed(6)}`)
    .digest("hex")
    .slice(0, 12);
}

function isPolygon(value) {
  return (
    value &&
    value.type === "Polygon" &&
    Array.isArray(value.coordinates) &&
    Array.isArray(value.coordinates[0]) &&
    value.coordinates[0].length >= 4
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/export-boundary-groundtruth.mjs --db <path> [--out <file.json>]",
    );
    process.exit(0);
  }

  // Validate the destination before touching the database, so a path that
  // would leak customer geometry into the repo fails immediately and loudly.
  const outPath = resolve(
    args.out ??
      resolve(homedir(), ".dealership-risk/benchmarks/boundary-groundtruth.local.json"),
  );
  assertOutsideRepo(outPath);

  const dbPath = resolve(args.db ?? defaultDbPath());
  if (!existsSync(dbPath)) {
    fail(
      `database not found: ${dbPath}\nPass --db with the path to dealership-risk.db.`,
    );
  }

  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    fail("better-sqlite3 is not available. Run `npm ci` in desktop-app first.");
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = db.prepare("SELECT id, data FROM sessions").all();

  const samples = [];
  let sessionsScanned = 0;
  let dealershipsScanned = 0;

  for (const row of rows) {
    let dealerships;
    try {
      dealerships = JSON.parse(row.data);
    } catch {
      console.warn(`skipping session ${row.id}: unreadable JSON`);
      continue;
    }
    if (!Array.isArray(dealerships)) continue;
    sessionsScanned += 1;

    for (const dealership of dealerships) {
      dealershipsScanned += 1;
      const corrected = dealership?.boundary;
      const original = dealership?.boundaryBeforeManualEdit;
      if (corrected?.source !== "manual") continue;
      if (!isPolygon(corrected?.polygon) || !isPolygon(original?.polygon)) continue;
      if (typeof dealership.lat !== "number" || typeof dealership.lon !== "number") {
        continue;
      }

      samples.push({
        id: hashId(dealership.lat, dealership.lon),
        lat: Number(dealership.lat.toFixed(6)),
        lon: Number(dealership.lon.toFixed(6)),
        reference: corrected.polygon,
        predicted: original.polygon,
        predictedSource: original.source,
        predictedConfidence: original.confidence,
        predictedRole: original.role,
      });
    }
  }
  db.close();

  // One correction per site; later sessions win.
  const deduped = [...new Map(samples.map((s) => [s.id, s])).values()];

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        dataset: "boundary-groundtruth-local",
        generatedAt: new Date().toISOString(),
        source: "manual boundary corrections in a local portfolio database",
        bias: "Users correct boundaries they noticed were wrong; this over-represents visible failures.",
        samples: deduped,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    `scanned ${dealershipsScanned} locations across ${sessionsScanned} portfolios`,
  );
  console.log(`wrote ${deduped.length} ground-truth samples to ${outPath}`);
  if (deduped.length === 0) {
    console.log(
      "No manual boundary corrections found. Edit a boundary on the map and save it first.",
    );
  }
}

main();
