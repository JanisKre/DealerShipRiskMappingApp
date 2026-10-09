#!/usr/bin/env node
/**
 * Writes the licence notices that ship with the packaged app:
 *
 * - `out/licenses/LICENSE`: the project's own GPL-3.0-or-later licence.
 * - `out/licenses/THIRD_PARTY_NOTICES.txt`: name, version, SPDX licence and
 *   full licence text of every production dependency installed in
 *   node_modules. MIT, BSD and Apache-2.0 require these notices to travel
 *   with redistributed copies; the renderer bundle and the packaged
 *   node_modules both contain such code.
 *
 * electron-builder copies `out/licenses` into the app's resources folder
 * (see electron-builder.json). Run after `electron-vite build`, which clears
 * `out/`. Dev-only packages are skipped because they are not shipped;
 * platform-specific optional packages appear only on the platform that
 * installed them, which is the platform being packaged.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(appDir, "out", "licenses");
const LICENSE_FILE = /(^|[-_.])(licen[cs]e|copying|notice)([-_.]|$)/i;

const lock = JSON.parse(
  readFileSync(join(appDir, "package-lock.json"), "utf8"),
);

function licenseTexts(pkgDir) {
  return readdirSync(pkgDir)
    .filter((name) => LICENSE_FILE.test(name))
    .sort()
    .map((name) => ({
      name,
      text: readFileSync(join(pkgDir, name), "utf8").trim(),
    }));
}

function spdx(license) {
  if (typeof license === "string") return license;
  if (license && typeof license.type === "string") return license.type;
  return "UNKNOWN";
}

const entries = [];
for (const [path, meta] of Object.entries(lock.packages ?? {})) {
  if (!path || meta.dev || meta.link) continue;
  const pkgDir = join(appDir, path);
  if (!existsSync(join(pkgDir, "package.json"))) continue; // optional, not installed here
  const name = path.slice(
    path.lastIndexOf("node_modules/") + "node_modules/".length,
  );
  entries.push({
    name,
    version: meta.version ?? "?",
    license: spdx(meta.license),
    files: licenseTexts(pkgDir),
  });
}
entries.sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);

const rule = "=".repeat(78);
const sections = entries.map(({ name, version, license, files }) => {
  const body = files.length
    ? files.map((f) => `--- ${f.name} ---\n${f.text}`).join("\n\n")
    : "(No licence file in the package; see the licence identifier above.)";
  return `${rule}\n${name}@${version}\nLicence: ${license}\n${rule}\n\n${body}\n`;
});

const header = `Dealership Risk Mapping — third-party notices

This application includes the following open-source packages. Each is
distributed under the licence named in its section; the full licence texts
supplied by the packages follow. The application itself is licensed under
GPL-3.0-or-later (see LICENSE). Electron and Chromium notices ship separately
as LICENSE.electron.txt and LICENSES.chromium.html.

Packages: ${entries.length}
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "THIRD_PARTY_NOTICES.txt"),
  `${header}\n${sections.join("\n")}`,
);
copyFileSync(join(appDir, "..", "LICENSE"), join(outDir, "LICENSE"));

const missing = entries.filter((e) => e.files.length === 0).map((e) => e.name);
console.log(`wrote ${entries.length} third-party notices to ${outDir}`);
if (missing.length) console.log(`no licence file in: ${missing.join(", ")}`);
