# Offline HTML Game Packager

This repository builds browser-ready packages from the 300 single-file games in
[`CoolDude2349/Offline-HTML-Games-Pack`](https://github.com/CoolDude2349/Offline-HTML-Games-Pack).

Each generated ZIP contains:

```text
<original-game-name>.html
cover.webp
metadata.json
```

The workflow captures artwork from the running game itself, stores package ZIPs
as public GitHub Release assets, and deploys `catalog.json` plus lightweight
cover images through GitHub Pages.

## Run the packaging workflow

The connected API token cannot write workflow files because GitHub requires a
separate `workflow` OAuth scope. Activate the already validated template once:

1. Open [`workflow-template/build-games.yml`](workflow-template/build-games.yml).
2. Choose **Edit this file**.
3. Change its path to `.github/workflows/build-games.yml` and commit to `main`.
4. Open **Actions → Build game packages** and choose **Run workflow**.
5. Keep the source branch as `master` unless the upstream repository changes it.

The build runs in 10 parallel shards. A successful run publishes:

- Catalog: `https://goarxyz.github.io/offline-html-game-packager/catalog.json`
- Covers: `https://goarxyz.github.io/offline-html-game-packager/covers/<game>.webp`
- Packages: URLs stored in each catalog entry's `packageUrl`

## Local smoke test

The Playwright container used by Actions already includes Chromium:

```bash
npm install
npm test
npm run build -- --shard 0 --total 300 --limit 1
RELEASE_TAG=local-test node scripts/merge-catalog.mjs build site
```

## Browser loading flow

The consuming website should:

1. Fetch `catalog.json`.
2. Display each entry's `cover`.
3. Download `packageUrl` only when the user chooses that game.
4. Store the ZIP in IndexedDB.
5. Read `filename` from `metadata.json` and extract that original HTML filename
   with JSZip.
6. Load the HTML using a Blob URL in the game iframe.

Do not gzip files inside the ZIP. ZIP compression already handles the package,
and double compression makes browser loading slower without a useful size win.