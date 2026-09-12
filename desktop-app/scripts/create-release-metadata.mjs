import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const releaseDir = join(process.cwd(), "release");
const platform = process.env.RELEASE_PLATFORM ?? process.platform;
const files = [];

for (const name of await readdir(releaseDir)) {
  if (name.startsWith("SHA256SUMS-") || name.startsWith("SBOM-")) continue;
  const path = join(releaseDir, name);
  if ((await stat(path)).isFile()) files.push({ name, path });
}

const checksums = await Promise.all(
  files.map(async ({ name, path }) => {
    const digest = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    return `${digest}  ${name}`;
  }),
);

await writeFile(
  join(releaseDir, `SHA256SUMS-${platform}.txt`),
  `${checksums.sort().join("\n")}\n`,
  "utf8",
);
