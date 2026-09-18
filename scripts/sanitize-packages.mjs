import { readdir, mkdtemp, readFile, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const gamesDirectory = process.argv[2] || "games";
const packages = (await readdir(gamesDirectory))
  .filter((name) => name.endsWith(".zip"))
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

for (const [index, packageName] of packages.entries()) {
  const root = await mkdtemp("/tmp/game-package-");
  const unpacked = join(root, "unpacked");
  const rewritten = join(root, "rewritten.zip");
  try {
    await exec("unzip", ["-q", join(gamesDirectory, packageName), "-d", unpacked]);
    const metadataPath = join(unpacked, "metadata.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    delete metadata.sourceUrl;
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await exec("zip", ["-q", "-X", "-r", rewritten, "."], { cwd: unpacked });
    await rename(rewritten, join(gamesDirectory, packageName));
    console.log(`[${index + 1}/${packages.length}] ${packageName}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}