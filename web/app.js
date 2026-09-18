const state = {
  games: [],
  query: "",
  sort: "title-asc",
  savedOnly: false,
  visible: 48,
  saved: new Set(JSON.parse(localStorage.getItem("offline-arcade-saved") || "[]"))
};

const elements = {
  grid: document.querySelector("#game-grid"),
  template: document.querySelector("#game-card-template"),
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  savedFilter: document.querySelector("#saved-filter"),
  resultCount: document.querySelector("#result-count"),
  heroCount: document.querySelector("#hero-count"),
  empty: document.querySelector("#empty"),
  showMore: document.querySelector("#show-more")
};

init();

async function init() {
  try {
    const response = await fetch("./api/catalog.json");
    if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
    const catalog = await response.json();
    state.games = catalog.games;
    elements.heroCount.textContent = catalog.gameCount.toLocaleString();
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
}

function render() {
  const games = filteredGames();
  const shown = games.slice(0, state.visible);
  const fragment = document.createDocumentFragment();

  for (const game of shown) {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    const image = card.querySelector(".cover");
    const save = card.querySelector(".save-button");
    const download = card.querySelector(".download-link");
    image.src = `./${game.cover}`;
    image.alt = `${game.title} game artwork`;
    card.querySelector("h3").textContent = game.title;
    card.querySelector(".size").textContent = formatBytes(game.packageBytes);
    download.href = game.packageUrl;
    download.setAttribute("download", game.packageFilename);
    download.setAttribute("aria-label", `Download ${game.title} ZIP`);
    setSavedState(save, game);
    save.addEventListener("click", () => toggleSaved(save, game));
    fragment.append(card);
  }

  elements.grid.replaceChildren(fragment);
  elements.grid.setAttribute("aria-busy", "false");
  elements.resultCount.textContent = `${games.length.toLocaleString()} ${games.length === 1 ? "game" : "games"}`;
  elements.empty.hidden = games.length !== 0;
  elements.showMore.hidden = shown.length >= games.length;
}

function filteredGames() {
  const games = state.games.filter((game) => {
    const matchesQuery = !state.query || `${game.title} ${game.filename}`.toLocaleLowerCase().includes(state.query);
    const matchesSaved = !state.savedOnly || state.saved.has(game.id);
    return matchesQuery && matchesSaved;
  });

  return games.sort((a, b) => {
    if (state.sort === "title-desc") return b.title.localeCompare(a.title, "en", { numeric: true });
    if (state.sort === "size-asc") return a.packageBytes - b.packageBytes;
    if (state.sort === "size-desc") return b.packageBytes - a.packageBytes;
    return a.title.localeCompare(b.title, "en", { numeric: true });
  });
}

function toggleSaved(button, game) {
  if (state.saved.has(game.id)) state.saved.delete(game.id);
  else state.saved.add(game.id);
  localStorage.setItem("offline-arcade-saved", JSON.stringify([...state.saved]));
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