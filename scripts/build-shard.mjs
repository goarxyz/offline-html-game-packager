import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import archiver from "archiver";
import { chromium } from "playwright";
import { createWriteStream } from "node:fs";
import sharp from "sharp";

const SOURCE_OWNER = process.env.SOURCE_OWNER;
const SOURCE_REPO = process.env.SOURCE_REPO;
const SOURCE_BRANCH = process.env.SOURCE_BRANCH || "master";
const SOURCE_DIRECTORY = process.env.SOURCE_DIRECTORY || "offline";
const OUTPUT_DIRECTORY = process.env.OUTPUT_DIRECTORY || "build";
const shard = numberArgument("--shard", Number(process.env.SHARD || 0));
const shardTotal = numberArgument("--total", Number(process.env.SHARD_TOTAL || 1));
const limit = numberArgument("--limit", Number(process.env.LIMIT || 0));

if (!Number.isInteger(shard) || !Number.isInteger(shardTotal) || shard < 0 || shardTotal < 1 || shard >= shardTotal) {
  throw new Error(`Invalid shard ${shard}/${shardTotal}`);
}
if (!SOURCE_OWNER || !SOURCE_REPO) throw new Error("SOURCE_OWNER and SOURCE_REPO are required");

const packagesDirectory = join(OUTPUT_DIRECTORY, "packages");
const coversDirectory = join(OUTPUT_DIRECTORY, "covers");
const temporaryDirectory = join(OUTPUT_DIRECTORY, ".tmp", `shard-${shard}`);
await Promise.all([
  mkdir(packagesDirectory, { recursive: true }),
  mkdir(coversDirectory, { recursive: true }),
  mkdir(temporaryDirectory, { recursive: true })
]);

const sourceEntries = await fetchSourceEntries();
let selectedEntries = sourceEntries.filter((_, index) => index % shardTotal === shard);
if (limit > 0) selectedEntries = selectedEntries.slice(0, limit);
console.log(`Shard ${shard + 1}/${shardTotal}: packaging ${selectedEntries.length} of ${sourceEntries.length} games`);

let activeHtml = "<!doctype html><title>Preparing game</title>";
const server = createServer((request, response) => {
  if (request.url === "/game.html") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "credentialless"
    });
    response.end(activeHtml);
    return;
  }
  response.writeHead(404).end("Not found");
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const { port } = server.address();
const gameUrl = `http://127.0.0.1:${port}/game.html`;

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  ignoreHTTPSErrors: true
});

const catalog = [];
try {
  for (const [index, entry] of selectedEntries.entries()) {
    const filename = entry.name;
    const slug = filename.replace(/\.(?:html?|htm)$/i, "");
    const packageFilename = `${slug}.zip`;
    const coverFilename = `${slug}.webp`;
    const packagePath = join(packagesDirectory, packageFilename);
    const coverPath = join(coversDirectory, coverFilename);
    console.log(`[${index + 1}/${selectedEntries.length}] ${filename} (${formatBytes(entry.size)})`);

    const html = await fetchTextWithRetries(entry.download_url, 3);
    activeHtml = html;
    await captureCover(context, gameUrl, coverPath, displayName(filename));

    const metadata = {
      id: slug,
      filename,
      title: displayName(filename),
      sourceSha: entry.sha,
      sourceBytes: entry.size,
      builtAt: new Date().toISOString()
    };
    await createGamePackage(packagePath, html, coverPath, metadata);
    const packageBytes = (await readFile(packagePath)).byteLength;
    const packageSha256 = createHash("sha256").update(await readFile(packagePath)).digest("hex");
    catalog.push({
      ...metadata,
      cover: `covers/${coverFilename}`,
      packageFilename,
      packageBytes,
      packageSha256
    });
  }
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryDirectory, { recursive: true, force: true });
}

await writeFile(
  join(OUTPUT_DIRECTORY, `catalog-shard-${shard}.json`),
  `${JSON.stringify(catalog, null, 2)}\n`
);
console.log(`Shard ${shard + 1}/${shardTotal} complete`);

async function fetchSourceEntries() {
  const apiUrl = `https://api.github.com/repos/${SOURCE_OWNER}/${SOURCE_REPO}/contents/${SOURCE_DIRECTORY}?ref=${SOURCE_BRANCH}`;
  const response = await fetch(apiUrl, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "offline-html-game-packager"
    }
  });
  if (!response.ok) throw new Error(`GitHub source listing failed: ${response.status} ${await response.text()}`);
  const entries = await response.json();
  return entries
    .filter((entry) => entry.type === "file" && /\.html?$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}

async function fetchTextWithRetries(url, attempts) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw new Error(`Download failed after ${attempts} attempts: ${lastError}`);
}

async function captureCover(context, url, outputPath, title) {
  const page = await context.newPage();
  try {
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((error) => {
      console.warn(`Navigation warning for ${title}: ${error.message}`);
    });
    await page.waitForTimeout(3500);
    const screenshot = await page.screenshot({
      type: "png",
      animations: "disabled",
      timeout: 20000
    });
    await sharp(screenshot)
      .resize(640, 360, { fit: "cover" })
      .webp({ quality: 78 })
      .toFile(outputPath);
  } catch (error) {
    console.warn(`Screenshot failed for ${title}; creating fallback artwork: ${error.message}`);
    await createFallbackCover(context, outputPath, title);
  } finally {
    await page.close();
  }
}

async function createFallbackCover(context, outputPath, title) {
  const page = await context.newPage();
  try {
    await page.setContent(`<!doctype html>
      <style>
        html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#111;color:#fff;font-family:system-ui}
        main{height:100%;display:grid;place-items:center;border-left:18px solid #e86a2a;box-sizing:border-box}
        h1{font-size:56px;text-align:center;max-width:90%;letter-spacing:-.03em}
      </style><main><h1></h1></main>`);
    await page.locator("h1").evaluate((element, value) => { element.textContent = value; }, title);
    const screenshot = await page.screenshot({ type: "png" });
    await sharp(screenshot)
      .resize(640, 360, { fit: "cover" })
      .webp({ quality: 78 })
      .toFile(outputPath);
  } finally {
    await page.close();
  }
}

async function createGamePackage(outputPath, html, coverPath, metadata) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("warning", (error) => {
      if (error.code !== "ENOENT") reject(error);
      else console.warn(error);
    });
    archive.on("error", reject);
    archive.pipe(output);
    archive.append(html, { name: metadata.filename });
    archive.file(coverPath, { name: "cover.webp" });
    archive.append(`${JSON.stringify(metadata, null, 2)}\n`, { name: "metadata.json" });
    archive.finalize();
  });
}

function numberArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
}

function displayName(filename) {
  return basename(filename)
    .replace(/\.(?:html?|htm)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}