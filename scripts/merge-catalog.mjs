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

const packageBase = process.env.PACKAGE_BASE_URL ||
  `https://raw.githubusercontent.com/${repository}/main/games`;
const catalog = {
  generatedAt: new Date().toISOString(),
  releaseTag,
  games: entries.map((entry) => ({
    ...Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "source" + "Url")),
    category: categoryFor(entry.filename),
    packageUrl: `${packageBase}/${encodeURIComponent(entry.packageFilename)}`,
    coverUrl: `https://raw.githubusercontent.com/${repository}/main/${entry.cover}`
  }))
};

function categoryFor(filename) {
  const name = filename.toLocaleLowerCase();
  if (/(soccer|tennis|basket|baseball|bowling|golf|football|skate|bike|racing|race|drift|moto|car|drive|run 3)/.test(name)) return "Sports & Racing";
  if (/(chess|mahjong|sudoku|solitaire|puzzle|blox|bubble|match|2048|memory|word|brain|connect|flood|cut the rope)/.test(name)) return "Puzzle";
  if (/(tower|defense|strategy|war|kingdom|battle|age of|civilization|army|siege|tactics)/.test(name)) return "Strategy";
  if (/(adventure|fireboy|watergirl|zelda|mario|sonic|platform|quest|escape|temple|raft|jacksmith)/.test(name)) return "Adventure";
  if (/(shoot|gun|zombie|strike|combat|fight|battle|ninja|sniper|action|alien|warrior)/.test(name)) return "Action";
  if (/(flappy|angry birds|flipper|pinball|pac|snake|tetris|arcade|runner|doodle|fruit|geometry)/.test(name)) return "Arcade";
  return "Casual";
}

await rm(siteDirectory, { recursive: true, force: true });
await mkdir(siteDirectory, { recursive: true });
await cp("web", siteDirectory, { recursive: true });
await cp(join(buildDirectory, "covers"), join(siteDirectory, "covers"), { recursive: true });
await writeFile(join(siteDirectory, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
await mkdir(join(siteDirectory, "api"), { recursive: true });
await writeFile(join(siteDirectory, "api", "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(join(siteDirectory, ".nojekyll"), "");

console.log(`Merged ${entries.length} games from ${shardFiles.length} shards`);