const state = {
  games: [],
  query: "",
  category: "all",
  sort: "title-asc",
  savedOnly: false,
  visible: 48,
  saved: new Set(JSON.parse(localStorage.getItem("goarxyz-saved") || "[]"))
};

const elements = {
  grid: document.querySelector("#game-grid"),
  template: document.querySelector("#game-card-template"),
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  category: document.querySelector("#category"),
  savedFilter: document.querySelector("#saved-filter"),
  resultCount: document.querySelector("#result-count"),
  empty: document.querySelector("#empty"),
  showMore: document.querySelector("#show-more"),
  player: document.querySelector("#player"),
  playerTitle: document.querySelector("#player-title"),
  playerStatus: document.querySelector("#player-status"),
  playerDownload: document.querySelector("#player-download"),
  frame: document.querySelector("#game-frame"),
  closePlayer: document.querySelector("#close-player")
};

init();

async function init() {
  try {
    await registerGameWorker();
    const response = await fetch("./api/catalog.json");
    if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
    const catalog = await response.json();
    state.games = catalog.games;
    populateCategories();
    bindEvents();
    render();
  } catch (error) {
    elements.grid.setAttribute("aria-busy", "false");
    elements.resultCount.textContent = "Catalog unavailable";
    elements.empty.hidden = false;
    elements.empty.querySelector("h3").textContent = "Could not load the catalog";
    elements.empty.querySelector("p").textContent = error.message;
  }
}

function bindEvents() {
  elements.search.addEventListener("input", () => {
    state.query = elements.search.value.trim().toLocaleLowerCase();
    state.visible = 48;
    render();
  });
  elements.sort.addEventListener("change", () => {
    state.sort = elements.sort.value;
    render();
  });
  elements.category.addEventListener("change", () => {
    state.category = elements.category.value;
    state.visible = 48;
    render();
  });
  elements.savedFilter.addEventListener("click", () => {
    state.savedOnly = !state.savedOnly;
    state.visible = 48;
    elements.savedFilter.setAttribute("aria-pressed", String(state.savedOnly));
    render();
  });
  elements.showMore.addEventListener("click", () => {
    state.visible += 48;
    render();
  });
  elements.closePlayer.addEventListener("click", closePlayer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.player.hidden) closePlayer();
  });
}

function render() {
  const games = filteredGames();
  const shown = games.slice(0, state.visible);
  const fragment = document.createDocumentFragment();

  for (const game of shown) {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    const image = card.querySelector(".cover");
    const save = card.querySelector(".save-button");
    const play = card.querySelector(".play-link");
    const download = card.querySelector(".download-only");
    const category = card.querySelector(".category");
    image.src = game.coverUrl || `./${game.cover}`;
    image.alt = `${game.title} game artwork`;
    card.querySelector("h3").textContent = game.title;
    category.textContent = game.category || "Casual";
    card.querySelector(".format-badge").textContent = game.category || "Web game";
    download.href = game.packageUrl;
    download.setAttribute("download", game.packageFilename);
    download.setAttribute("aria-label", `Download ${game.title} ZIP`);
    play.setAttribute("aria-label", `Play ${game.title}`);
    play.addEventListener("click", () => openGame(game));
    setSavedState(save, game);
    save.addEventListener("click", () => toggleSaved(save, game));
    fragment.append(card);
  }

  elements.grid.replaceChildren(fragment);
  elements.grid.setAttribute("aria-busy", "false");
  elements.resultCount.textContent = state.query || state.category !== "all" || state.savedOnly ? "Filtered titles" : "Browse all titles";
  elements.empty.hidden = games.length !== 0;
  elements.showMore.hidden = shown.length >= games.length;
}

function filteredGames() {
  const games = state.games.filter((game) => {
    const matchesQuery = !state.query || `${game.title} ${game.filename}`.toLocaleLowerCase().includes(state.query);
    const matchesSaved = !state.savedOnly || state.saved.has(game.id);
    const matchesCategory = state.category === "all" || game.category === state.category;
    return matchesQuery && matchesSaved && matchesCategory;
  });

  return games.sort((a, b) => {
    if (state.sort === "title-desc") return b.title.localeCompare(a.title, "en", { numeric: true });
    if (state.sort === "size-asc") return a.packageBytes - b.packageBytes;
    if (state.sort === "size-desc") return b.packageBytes - a.packageBytes;
    return a.title.localeCompare(b.title, "en", { numeric: true });
  });
}

function populateCategories() {
  const categories = [...new Set(state.games.map((game) => game.category || "Casual"))].sort();
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    elements.category.append(option);
  }
}

function toggleSaved(button, game) {
  if (state.saved.has(game.id)) state.saved.delete(game.id);
  else state.saved.add(game.id);
  localStorage.setItem("goarxyz-saved", JSON.stringify([...state.saved]));
  setSavedState(button, game);
  if (state.savedOnly) render();
}

function setSavedState(button, game) {
  const saved = state.saved.has(game.id);
  button.classList.toggle("saved", saved);
  button.setAttribute("aria-label", `${saved ? "Remove" : "Save"} ${game.title}`);
  button.title = saved ? "Remove from saved" : "Save game";
}

function formatBytes(bytes) {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function openGame(game) {
  elements.player.hidden = false;
  document.body.classList.add("player-open");
  elements.playerTitle.textContent = game.title;
  elements.playerDownload.href = game.packageUrl;
  elements.playerStatus.hidden = false;
  elements.playerStatus.classList.remove("player-error");
  elements.playerStatus.querySelector("p").textContent = "Downloading and preparing game…";
  elements.frame.removeAttribute("src");

  try {
    if (!window.fflate) throw new Error("The ZIP reader could not load. Check your connection and try again.");
    const bytes = await loadPackage(game);
    const files = await unzipPackage(bytes);
    const metadataFile = files["metadata.json"];
    if (!metadataFile) throw new Error("Package metadata is missing.");
    const metadata = JSON.parse(window.fflate.strFromU8(metadataFile));
    const html = files[metadata.filename];
    if (!html) throw new Error(`The package does not contain ${metadata.filename}.`);
    const launchUrl = await publishGameBundle(game, metadata.filename, files);
    elements.frame.src = launchUrl;
    elements.frame.addEventListener("load", () => {
      elements.playerStatus.hidden = true;
    }, { once: true });
  } catch (error) {
    elements.playerStatus.classList.add("player-error");
    elements.playerStatus.querySelector("p").textContent = error.message;
  }
}

async function registerGameWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support the game launcher.");
  }
  await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  await navigator.serviceWorker.ready;
}

async function publishGameDocument(game, filename, html) {
  const path = `./play/${encodeURIComponent(game.id)}/${encodeURIComponent(filename)}`;
  const url = new URL(path, window.location.href).href;
  const cache = await caches.open("offline-arcade-documents-v1");
  await cache.put(url, new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  }));
  return url;
}

function unzipPackage(bytes) {
  return new Promise((resolve, reject) => {
    window.fflate.unzip(new Uint8Array(bytes), (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

async function loadPackage(game) {
  if (!("caches" in window)) {
    const response = await fetch(game.packageUrl);
    if (!response.ok) throw new Error(`Game download failed (${response.status}).`);
    return response.arrayBuffer();
  }
  const cache = await caches.open("offline-arcade-packages-v2");
  let response = await cache.match(game.packageUrl);
  if (!response) {
    response = await fetch(game.packageUrl);
    if (!response.ok) throw new Error(`Game download failed (${response.status}).`);
    await cache.put(game.packageUrl, response.clone());
  }
  return response.arrayBuffer();
}

function closePlayer() {
  elements.player.hidden = true;
  document.body.classList.remove("player-open");
  elements.frame.removeAttribute("src");
}