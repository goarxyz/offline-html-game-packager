import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const catalogUrl = process.env.CATALOG_URL ||
  "https://goarxyz.github.io/offline-html-game-packager/api/catalog.json";
const output = process.env.OUTPUT_DIRECTORY || "web-covers";
const concurrency = Math.max(1, Number(process.env.CONCURRENCY || 3));
const limit = Number(process.env.LIMIT || 0);
const catalog = await (await fetch(catalogUrl)).json();
const games = limit > 0 ? catalog.games.slice(0, limit) : catalog.games;
await mkdir(output, { recursive: true });

let cursor = 0;
let completed = 0;
const sources = {};
await Promise.all(Array.from({ length: Math.min(concurrency, games.length) }, async () => {
  while (cursor < games.length) {
    const game = games[cursor++];
    try {
      const result = await findAndSave(game);
      if (result) sources[game.id] = result;
    } catch (error) {
      console.warn(`SKIP ${game.title}: ${error.message}`);
    }
    console.log(`[${++completed}/${games.length}] ${game.title}`);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}));
await writeFile(join(output, "sources.json"), `${JSON.stringify(sources, null, 2)}\n`);

async function findAndSave(game) {
  const query = `${game.title} game cover art`;
  const landing = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
    headers: { "user-agent": "Mozilla/5.0" }
  });
  if (!landing.ok) throw new Error(`image search HTTP ${landing.status}`);
  const landingHtml = await landing.text();
  const token = landingHtml.match(/vqd=([0-9-]+)/)?.[1];
  if (!token) throw new Error("image search token missing");
  const response = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${token}`, {
    headers: { "user-agent": "Mozilla/5.0", referer: "https://duckduckgo.com/" }
  });
  if (!response.ok) throw new Error(`image results HTTP ${response.status}`);
  const results = (await response.json()).results || [];
  for (const item of results.slice(0, 8)) {
    if (!item.image) continue;
    try {
      const imageResponse = await fetch(item.image, {
        headers: { "user-agent": "Mozilla/5.0", referer: item.url || "https://duckduckgo.com/" }
      });
      if (!imageResponse.ok) continue;
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      const image = sharp(bytes);
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width < 240 || metadata.height < 180) continue;
      const filename = game.cover.split("/").pop();
      await image.resize(640, 360, { fit: "cover", position: "attention" })
        .webp({ quality: 86 })
        .toFile(join(output, filename));
      return { query, pageUrl: item.url || null, imageUrl: item.image, title: item.title || null };
    } catch {
      // Try the next result when a provider blocks or returns an unsupported image.
    }
  }
  throw new Error("no usable image result");
}