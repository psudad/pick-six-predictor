/**
 * storage.js — Save picks in the browser (localStorage) and export/import JSON.
 */

const STORAGE_KEY = "pick-six-picks-v1";

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return emptyStore();
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return emptyStore();
    }
    return {
      version: 1,
      picks: parsed.picks && typeof parsed.picks === "object" ? parsed.picks : {},
      manualGames:
        parsed.manualGames && typeof parsed.manualGames === "object"
          ? parsed.manualGames
          : {},
    };
  } catch {
    return emptyStore();
  }
}

function emptyStore() {
  return { version: 1, picks: {}, manualGames: {} };
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function pickKey(season, week, gameId) {
  return `${season}|w${week}|${gameId}`;
}

function getPick(season, week, gameId) {
  const store = loadStore();
  return store.picks[pickKey(season, week, gameId)] || null;
}

function setPick(season, week, gameId, pickedSide, teamName) {
  const store = loadStore();
  store.picks[pickKey(season, week, gameId)] = {
    season,
    week,
    gameId,
    pickedSide,
    teamName,
    updatedAt: new Date().toISOString(),
  };
  saveStore(store);
}

function manualGamesKey(season, week) {
  return `${season}|w${week}`;
}

function getManualGames(season, week) {
  const store = loadStore();
  return store.manualGames[manualGamesKey(season, week)] || [];
}

function addManualGame(season, week, game) {
  const store = loadStore();
  const key = manualGamesKey(season, week);
  const list = store.manualGames[key] || [];
  list.push(game);
  store.manualGames[key] = list;
  saveStore(store);
}

function exportPicksJson() {
  const store = loadStore();
  const blob = new Blob([JSON.stringify(store, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `pick-six-picks-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importPicksJson(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(String(reader.result));
        if (!incoming.picks || typeof incoming.picks !== "object") {
          resolve({ ok: false, message: "That file does not look like a picks backup." });
          return;
        }
        const store = loadStore();
        store.picks = { ...store.picks, ...incoming.picks };
        if (incoming.manualGames && typeof incoming.manualGames === "object") {
          store.manualGames = { ...store.manualGames, ...incoming.manualGames };
        }
        saveStore(store);
        resolve({ ok: true, message: "Import successful. Your picks were merged in." });
      } catch {
        resolve({ ok: false, message: "Could not read that JSON file." });
      }
    };
    reader.onerror = () => resolve({ ok: false, message: "Could not read the file." });
    reader.readAsText(file);
  });
}
