import { mkdir, readFile, readdir, rm, writeFile, cp } from "node:fs/promises";
import { join } from "node:path";

const buildDirectory = process.argv[2] || "build";
const siteDirectory = process.argv[3] || "site";
const releaseTag = process.env.RELEASE_TAG;
const repository = process.env.GITHUB_REPOSITORY || "goarxyz/offline-html-game-packager";

if (!releaseTag) throw new Error("RELEASE_TAG is required");

const shardFiles = (await readdir(buildDirectory))
  .filter((name) => /^catalog-shard-\d+\.json$/.test(name))
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
if (!shardFiles.length) throw new Error(`No catalog shard files found in ${buildDirectory}`);

const entries = [];
for (const filename of shardFiles) {
  entries.push(...JSON.parse(await readFile(join(buildDirectory, filename), "utf8")));
}
entries.sort((a, b) => a.filename.localeCompare(b.filename, "en", { numeric: true }));

const unique = new Set(entries.map((entry) => entry.filename));
if (unique.size !== entries.length) throw new Error("Duplicate games found while merging catalog shards");

const releaseBase = `https://github.com/${repository}/releases/download/${releaseTag}`;
const catalog = {
  generatedAt: new Date().toISOString(),
  releaseTag,
  gameCount: entries.length,
  games: entries.map((entry) => ({
    ...entry,
    packageUrl: `${releaseBase}/${encodeURIComponent(entry.packageFilename)}`
  }))
};

await rm(siteDirectory, { recursive: true, force: true });
await mkdir(siteDirectory, { recursive: true });
await cp(join(buildDirectory, "covers"), join(siteDirectory, "covers"), { recursive: true });
await writeFile(join(siteDirectory, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(join(siteDirectory, ".nojekyll"), "");
await writeFile(join(siteDirectory, "index.html"), `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline HTML Game Packages</title>
<style>body{font:16px system-ui;max-width:760px;margin:60px auto;padding:0 20px;background:#111;color:#eee}a{color:#e86a2a}</style>
<h1>Offline HTML Game Packages</h1>
<p>${entries.length} packaged games are available.</p>
<p><a href="./catalog.json">Open catalog.json</a></p>
`);

console.log(`Merged ${entries.length} games from ${shardFiles.length} shards`);