#!/usr/bin/env node
/**
 * Puts the pinned vehicle-detection model (src/shared/model-release.json)
 * into resources/models/ so electron-builder bundles it into the installer.
 * Every file is checked against its pinned SHA-256; a missing asset or a
 * mismatch fails the build instead of shipping an app without a model.
 *
 *   node scripts/fetch-release-model.mjs            # download if not present
 *   node scripts/fetch-release-model.mjs --check    # verify present files only
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const release = JSON.parse(
  await readFile(join(root, "src/shared/model-release.json"), "utf8"),
);
const targetDir = join(root, "resources/models");
const checkOnly = process.argv.includes("--check");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const url = (name) =>
  `https://github.com/${release.repository}/releases/download/${encodeURIComponent(release.tag)}/${encodeURIComponent(name)}`;

if (!/^model-[a-z0-9._-]+$/.test(release.tag)) {
  throw new Error(`unexpected model release tag ${release.tag}`);
}

await mkdir(targetDir, { recursive: true });
for (const file of release.files) {
  if (!/^[a-z0-9_]+\.(onnx|json)$/.test(file.name)) {
    throw new Error(`unexpected model file name ${file.name}`);
  }
  const path = join(targetDir, file.name);
  if (existsSync(path) && sha256(await readFile(path)) === file.sha256) {
    console.log(`${file.name}: present, checksum ok`);
    continue;
  }
  if (checkOnly) {
    throw new Error(`${file.name}: missing or checksum mismatch in ${targetDir}`);
  }
  const res = await fetch(url(file.name));
  if (!res.ok) {
    throw new Error(`${file.name}: HTTP ${res.status} from ${url(file.name)}`);
  }
  const body = Buffer.from(await res.arrayBuffer());
  const actual = sha256(body);
  if (actual !== file.sha256) {
    throw new Error(
      `${file.name}: checksum ${actual} does not match pinned ${file.sha256}`,
    );
  }
  const tmp = `${path}.download`;
  await writeFile(tmp, body);
  await rename(tmp, path).catch(async (err) => {
    await rm(tmp, { force: true });
    throw err;
  });
  console.log(`${file.name}: downloaded from ${release.tag}, ${body.length} bytes`);
}
