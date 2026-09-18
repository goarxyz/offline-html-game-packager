# goarxyz Browser Games

This repository powers the goarxyz browser-game library using a collection of single-file games.

Each generated ZIP contains:

```text
<original-game-name>.html
cover.webp
metadata.json
```

The workflow captures artwork from the running games, stores named packages in
`main/games/`, and publishes the catalog experience through GitHub Pages.

## Published site and API

- Game library: `https://goarxyz.github.io/offline-html-game-packager/`
- JSON API: `https://goarxyz.github.io/offline-html-game-packager/api/catalog.json`
- API documentation: `https://goarxyz.github.io/offline-html-game-packager/api.html`

The static site lives in `web/` and is assembled with generated catalog data
and covers during publication. Each title is fetched from `main/games/`, cached
in the browser, unpacked in memory, and launched at a temporary same-site URL
through a service worker and sandboxed iframe.

## Run the packaging workflow

The connected API token cannot write workflow files because GitHub requires a
separate `workflow` OAuth scope. Activate the already validated template once:

1. Open [`workflow-template/build-games.yml`](workflow-template/build-games.yml).
2. Choose **Edit this file**.
3. Change its path to `.github/workflows/build-games.yml` and commit to `main`.
4. Open **Actions → Build game packages** and choose **Run workflow**.
5. Supply the source owner, repository, branch, and directory when starting a build.

The build runs in 10 parallel shards. A successful run publishes:

- Catalog: `https://goarxyz.github.io/offline-html-game-packager/catalog.json`
- Artwork: `https://raw.githubusercontent.com/goarxyz/offline-html-game-packager/main/covers/<game>.webp`
- Packages: URLs stored in each catalog entry's `packageUrl`

## Local smoke test

The Playwright container used by Actions already includes Chromium:

```bash
npm install
npm test
npm run build -- --shard 0 --total 10 --limit 1
RELEASE_TAG=local-test node scripts/merge-catalog.mjs build site
```

## Browser loading flow

The consuming website should:

1. Fetch `catalog.json`.
2. Display each entry's `coverUrl`.
3. Download `packageUrl` only when the user chooses that game.
4. Store the ZIP in the Cache API.
5. Read `filename` from `metadata.json` and extract that original HTML filename.
6. Publish the document to a temporary service-worker URL for the game iframe.

Do not gzip files inside the ZIP. ZIP compression already handles the package,
and double compression makes browser loading slower without a useful size win.

## Licensing

Repository-authored code and documentation are available under the MIT License.
The packaged games and captured artwork are excluded; see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).