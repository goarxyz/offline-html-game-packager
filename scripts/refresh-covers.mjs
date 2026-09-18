import { createServer } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const owner = process.env.SOURCE_OWNER || "CoolDude2349";
const repository = process.env.SOURCE_REPO || "Offline-HTML-Games-Pack";
const branch = process.env.SOURCE_BRANCH || "master";
const directory = process.env.SOURCE_DIRECTORY || "offline";
const output = process.env.OUTPUT_DIRECTORY || "covers-refreshed";
const concurrency = Math.max(1, Number(process.env.CONCURRENCY || 6));
const shard = Number(process.env.SHARD || 0);
const shardTotal = Number(process.env.SHARD_TOTAL || 1);
const limit = Number(process.env.LIMIT || 0);

await mkdir(output, { recursive: true });
const entries = (await sourceEntries())
  .filter((_, index) => index % shardTotal === shard)
  .slice(0, limit > 0 ? limit : undefined);
const documents = new Map();
const server = createServer((request, response) => {
  const html = documents.get(request.url);
  if (!html) return response.writeHead(404).end("Not found");
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "credentialless"
  });
  response.end(html);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  ignoreHTTPSErrors: true
});
let cursor = 0;
let completed = 0;

try {
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      await capture(entry).catch((error) => console.warn(`SKIP ${entry.name}: ${error.message}`));
      console.log(`[${++completed}/${entries.length}] ${entry.name}`);
    }
  }));
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

async function capture(entry) {
  const html = await fetchText(entry.download_url);
  const slug = entry.name.replace(/\.(?:html?|htm)$/i, "");
  const route = `/game/${encodeURIComponent(slug)}.html`;
  documents.set(route, html);
  const page = await context.newPage();
  const temporary = [];
  try {
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
    await page.goto(`http://127.0.0.1:${port}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    }).catch(() => {});
    await page.waitForTimeout(5500);
    temporary.push(await candidate(page, slug, 1));

    await page.keyboard.press("Enter").catch(() => {});
    await page.mouse.click(640, 360).catch(() => {});
    await page.waitForTimeout(7000);
    temporary.push(await candidate(page, slug, 2));

    await page.keyboard.press("Space").catch(() => {});
    await page.mouse.click(640, 430).catch(() => {});
    await page.waitForTimeout(6500);
    temporary.push(await candidate(page, slug, 3));

    const scored = [];
    for (const item of temporary) {
      const stats = await sharp(item.path).stats();
      const score = stats.entropy + item.order * 0.12;
      scored.push({ ...item, score, entropy: stats.entropy });
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored[0].entropy < 0.35) throw new Error("all captures were visually empty");
    await sharp(scored[0].path)
      .resize(640, 360, { fit: "cover" })
      .webp({ quality: 82 })
      .toFile(join(output, `${slug}.webp`));
  } finally {
    await page.close();
    documents.delete(route);
    await Promise.all(temporary.map(({ path }) => rm(path, { force: true })));
  }
}

async function candidate(page, slug, order) {
  const path = join(output, `.${slug}-${order}-${process.pid}.png`);
  await page.screenshot({ path, type: "png", animations: "disabled", timeout: 30000 });
  return { path, order };
}

async function fetchText(url) {
  let error;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (caught) {
      error = caught;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
    }
  }
  throw error;
}

async function sourceEntries() {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repository}/contents/${directory}?ref=${branch}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "goarxyz-cover-refresh",
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {})
    }
  });
  if (!response.ok) throw new Error(`Source listing failed: ${response.status}`);
  return (await response.json())
    .filter((entry) => entry.type === "file" && /\.html?$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}