"use strict";
// Audora (PC) — Événements de Python, barre des tâches, démarrage.
// Fichiers charges dans l'ordre par index.html, ils partagent les memes variables globales.

// ---------- Événements envoyés par Python ----------

window.onBackendEvent = (name, payload) => {
  switch (name) {
    case "download": onDownloadEvent(payload); break;
    case "download_removed":
      S.downloads = S.downloads.filter((j) => j.id !== payload);
      updateBadge();
      if (S.view.name === "downloads") renderDlList();
      break;
    case "library_changed": reloadLibrary(); break;
    case "trim": onTrimEvent(payload); break;
    case "engine": onEngineEvent(payload); break;
    case "phone_changed": refreshPhone(); break;
    case "toast": toast(payload?.message || ""); break;
    case "player_action": runPlayerAction(payload || {}); break;
    case "window_state": updateMaximizeButton(payload?.maximized); break;
  }
};

// ---------- Commandes de la barre des tâches ----------

/** Titres les plus écoutés (même ordre que "Écoutés souvent" dans la barre des tâches). */
function frequentTracks() {
  return audioTracks()
    .filter((t) => t.play_count > 0)
    .sort((a, b) => (b.play_count - a.play_count) || ((b.last_played || 0) - (a.last_played || 0)));
}

function runPlayerAction({ action, track }) {
  switch (action) {
    case "toggle": togglePlay(); break;
    case "next": next(); break;
    case "prev": prev(); break;
    case "shuffle":
      toggleShuffle();
      toast(S.shuffle ? "Aléatoire activé" : "Aléatoire désactivé");
      break;
    case "repeat":
      cycleRepeat();
      toast({ off: "Répétition désactivée", all: "Répéter toute la file", one: "Répéter ce titre" }[S.repeat]);
      break;
    case "play": {
      // Les plus écoutés d'abord, puis le reste de la bibliothèque pour que "Suivant" continue.
      const frequent = frequentTracks().map((t) => t.id);
      const ids = [...frequent, ...audioTracks().map((t) => t.id).filter((id) => !frequent.includes(id))];
      const index = ids.indexOf(track);
      if (index >= 0) playList(ids, index);
      break;
    }
  }
}

// ---------- Fenêtre ----------

function updateMaximizeButton(maximized) {
  const btn = $("#win-max");
  if (!btn) return;
  btn.innerHTML = icon(maximized ? "win-restore" : "win-max");
  btn.title = maximized ? "Restaurer" : "Agrandir";
  btn.setAttribute("aria-label", btn.title);
}

// ---------- Démarrage ----------

function applyLibrary({ tracks, playlists }) {
  S.tracks = tracks;
  S.byId = new Map(tracks.map((t) => [t.id, t]));
  S.playlists = playlists;
  renderPlaylistNav();
}

let reloadPromise = null;
async function reloadLibrary() {
  if (reloadPromise) return reloadPromise;
  reloadPromise = (async () => {
    try {
      applyLibrary(await api("get_library"));
      refreshView();
      if (!S.sessionRestored) restoreSession();
    } finally {
      reloadPromise = null;
    }
  })();
  return reloadPromise;
}

async function init() {
  hydrateIcons();
  bindPlayer();
  const state = await api("get_state");
  applyLibrary(state);
  S.downloads = state.downloads;
  S.config = state.config;
  S.bridge = state.bridge;
  S.autostart = !!state.autostart;
  S.engine = state.engine;
  S.genres = state.genres || [];
  S.phone = state.phone || {};
  setVolumePosition(gainToPosition(typeof S.config.volume === "number" ? S.config.volume : 0.8), { save: false });
  applyTheme(S.config.theme || "prune");
  updateBadge();
  api("win_is_maximized").then(updateMaximizeButton).catch(() => {});
  go("home");
  restoreSession();
}

init().catch((e) => toast(`Démarrage impossible : ${errMsg(e)}`, "error"));
