"use strict";

/* Audora (téléphone) — l'interface. La lecture, le stockage et la synchro sont faits par
   Android (window.Android), qui renvoie ses événements via window.onNative(nom, données). */

const A = window.Android;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;
const byName = (a, b) => a.localeCompare(b, "fr", { sensitivity: "base" });

function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return "0:00";
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function fmtSize(bytes) {
  if (!bytes) return "0 Mo";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Go` : `${Math.round(bytes / 1024 ** 2)} Mo`;
}

// ---------- Icônes ----------

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  library: '<path d="M4 4v16M9 4v16"/><path d="m14 4.5 5 15"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sync: '<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.5 3v4.5H14M5.5 21v-4.5H10"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  next: '<path d="M5 5.5v13a1 1 0 0 0 1.5.86L16 13.5V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.5L6.5 4.64A1 1 0 0 0 5 5.5z"/>',
  prev: '<path d="M19 5.5v13a1 1 0 0 1-1.5.86L8 13.5V18a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v4.5l9.5-5.86A1 1 0 0 1 19 5.5z"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  queue: '<path d="M3 6h13M3 12h13M3 18h8"/><path d="m16 15 5 3-5 3z"/>',
  more: '<circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/>',
  "play-next": '<path d="M3 6h12M3 12h8M3 18h8"/><path d="m15 13 6 4-6 4z"/>',
  "list-plus": '<path d="M3 6h12M3 12h12M3 18h8M18 15v6M15 18h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  pc: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2M6 10v4M10 10v4"/>',
};
const FILLED = new Set(["play", "pause", "next", "prev", "more"]);
const icon = (n) => `<svg class="ico${FILLED.has(n) ? " filled" : ""}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ""}</svg>`;
const hydrate = (root = document) => $$("i[data-icon]", root).forEach((el) => (el.outerHTML = icon(el.dataset.icon)));

// ---------- Thèmes (mêmes que sur le PC) ----------

const THEMES = [
  ["prune", "Prune", "#17121f", "#1f1929", "#2a2236", "#3a3048", "#f4effa", "#b3a8c6", "#7d7290", "#ffb547", "#2b1a00", 1],
  ["cameleon", "Caméléon", "#141416", "#1c1c20", "#26262b", "#36363d", "#f1f1f4", "#a9a9b3", "#71717b", "#ffb547", "#111111", 1],
  ["minuit", "Minuit", "#0f1420", "#161d2c", "#1f2839", "#2c3850", "#eef3fb", "#9fb0c8", "#67788f", "#5ad1e6", "#04232a", 1],
  ["ocean", "Océan", "#0d1a1d", "#132428", "#1b3136", "#284449", "#e8f6f6", "#9dbcbd", "#648385", "#3ee0c5", "#03241f", 1],
  ["foret", "Forêt", "#111a15", "#17231c", "#203027", "#2d4136", "#edf5ef", "#a3b8aa", "#6c8274", "#8fd694", "#0d2a10", 1],
  ["braise", "Braise", "#1a1412", "#231b18", "#2e2420", "#42342e", "#f8efe9", "#c2ada2", "#86736a", "#ff8a4c", "#2e1205", 1],
  ["rubis", "Rubis", "#141010", "#1d1717", "#282020", "#3a2e2e", "#f7eeee", "#bfa9a9", "#826d6d", "#ff5a52", "#2d0402", 1],
  ["sakura", "Sakura", "#1c1317", "#261a20", "#33232b", "#48323d", "#fbeef3", "#c9a9b6", "#8c6f7b", "#ff8fb8", "#330a1b", 1],
  ["neon", "Néon", "#120b1f", "#1a1030", "#251843", "#3a2766", "#f3eaff", "#b4a3d6", "#7a6a9c", "#ff4fd8", "#2b0026", 1],
  ["graphite", "Graphite", "#151515", "#1d1d1d", "#272727", "#363636", "#f2f2f2", "#a8a8a8", "#6e6e6e", "#e8e8e8", "#111111", 1],
  ["oled", "Noir total", "#000000", "#0a0a0a", "#161616", "#262626", "#ffffff", "#a3a3a3", "#666666", "#ffb547", "#2b1a00", 1],
  ["cafe", "Café crème", "#f6f1ea", "#fffdf9", "#ece4d8", "#ddd2c3", "#2a211b", "#6d5f53", "#9c8e81", "#b0642a", "#fff8f0", 0],
  ["lavande", "Lavande", "#f4f1fa", "#ffffff", "#e8e2f3", "#d6cde8", "#231c33", "#625878", "#958ba8", "#7b4fe0", "#ffffff", 0],
  ["menthe", "Menthe", "#eef6f2", "#ffffff", "#dfece6", "#c8ddd3", "#14261e", "#4f665b", "#84998f", "#1f9e6e", "#ffffff", 0],
  ["papier", "Papier", "#f7f7f8", "#ffffff", "#ececee", "#dcdce0", "#18181b", "#5f5f68", "#93939c", "#e2513f", "#ffffff", 0],
];
const themeById = (id) => THEMES.find((t) => t[0] === id) || THEMES.find((t) => t[0] === "prune");
const activeThemeId = () => S.lib.theme_override || S.lib.theme || "prune";
let chameleonAccent = null;  // couleur tiree de la pochette en cours
function applyTheme() {
  const t = themeById(activeThemeId());
  ["--bg", "--panel", "--raise", "--line", "--text", "--text-2", "--text-3", "--accent", "--accent-ink"]
    .forEach((name, i) => document.documentElement.style.setProperty(name, t[i + 2]));
  if (t[0] === "cameleon" && chameleonAccent) document.documentElement.style.setProperty("--accent", chameleonAccent);
  document.documentElement.style.colorScheme = t[11] ? "dark" : "light";
}

/** Caméléon : couleur dominante (vive) de la pochette, éclaircie pour rester lisible. */
function updateChameleon(track) {
  if (themeById(activeThemeId())[0] !== "cameleon") return;
  if (!track?.cover) { chameleonAccent = null; applyTheme(); return; }
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 24;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 24, 24);
      const d = ctx.getImageData(0, 0, 24, 24).data;
      let R = 0, G = 0, B = 0, W = 0;
      for (let i = 0; i < d.length; i += 4) {
        const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
        const sat = max ? (max - min) / max : 0;
        const w = 0.04 + sat * sat * (max > 40 ? 1 : 0.1);
        R += d[i] * w; G += d[i + 1] * w; B += d[i + 2] * w; W += w;
      }
      const mix = (v) => Math.round((v / W) * 0.7 + 255 * 0.3);
      chameleonAccent = `rgb(${mix(R)}, ${mix(G)}, ${mix(B)})`;
      applyTheme();
    } catch { /* pochette illisible */ }
  };
  img.src = `/cover/${track.id}?v=${track.mtime || 0}`;
}

// ---------- État ----------

const S = {
  lib: { tracks: [], playlists: [] }, byId: new Map(),
  view: { name: "home", param: null }, stack: [], lists: {},
  libraryTab: "songs", filter: "",
  player: {},
  syncing: false, syncSilent: false, syncMsg: "", syncDone: 0, syncTotal: 0,
  found: null, chosenHost: null, discovering: false,
  search: { query: "", results: null, loading: false, error: null, details: {} },
  jobs: {},  // telechargements demandes au PC, par identifiant de video
  storage: null, moving: null,
};

function loadLibrary() {
  try { S.lib = JSON.parse(A.library()); } catch { S.lib = { tracks: [], playlists: [] }; }
  S.lib.tracks = S.lib.tracks || [];
  S.lib.playlists = S.lib.playlists || [];
  S.byId = new Map(S.lib.tracks.map((t) => [t.id, t]));
  applyTheme();
}

const tracksSorted = () => [...S.lib.tracks].sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
const register = (key, list) => { S.lists[key] = list.map((t) => t.id); return key; };
function artists() {
  const map = new Map();
  for (const t of S.lib.tracks) {
    if (!map.has(t.artist)) map.set(t.artist, []);
    map.get(t.artist).push(t);
  }
  return [...map].map(([name, tracks]) => ({ name, tracks, cover: tracks.find((t) => t.cover) || tracks[0] }))
    .sort((a, b) => byName(a.name, b.name));
}

// ---------- Requêtes vers le PC (via Android, qui garde le jeton) ----------

let requestSeq = 0;
const pending = new Map();
function pc(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const id = String(++requestSeq);
    pending.set(id, { resolve, reject });
    A.pc(id, method, path, body ? JSON.stringify(body) : "");
  });
}

// ---------- Morceaux d'interface ----------

const PALETTE = [[255, 181, 71], [146, 112, 214], [94, 170, 160], [230, 110, 130], [110, 150, 230], [200, 140, 90]];
function hashStr(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function coverHTML(t, cls = "") {
  if (t && t.cover) return `<div class="cover ${cls}"><img src="/cover/${t.id}?v=${t.mtime || 0}" alt="" loading="lazy"></div>`;
  const [r, g, b] = PALETTE[hashStr(t?.artist || t?.title || "") % PALETTE.length];
  return `<div class="cover ${cls}"><div class="cover-fallback" style="background:linear-gradient(135deg,rgb(${r} ${g} ${b} / .9),rgb(${r} ${g} ${b} / .3))">${esc((t?.title || "?").charAt(0).toUpperCase())}</div></div>`;
}

function rowHTML(t, key, i, playlistId = null) {
  const playing = S.player.track === t.id ? " playing" : "";
  const pl = playlistId != null ? ` data-playlist="${playlistId}" data-pindex="${i}"` : "";
  return `<div class="row${playing}" data-action="play" data-list="${key}" data-index="${i}" data-track="${t.id}">
    ${coverHTML(t)}
    <div style="min-width:0"><div class="row-title">${esc(t.title)}</div><div class="row-sub">${esc(t.artist)}</div></div>
    <button class="icon-btn" data-action="menu" data-track="${t.id}"${pl} aria-label="Plus d'options">${icon("more")}</button>
  </div>`;
}

function cardHTML(t, key, i) {
  return `<button class="card" data-action="play" data-list="${key}" data-index="${i}">${coverHTML(t)}
    <div class="card-title">${esc(t.title)}</div><div class="card-sub">${esc(t.artist)}</div></button>`;
}

const settingsButton = `<button class="icon-btn" data-action="tab" data-view="settings" aria-label="Réglages">${icon("settings")}</button>`;
const pageHead = (title, sub = "") => `<div class="page-head"><div><h1 class="title">${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div>${settingsButton}</div>`;
const backButton = () => `<button class="back" data-action="back">${icon("back")}Retour</button>`;

function emptyLibrary() {
  const paired = !!S.lib.pc;
  return `<div class="empty"><h2>${paired ? "Aucune musique pour l'instant" : "Bienvenue dans Audora"}</h2>
    <p>${paired
      ? "Cherche une musique dans l'onglet Rechercher, ou envoie-en depuis Audora sur ton PC (clic droit, puis « Envoyer sur le téléphone »)."
      : "Associe ton PC dans les réglages pour y choisir les musiques à emporter sur ton téléphone."}</p>
    <button class="btn primary" data-action="tab" data-view="${paired ? "search" : "settings"}">${paired ? "Rechercher une musique" : "Associer mon PC"}</button></div>`;
}

// ---------- Vues ----------

const VIEWS = {};
const MOUNTS = {};

// Rangées par genre (le genre vient du PC ; choisi à la main ou trouvé automatiquement).
function genreShelvesHTML(tracks) {
  const OTHER = "Autres";
  const byGenre = new Map();
  for (const t of tracks) {
    const g = t.genre || OTHER;
    if (!byGenre.has(g)) byGenre.set(g, []);
    byGenre.get(g).push(t);
  }
  for (const [g, list] of [...byGenre]) {
    if (g !== OTHER && list.length < 3) {  // rangée presque vide : rejoint "Autres"
      if (!byGenre.has(OTHER)) byGenre.set(OTHER, []);
      byGenre.get(OTHER).push(...list);
      byGenre.delete(g);
    }
  }
  const genres = [...byGenre.keys()].sort((a, b) => (a === OTHER) - (b === OTHER) || byGenre.get(b).length - byGenre.get(a).length);
  return genres.map((g, i) => {
    const list = byGenre.get(g);
    const key = register(`genre-${i}`, list);
    return `<h2 class="section">${esc(g)}<button data-action="play-all" data-list="${key}">${icon("play")} Tout écouter</button></h2>
      <div class="shelf">${list.slice(0, 12).map((t, j) => cardHTML(t, key, j)).join("")}</div>`;
  }).join("");
}

/** Nouvelle version de l'appli disponible sur le PC ? */
function updateAvailable() {
  const apk = S.lib.apk;
  return apk && apk.version_code && A.versionCode && apk.version_code > A.versionCode() ? apk : null;
}

function bannersHTML() {
  let html = "";
  const apk = updateAvailable();
  if (apk) {
    html += `<div class="banner"><div><strong>Nouvelle version d'Audora</strong><div class="hint">Version ${esc(apk.version_name || "")} disponible sur ton PC.</div></div>
      <button class="btn primary" data-action="install-update">Installer</button></div>`;
  }
  if (S.batteryRestricted && !S.batteryBannerHidden) {
    html += `<div class="banner"><div><strong>Musique coupée écran éteint ?</strong><div class="hint">Autorise Audora à ignorer l'économie de batterie.</div></div>
      <button class="btn" data-action="battery-exempt">Autoriser</button>
      <button class="icon-btn" data-action="hide-battery-banner" aria-label="Masquer">${icon("close")}</button></div>`;
  }
  return html;
}

VIEWS.home = () => {
  const all = tracksSorted();
  if (!all.length) return pageHead("Audora") + emptyLibrary();
  const played = [...S.lib.tracks].filter((t) => t.last_played).sort((a, b) => b.last_played - a.last_played);
  const hero = played[0] || all[0];
  const heroKey = register("hero", [hero, ...all.filter((t) => t.id !== hero.id)]);
  const recent = all.slice(0, 12);
  const rk = register("recent", recent);
  const ar = artists().sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 10);
  let html = pageHead("Audora", `${plural(all.length, "titre")} sur ce téléphone`) + bannersHTML() + `
    <div class="resume">${coverHTML(hero)}
      <div style="min-width:0"><div class="resume-label">${played.length ? "Reprendre l'écoute" : "Dernier ajout"}</div>
        <div class="resume-title">${esc(hero.title)}</div><div class="muted">${esc(hero.artist)}</div>
        <button class="btn primary" data-action="play" data-list="${heroKey}" data-index="0">${icon("play")}Lecture</button></div>
    </div>
    <div class="actions" style="margin-top:14px"><button class="btn block" data-action="shuffle-all" data-list="${register("all", all)}">${icon("shuffle")}Tout en aléatoire</button></div>`;
  html += genreShelvesHTML(all);
  if (S.lib.playlists.length) {
    html += `<h2 class="section">Playlists</h2><div class="shelf">${S.lib.playlists.map((p) => `
      <button class="card" data-action="open" data-view="playlist" data-param="${p.id}">${coverHTML(S.byId.get(p.track_ids[0]) || { title: p.name })}
        <div class="card-title">${esc(p.name)}</div><div class="card-sub">${plural(p.track_ids.length, "titre")}</div></button>`).join("")}</div>`;
  }
  if (ar.length) {
    html += `<h2 class="section">Artistes</h2><div class="shelf">${ar.map((a) => `
      <button class="card round" data-action="open" data-view="artist" data-param="${esc(a.name)}">${coverHTML(a.cover, "round")}
        <div class="card-title">${esc(a.name)}</div><div class="card-sub">${plural(a.tracks.length, "titre")}</div></button>`).join("")}</div>`;
  }
  return html;
};

// --- Bibliothèque : Titres / Artistes / Playlists ---

VIEWS.library = () => {
  const tab = S.libraryTab;
  const seg = (id, label) => `<button class="${tab === id ? "active" : ""}" data-action="library-tab" data-tab="${id}">${label}</button>`;
  let html = pageHead("Bibliothèque") + `<div class="segmented">${seg("songs", "Titres")}${seg("artists", "Artistes")}${seg("playlists", "Playlists")}</div>`;
  const all = tracksSorted();
  if (tab === "songs") {
    if (!all.length) return html + emptyLibrary();
    html += `<div class="actions"><button class="btn primary" data-action="play-all" data-list="${register("songs-all", all)}">${icon("play")}Lecture</button>
        <button class="btn" data-action="shuffle-all" data-list="songs-all">${icon("shuffle")}Aléatoire</button>
        <button class="btn" data-action="open" data-view="duplicates">${icon("copy")}Doublons</button></div>
      <input class="filter" id="filter" type="search" placeholder="Filtrer ${plural(all.length, "titre")}" value="${esc(S.filter)}">
      <div id="songs-list"></div>`;
  } else if (tab === "artists") {
    const ar = artists();
    html += ar.length ? `<div class="grid artists">${ar.map((a) => `<button class="card round" data-action="open" data-view="artist" data-param="${esc(a.name)}">
      ${coverHTML(a.cover, "round")}<div class="card-title">${esc(a.name)}</div><div class="card-sub">${plural(a.tracks.length, "titre")}</div></button>`).join("")}</div>`
      : emptyLibrary();
  } else {
    const pls = S.lib.playlists;
    html += `<div class="actions"><button class="btn primary" data-action="new-playlist">${icon("plus")}Nouvelle playlist</button></div>`;
    html += pls.length
      ? pls.map((p) => `<button class="list-item" data-action="open" data-view="playlist" data-param="${p.id}">
          ${coverHTML(S.byId.get(p.track_ids[0]) || { title: p.name })}
          <div style="min-width:0"><div class="row-title">${esc(p.name)}</div><div class="row-sub">${plural(p.track_ids.length, "titre")}</div></div></button>`).join("")
      : `<div class="empty"><h2>Aucune playlist</h2><p>Crée-en une ici, ou envoie-en depuis Audora sur ton PC. Elles se synchronisent dans les deux sens.</p></div>`;
  }
  return html;
};

MOUNTS.library = () => {
  const filter = $("#filter");
  if (!filter) return;
  filter.addEventListener("input", (e) => { S.filter = e.target.value; renderSongs(); });
  renderSongs();
};

function renderSongs() {
  const box = $("#songs-list");
  if (!box) return;
  const words = norm(S.filter).split(/\s+/).filter(Boolean);
  const list = tracksSorted().filter((t) => words.every((w) => norm(`${t.title} ${t.artist} ${t.album}`).includes(w)));
  const key = register("songs", list);
  box.innerHTML = list.length ? list.map((t, i) => rowHTML(t, key, i)).join("") : `<p class="muted">Aucun titre ne correspond.</p>`;
}

VIEWS.artist = (name) => {
  const tracks = tracksSorted().filter((t) => t.artist === name);
  if (!tracks.length) return backButton() + `<p class="muted">Plus aucun titre de cet artiste.</p>`;
  const key = register("artist", tracks);
  return backButton() + `<div class="collection-head">${coverHTML(tracks.find((t) => t.cover) || tracks[0], "round")}
    <h1>${esc(name)}</h1><div class="muted">${plural(tracks.length, "titre")}</div>
    <div class="actions"><button class="btn primary" data-action="play-all" data-list="${key}">${icon("play")}Lecture</button>
      <button class="btn" data-action="shuffle-all" data-list="${key}">${icon("shuffle")}Aléatoire</button></div></div>
    ${tracks.map((t, i) => rowHTML(t, key, i)).join("")}`;
};

VIEWS.playlist = (id) => {
  const pl = S.lib.playlists.find((p) => String(p.id) === String(id));
  if (!pl) return backButton() + `<p class="muted">Playlist introuvable.</p>`;
  const tracks = pl.track_ids.map((tid) => S.byId.get(tid)).filter(Boolean);
  const key = register("playlist", tracks);
  return backButton() + `<div class="collection-head">${coverHTML(tracks[0] || { title: pl.name })}
    <h1>${esc(pl.name)}</h1><div class="muted">${plural(tracks.length, "titre")}</div>
    <div class="actions">${tracks.length ? `<button class="btn primary" data-action="play-all" data-list="${key}">${icon("play")}Lecture</button>
      <button class="btn" data-action="shuffle-all" data-list="${key}">${icon("shuffle")}Aléatoire</button>` : ""}
      <button class="icon-btn" data-action="rename-playlist" data-id="${pl.id}" aria-label="Renommer">${icon("edit")}</button>
      <button class="icon-btn" data-action="remove-playlist" data-id="${pl.id}" aria-label="Retirer du téléphone">${icon("trash")}</button></div></div>
    ${tracks.length ? tracks.map((t, i) => rowHTML(t, key, i, pl.id)).join("")
      : `<p class="muted" style="text-align:center">Ajoute des titres avec le menu ⋮ d'une chanson, puis « Ajouter à une playlist ».</p>`}`;
};

// --- Doublons (sur le téléphone) ---

function duplicateGroups() {
  const key = (t) => norm(t.artist).replace(/[\W_]+/g, "") + "|" + norm(t.title).replace(/\(.*?\)|\[.*?\]/g, "").replace(/[\W_]+/g, "");
  const groups = new Map();
  for (const t of S.lib.tracks) {
    const k = t.source_id ? `yt:${t.source_id}` : key(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

VIEWS.duplicates = () => {
  const groups = duplicateGroups();
  let html = backButton() + `<h1 class="title">Doublons</h1><p class="sub">Les chansons présentes plusieurs fois sur le téléphone. Coche celles à retirer.</p>`;
  if (!groups.length) return html + `<div class="empty"><h2>Aucun doublon</h2><p>Chaque chanson n'est qu'une seule fois sur ton téléphone.</p></div>`;
  if (!S.dupes) {  // par défaut : tout coché sauf le plus écouté de chaque groupe
    S.dupes = new Set();
    for (const g of groups) {
      const keep = [...g].sort((a, b) => (b.play_count || 0) - (a.play_count || 0))[0];
      g.filter((t) => t.id !== keep.id && t.direct).forEach((t) => S.dupes.add(t.id));
    }
  }
  html += `<button class="btn danger block" data-action="dupes-remove" ${S.dupes.size ? "" : "disabled"} style="margin-bottom:14px">${icon("trash")}Retirer ${plural(S.dupes.size, "titre")} du téléphone</button>`;
  html += groups.map((g) => `<div class="panel dupe-group"><div class="row-title" style="margin-bottom:6px">${esc(g[0].title)} <span class="muted">${esc(g[0].artist)}</span></div>
    ${g.map((t) => `<label class="dupe-row">
      <input type="checkbox" data-dupe="${t.id}"${S.dupes.has(t.id) ? " checked" : ""}${t.direct ? "" : " disabled"}>
      ${coverHTML(t)}<span style="min-width:0"><span class="row-title">${esc(t.title)}</span><span class="row-sub">${fmtTime(t.duration)}${t.play_count ? `, ${plural(t.play_count, "écoute")}` : ""}${t.direct ? "" : ", vient d'une playlist"}</span></span>
    </label>`).join("")}</div>`).join("");
  return html;
};

// --- Recherche YouTube (faite par le PC) ---

VIEWS.search = () => {
  let html = pageHead("Rechercher", "Sur YouTube, via Audora sur ton PC");
  if (!S.lib.pc) {
    return html + `<div class="empty"><h2>Associe d'abord ton PC</h2>
      <p>La recherche et le téléchargement sont faits par Audora sur ton PC, puis la musique arrive sur ton téléphone.</p>
      <button class="btn primary" data-action="tab" data-view="settings">Ouvrir les réglages</button></div>`;
  }
  html += `<form class="search-form" id="search-form"><input class="filter" id="search-input" type="search" enterkeyhint="search"
      placeholder="Artiste, titre…" value="${esc(S.search.query)}"><button class="btn primary" type="submit" aria-label="Rechercher">${icon("search")}</button></form>
    <div id="yt-results"></div>`;
  return html;
};

MOUNTS.search = () => {
  $("#search-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    $("#search-input").blur();
    runSearch($("#search-input").value);
  });
  renderResults();
};

async function runSearch(query) {
  query = query.trim();
  if (!query) return;
  stopPreview();
  Object.assign(S.search, { query, results: null, loading: true, error: null, details: {} });
  renderResults();
  try {
    const data = await pc("GET", `/sync/search?q=${encodeURIComponent(query)}`);
    if (S.search.query !== query) return;
    S.search.results = data.results || [];
    S.search.loading = false;
    renderResults();
    const ids = S.search.results.map((r) => r.id).join(",");
    if (ids) {
      const details = await pc("GET", `/sync/details?ids=${ids}`);
      if (S.search.query === query) { S.search.details = details.details || {}; renderResults(); }
    }
  } catch (e) {
    if (S.search.query !== query) return;
    S.search.loading = false;
    S.search.error = e.message;
    renderResults();
  }
}

function renderResults() {
  const box = $("#yt-results");
  if (!box) return;
  const s = S.search;
  if (s.loading) { box.innerHTML = `<p class="muted">Recherche…</p>`; return; }
  if (s.error) { box.innerHTML = `<p class="yt-status error">${esc(s.error)}</p>`; return; }
  if (!s.results) { box.innerHTML = `<p class="hint">Touche une miniature pour écouter un aperçu, puis télécharge : la musique arrive sur ton téléphone dès qu'elle est prête.</p>`; return; }
  if (!s.results.length) { box.innerHTML = `<p class="muted">Aucun résultat.</p>`; return; }
  box.innerHTML = s.results.map(resultHTML).join("");
}

function resultHTML(r) {
  const year = S.search.details?.[r.id]?.year;
  const job = S.jobs[r.id];
  const onPhone = r.on_phone || S.lib.tracks.some((t) => t.source_id === r.id) || job?.arrived;
  const previewing = preview.id === r.id;
  let action;
  if (onPhone) action = `<span class="tag" aria-label="Sur le téléphone">${icon("check")}</span>`;
  else if (job && job.status !== "error") action = `<span class="tag"><span class="spinner" style="border-color:var(--line);border-top-color:var(--accent)"></span></span>`;
  else action = `<button class="icon-btn accent" data-action="yt-download" data-id="${esc(r.id)}" aria-label="Télécharger sur le téléphone">${icon("download")}</button>`;
  let status = "";
  if (job && !onPhone) status = `<div class="yt-status${job.status === "error" ? " error" : ""}">${esc(jobText(job))}</div>`;
  else if (onPhone) status = `<div class="yt-status">Sur le téléphone</div>`;
  return `<div class="yt-row${previewing ? " previewing" : ""}">
    <button class="yt-thumb" data-action="yt-preview" data-id="${esc(r.id)}" aria-label="${previewing ? "Arrêter l'aperçu" : "Écouter un aperçu"}">
      <img src="${esc(r.thumb)}" alt="" loading="lazy">
      <span class="badge">${previewing && preview.loading ? '<span class="spinner"></span>' : icon(previewing ? "pause" : "play")}</span></button>
    <div style="min-width:0"><div class="row-title">${esc(r.title)}</div><div class="row-sub">${esc(r.artist)}</div>
      <div class="yt-meta">${year ? `<span>${year}</span>` : ""}<span>${fmtTime(r.duration)}</span></div>${status}</div>
    ${action}</div>`;
}

function jobText(job) {
  if (job.status === "error") return job.error || "Échec du téléchargement";
  if (job.status === "waiting") return "En attente du PC : envoyé à la prochaine synchro";
  if (job.status === "queued") return "En attente sur le PC…";
  if (job.status === "done") return "Prêt, transfert vers le téléphone…";
  return `Téléchargement sur le PC… ${Math.round((job.progress || 0) * 100)} %`;
}

// Suivi des téléchargements demandés au PC ; quand l'un est fini, on synchronise.
let jobsTimer = null;
function watchJobs() {
  if (jobsTimer) return;
  jobsTimer = setInterval(async () => {
    const active = Object.values(S.jobs).filter((j) => !j.arrived && j.status !== "error");
    if (!active.length) { clearInterval(jobsTimer); jobsTimer = null; return; }
    try {
      const data = await pc("GET", "/sync/downloads");
      let finished = false;
      for (const j of data.jobs || []) {
        const vid = (j.url || "").split("v=")[1];
        if (!vid || !S.jobs[vid] || S.jobs[vid].arrived) continue;
        if (S.jobs[vid].status !== "done" && j.status === "done") finished = true;
        S.jobs[vid] = { ...S.jobs[vid], ...j };
      }
      if (finished) startSync(true);
      if (S.view.name === "search") renderResults();
    } catch { /* PC momentanément injoignable : on réessaie */ }
  }, 2500);
}

// --- Aperçu (30 secondes, sans télécharger) ---

const PREVIEW_SECONDS = 30;
const previewAudio = document.getElementById("preview");
const preview = { id: null, loading: false, stopAt: 0 };

function stopPreview() {
  if (!preview.id) return;
  previewAudio.pause();
  previewAudio.removeAttribute("src");
  previewAudio.load();
  Object.assign(preview, { id: null, loading: false, stopAt: 0 });
  if (S.view.name === "search") renderResults();
}

async function startPreview(id) {
  const r = (S.search.results || []).find((x) => x.id === id);
  if (!r) return;
  stopPreview();
  A.command("pause", 0);  // l'aperçu remplace la musique en cours
  Object.assign(preview, { id, loading: true });
  renderResults();
  try {
    const data = await pc("GET", `/sync/stream/${encodeURIComponent(id)}`);
    if (preview.id !== id) return;
    const start = r.duration ? Math.min(r.duration * 0.3, Math.max(0, r.duration - PREVIEW_SECONDS)) : 0;
    previewAudio.src = data.url;
    previewAudio.addEventListener("loadedmetadata", () => { previewAudio.currentTime = start; }, { once: true });
    await previewAudio.play();
    preview.loading = false;
    preview.stopAt = start + PREVIEW_SECONDS;
    renderResults();
  } catch (e) {
    if (preview.id === id) { stopPreview(); toast(`Aperçu impossible : ${e.message || e}`, "error"); }
  }
}
previewAudio.addEventListener("timeupdate", () => { if (preview.stopAt && previewAudio.currentTime >= preview.stopAt) stopPreview(); });
previewAudio.addEventListener("ended", stopPreview);

// --- Réglages ---

VIEWS.settings = () => {
  const pc = S.lib.pc;
  const current = S.lib.theme_override || "";
  const pcTheme = themeById(S.lib.theme === "cameleon" ? "prune" : S.lib.theme);
  const card = (id, t, label) => `<button class="theme-card${current === id ? " active" : ""}" data-action="set-theme" data-theme="${id}">
      <div class="theme-swatch" style="background:${t[2]}"><b style="background:${t[6]}"></b><i style="background:${t[9]}"></i></div>
      <div class="theme-name">${esc(label)}</div></button>`;
  let html = `<h1 class="title">Réglages</h1><p class="sub">Audora ${esc(A.version ? A.version() : "")} pour Android</p>`;

  html += `<section class="settings-section"><h2>Apparence</h2><div class="theme-grid">
    ${card("", pcTheme, "Comme le PC")}${THEMES.map((t) => card(t[0], t, t[1])).join("")}</div></section>`;

  html += `<section class="settings-section"><h2>PC et synchronisation</h2><div class="panel">`;
  if (pc) {
    const last = S.lib.last_sync ? new Date(S.lib.last_sync * 1000).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "jamais";
    const pct = S.syncTotal ? Math.round((S.syncDone / S.syncTotal) * 100) : 0;
    html += `<h3>${icon("pc")} ${esc(pc.name || "PC")}</h3><p>Dernière synchro : ${esc(last)}</p>
      ${S.syncing ? `<div class="bar"><span style="width:${pct}%"></span></div><p class="hint">${esc(S.syncMsg)}${S.syncTotal ? ` (${S.syncDone}/${S.syncTotal})` : ""}</p>`
        : S.syncMsg ? `<p class="hint">${esc(S.syncMsg)}</p>` : ""}
      <button class="btn primary block" data-action="sync" ${S.syncing ? "disabled" : ""}>${icon("sync")}${S.syncing ? "Synchronisation…" : "Synchroniser maintenant"}</button>
      <div class="setting-row" style="margin-top:8px"><div><div class="label">Synchroniser à l'ouverture</div>
        <div class="desc">Quand ton PC est allumé, sur le même Wi-Fi.</div></div>
        <button class="switch${S.lib.auto_sync !== false ? " on" : ""}" data-action="toggle-auto-sync" aria-label="Synchroniser à l'ouverture"></button></div>
      <div class="setting-row"><div><div class="label">Synchroniser en arrière-plan</div>
        <div class="desc">Toutes les 15 minutes environ, sur Wi-Fi, même appli fermée.</div></div>
        <button class="switch${S.lib.background_sync !== false ? " on" : ""}" data-action="toggle-background-sync" aria-label="Synchroniser en arrière-plan"></button></div>
      ${(S.lib.pending_downloads || []).length ? `<p class="hint">${plural(S.lib.pending_downloads.length, "téléchargement")} en attente du PC : envoyé${S.lib.pending_downloads.length > 1 ? "s" : ""} à la prochaine synchro.</p>` : ""}
      <button class="link-btn" data-action="unpair">Dissocier ce PC</button>`;
  } else {
    html += `<h3>Associer ton PC</h3>
      <ol class="steps"><li>Sur le PC, ouvre Audora, puis la page « Téléphone ».</li>
        <li>Active la synchronisation et touche « Afficher un code d'association ».</li>
        <li>Ici, choisis ton PC puis saisis le code.</li></ol>
      <button class="btn block" data-action="discover" ${S.discovering ? "disabled" : ""}>${S.discovering ? "Recherche…" : "Rechercher mon PC"}</button>
      <div id="found" style="margin-top:12px">${foundHTML()}</div>
      <input class="field code-field" id="code" inputmode="numeric" maxlength="7" placeholder="000000" autocomplete="off">
      <button class="btn primary block" data-action="pair">Associer</button>
      <button class="link-btn" data-action="manual-host">Mon PC n'apparaît pas : saisir son adresse</button>
      <input class="field" id="manual-host" placeholder="Adresse du PC, ex. 192.168.1.20" hidden>`;
  }
  html += `</div></section>`;

  const st = S.storage;
  const fade = S.lib.crossfade || 0;
  html += `<section class="settings-section"><h2>Lecture</h2><div class="panel">
    <div class="setting-row"><div><div class="label">Fondu enchaîné</div><div class="desc">Le titre suivant démarre en fondu pendant que l'actuel se termine.</div></div></div>
    <div class="segmented fade-choice">${[[0, "Non"], [3, "3 s"], [5, "5 s"], [8, "8 s"]].map(([v, l]) =>
      `<button class="${fade === v ? "active" : ""}" data-action="set-crossfade" data-value="${v}">${l}</button>`).join("")}</div>
    <div class="setting-row"><div><div class="label">Lecture sans interruption</div>
      <div class="desc">${S.batteryRestricted ? "Android peut couper la musique écran éteint pour économiser la batterie." : "Audora est autorisé à jouer écran éteint."}</div></div>
      ${S.batteryRestricted ? `<button class="btn" data-action="battery-exempt">Autoriser</button>` : `<span class="tag">${icon("check")}</span>`}</div>
  </div></section>`;
  const apk = updateAvailable();
  if (apk) html += `<section class="settings-section"><h2>Mise à jour</h2><div class="banner"><div><strong>Version ${esc(apk.version_name || "")} disponible</strong>
    <div class="hint">Elle s'installe par-dessus : tes musiques et réglages restent.</div></div><button class="btn primary" data-action="install-update">Installer</button></div></section>`;
  html += `<section class="settings-section"><h2>Stockage</h2>`;
  if (st) {
    html += st.options.map((o) => `<button class="storage-option${o.index === st.current ? " active" : ""}" data-action="move-storage" data-index="${o.index}" ${S.moving ? "disabled" : ""}>
        <span class="radio"></span><span><span class="label" style="font-weight:700">${esc(o.label)}</span><br>
        <span class="hint">${fmtSize(o.free)} libres sur ${fmtSize(o.total)}</span></span></button>`).join("");
    if (st.options.length < 2) html += `<p class="hint">Aucune carte SD détectée : les musiques sont dans la mémoire du téléphone.</p>`;
    html += S.moving
      ? `<div class="bar"><span style="width:${S.moving.total ? Math.round((S.moving.done / S.moving.total) * 100) : 0}%"></span></div><p class="hint">Déplacement des musiques…</p>`
      : `<p class="hint">Audora utilise ${fmtSize(st.used)} pour ${plural(st.count, "titre")}.</p>`;
  } else {
    html += `<p class="hint">Calcul de la place utilisée…</p>`;
  }
  html += `<button class="btn danger block" data-action="remove-all" style="margin-top:10px" ${S.lib.tracks.length ? "" : "disabled"}>${icon("trash")}Supprimer toutes les musiques</button>
    <p class="hint" style="margin-top:8px">Supprime du téléphone toutes les musiques reçues d'Audora. Elles restent sur ton PC.</p></section>`;
  return html;
};

MOUNTS.settings = () => {
  // Calcul de la place utilisee en arriere-plan : la page s'affiche tout de suite
  // (avec les chiffres de la derniere fois), puis se met a jour.
  if (A.requestStorageInfo) { A.requestStorageInfo(); return; }
  try { S.storage = JSON.parse(A.storageInfo()); } catch { S.storage = null; }
  if (S.storage && !$(".storage-option")) refresh();
};

function foundHTML() {
  if (S.found === null) return "";
  if (!S.found.length) return `<p class="hint">Aucun PC trouvé. Vérifie qu'Audora est ouvert, que la synchronisation est activée, et que tu es sur le même Wi-Fi.</p>`;
  return S.found.map((p) => `<button class="pc-choice${S.chosenHost === p.host ? " selected" : ""}" data-action="choose-pc" data-host="${esc(p.host)}">
    ${icon("pc")}<span>${esc(p.name)}<br><span class="hint">${esc(p.host)}</span></span></button>`).join("");
}

// ---------- Navigation ----------

function go(name, param = null, push = false) {
  if (name !== "search") stopPreview();
  if (push) S.stack.push({ ...S.view, scroll: $("#view").scrollTop });
  else S.stack = [];
  if (name === "duplicates") S.dupes = null;  // sélection recalculée à chaque ouverture
  S.view = { name, param };
  render();
  $("#view").scrollTop = 0;
}

function render() {
  S.lists = {};
  $("#view").innerHTML = VIEWS[S.view.name](S.view.param);
  MOUNTS[S.view.name]?.();
  const tab = { artist: "library", playlist: "library", duplicates: "library" }[S.view.name] || S.view.name;
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === tab));
}

/** Re-rend la vue sans perdre le défilement ni la saisie en cours. */
function refresh() {
  const el = $("#view");
  const scroll = el.scrollTop;
  const active = document.activeElement;
  const focusId = active && el.contains(active) && active.id ? active.id : null;
  const values = {};
  $$("input[id]", el).forEach((i) => (values[i.id] = i.value));
  render();
  for (const [id, v] of Object.entries(values)) { const i = document.getElementById(id); if (i && !i.value) i.value = v; }
  el.scrollTop = scroll;
  if (focusId) document.getElementById(focusId)?.focus();
}

window.onBack = () => {
  if ($("#sheet-root").firstChild) { closeSheet(); return true; }
  if (!$("#player").hidden) { $("#player").hidden = true; return true; }
  if (S.stack.length) {
    const prev = S.stack.pop();
    S.view = { name: prev.name, param: prev.param };
    render();
    $("#view").scrollTop = prev.scroll || 0;
    return true;
  }
  if (S.view.name !== "home") { go("home"); return true; }
  return false;
};

// ---------- Lecteur ----------

const current = () => S.byId.get(S.player.track);

function sleepText(p) {
  if (p.sleep_end_of_track) return "Arrêt à la fin du titre";
  if (p.sleep_at > 0) return `Arrêt dans ${Math.max(1, Math.ceil((p.sleep_at - Date.now()) / 60000))} min`;
  return "";
}

function updatePlayer() {
  const p = S.player;
  const t = current();
  if (t?.id !== S.lastChameleonTrack) { S.lastChameleonTrack = t?.id; updateChameleon(t); }
  const sleep = sleepText(p);
  $("#sleep-status").textContent = sleep;
  $("#btn-sleep").classList.toggle("on", !!sleep);
  document.body.classList.toggle("has-mini", !!t);
  $("#mini").hidden = !t;
  const playIcon = icon(p.playing ? "pause" : "play");
  $("#mini-play").innerHTML = playIcon;
  $("#btn-play").innerHTML = playIcon;
  if (t) {
    $("#mini-title").textContent = t.title;
    $("#mini-artist").textContent = t.artist;
    $("#mini-cover").innerHTML = coverHTML(t);
    $("#player-title").textContent = t.title;
    $("#player-artist").textContent = t.artist;
    $("#player-cover").innerHTML = coverHTML(t);
    $("#player-bg").style.backgroundImage = t.cover ? `url("/cover/${t.id}?v=${t.mtime || 0}")` : "none";
  }
  if (p.playing) stopPreview();
  $("#btn-shuffle").classList.toggle("on", !!p.shuffle);
  $("#btn-repeat").classList.toggle("on", p.repeat === "all");
  $("#btn-repeat").classList.toggle("on-one", p.repeat === "one");
  updateTime();
  $$(".row[data-track]").forEach((r) => r.classList.toggle("playing", +r.dataset.track === p.track));
  if (!$("#queue").hidden) renderQueue();
}

let seeking = false;
function updateTime() {
  const p = S.player;
  const dur = (p.duration || 0) / 1000;
  const pos = (p.position || 0) / 1000;
  const frac = dur ? Math.min(1, pos / dur) : 0;
  $("#mini-progress").style.width = `${frac * 100}%`;
  if (seeking) return;
  $("#seek").value = Math.round(frac * 1000);
  $("#seek").style.setProperty("--fill", `${frac * 100}%`);
  $("#t-cur").textContent = fmtTime(pos);
  $("#t-total").textContent = fmtTime(dur || current()?.duration);
}

function renderQueue() {
  const q = S.player.queue || [];
  const i = S.player.index ?? -1;
  const upcoming = q.slice(i + 1).map((id, k) => ({ t: S.byId.get(id), index: i + 1 + k })).filter((x) => x.t);
  $("#queue").innerHTML = `<div class="queue-label">À suivre</div>` + (upcoming.length
    ? upcoming.map(({ t, index }) => `<div class="row" data-action="jump" data-index="${index}">${coverHTML(t)}
        <div style="min-width:0"><div class="row-title">${esc(t.title)}</div><div class="row-sub">${esc(t.artist)}</div></div><span></span></div>`).join("")
    : `<p class="hint">Rien après ce titre.</p>`);
}

// Position : Android ne pousse pas chaque seconde, on la demande pendant la lecture.
setInterval(() => {
  if (!S.player.playing || document.hidden) return;
  try { S.player = JSON.parse(A.state()); } catch { return; }
  updateTime();
}, 500);

// ---------- Menus, confirmations, toasts ----------

function openSheet(html) {
  $("#sheet-root").innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"><div class="sheet">${html}</div></div>`;
}
function closeSheet() { $("#sheet-root").innerHTML = ""; }

function promptSheet(title, value, okLabel, onOk) {
  openSheet(`<div class="sheet-head"><div class="row-title" style="font-size:17px">${esc(title)}</div></div>
    <div style="padding:0 8px"><input class="field" id="prompt-input" maxlength="80" value="${esc(value)}" placeholder="Nom"></div>
    <div class="confirm-actions"><button class="btn" data-action="close-sheet-btn">Annuler</button>
      <button class="btn primary" data-action="prompt-ok">${esc(okLabel)}</button></div>`);
  promptAction = onOk;
  setTimeout(() => $("#prompt-input")?.focus(), 50);
}
let promptAction = null;

function confirmSheet(title, text, okLabel, onOk) {
  openSheet(`<div class="sheet-head"><div class="row-title" style="font-size:17px">${esc(title)}</div></div>
    <p class="confirm-text">${esc(text)}</p>
    <div class="confirm-actions"><button class="btn" data-action="close-sheet-btn">Annuler</button>
      <button class="btn danger" data-action="confirm-ok">${esc(okLabel)}</button></div>`);
  confirmAction = onOk;
}
let confirmAction = null;

function trackMenu(id, playlistId = null, pindex = null) {
  const t = S.byId.get(id);
  if (!t) return;
  openSheet(`<div class="sheet-head">${coverHTML(t)}<div style="min-width:0"><div class="row-title">${esc(t.title)}</div><div class="row-sub">${esc(t.artist)}</div></div></div>
    <button class="item" data-action="play-next" data-track="${id}">${icon("play-next")}Lire ensuite</button>
    <button class="item" data-action="add-queue" data-track="${id}">${icon("list-plus")}Ajouter à la file d'attente</button>
    <button class="item" data-action="pick-playlist" data-track="${id}">${icon("plus")}Ajouter à une playlist…</button>
    ${playlistId != null ? `<button class="item" data-action="playlist-remove-track" data-id="${playlistId}" data-pindex="${pindex}">${icon("close")}Retirer de cette playlist</button>` : ""}
    <button class="item" data-action="goto-artist" data-artist="${esc(t.artist)}">${icon("user")}Aller à l'artiste</button>
    ${t.direct ? `<button class="item danger" data-action="remove" data-track="${id}">${icon("trash")}Retirer du téléphone</button>`
      : `<p class="note">Ce titre vient d'une playlist envoyée depuis le PC : retire la playlist depuis Audora sur le PC.</p>`}`);
}

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 5000 : 2600);
}

// ---------- Synchro ----------

function startSync(silent = false) {
  if (S.syncing || !S.lib.pc) return;
  S.syncing = true;
  S.syncSilent = silent;
  S.syncMsg = "Recherche du PC…";
  S.syncDone = S.syncTotal = 0;
  if (S.view.name === "settings") refresh();
  A.sync();
}

// ---------- Actions ----------

const ACTIONS = {
  tab: (el) => go(el.dataset.view),
  open: (el) => go(el.dataset.view, el.dataset.param, true),
  back: () => window.onBack(),
  "library-tab": (el) => { S.libraryTab = el.dataset.tab; refresh(); },
  "goto-artist": (el) => { closeSheet(); $("#player").hidden = true; go("artist", el.dataset.artist, true); },
  play: (el) => A.play(JSON.stringify(S.lists[el.dataset.list] || []), +el.dataset.index, false),
  "play-all": (el) => A.play(JSON.stringify(S.lists[el.dataset.list] || []), 0, false),
  "shuffle-all": (el) => A.play(JSON.stringify(S.lists[el.dataset.list] || []), 0, true),
  menu: (el) => trackMenu(+el.dataset.track, el.dataset.playlist != null ? +el.dataset.playlist : null, el.dataset.pindex != null ? +el.dataset.pindex : null),
  "close-sheet": (el, e) => { if (e.target === el) closeSheet(); },
  "close-sheet-btn": () => closeSheet(),
  "prompt-ok": () => {
    const value = ($("#prompt-input")?.value || "").trim();
    if (!value) return;
    const fn = promptAction;
    promptAction = null;
    closeSheet();
    fn?.(value);
  },
  "confirm-ok": () => { const fn = confirmAction; confirmAction = null; closeSheet(); fn?.(); },
  "play-next": (el) => { A.command("playNext", +el.dataset.track); closeSheet(); toast("Sera lu juste après"); },
  "add-queue": (el) => { A.command("addQueue", +el.dataset.track); closeSheet(); toast("Ajouté à la file d'attente"); },
  remove: (el) => {
    A.removeTrack(+el.dataset.track);
    closeSheet();
    loadLibrary();
    refresh();
    toast("Retiré du téléphone");
  },
  toggle: () => A.command("toggle", 0),
  next: () => A.command("next", 0),
  prev: () => A.command("prev", 0),
  shuffle: () => A.command("shuffle", 0),
  repeat: () => A.command("repeat", 0),
  jump: (el) => A.command("jump", +el.dataset.index),
  "open-player": () => { $("#player").hidden = false; $("#queue").hidden = true; $("#player-body").hidden = false; },
  "close-player": () => { $("#player").hidden = true; },
  "toggle-queue": () => {
    const q = $("#queue");
    q.hidden = !q.hidden;
    $("#player-body").hidden = !q.hidden;
    if (!q.hidden) renderQueue();
  },
  "yt-preview": (el) => (preview.id === el.dataset.id ? stopPreview() : startPreview(el.dataset.id)),
  "yt-download": async (el) => {
    const r = (S.search.results || []).find((x) => x.id === el.dataset.id);
    if (!r) return;
    S.jobs[r.id] = { status: "queued" };
    renderResults();
    try {
      const data = await pc("POST", "/sync/download", { id: r.id, title: r.raw_title || r.title, thumb: r.thumb });
      S.jobs[r.id] = { ...data.job };
      if (data.job.status === "done") startSync(true); else watchJobs();
      renderResults();
    } catch (e) {
      if (/injoignable|introuvable/i.test(e.message)) {
        A.queueDownload(r.id, r.raw_title || r.title, r.thumb || "");
        S.jobs[r.id] = { status: "waiting" };
        loadLibrary();
        toast("PC injoignable : envoyé dès la prochaine synchro");
      } else {
        S.jobs[r.id] = { status: "error", error: e.message };
      }
      renderResults();
    }
  },
  "install-update": () => { const apk = updateAvailable(); if (apk) { A.openUrl(apk.url); toast("Téléchargement de la mise à jour…"); } },
  "battery-exempt": () => A.requestBatteryExemption(),
  "hide-battery-banner": () => { S.batteryBannerHidden = true; refresh(); },
  "toggle-background-sync": () => {
    S.lib.background_sync = S.lib.background_sync === false;
    A.setSetting("background_sync", String(S.lib.background_sync));
    refresh();
  },
  "set-crossfade": (el) => {
    S.lib.crossfade = +el.dataset.value;
    A.setSetting("crossfade", el.dataset.value);
    refresh();
    toast(S.lib.crossfade ? `Fondu enchaîné de ${S.lib.crossfade} secondes` : "Fondu enchaîné désactivé");
  },
  sleep: () => openSheet(`<div class="sheet-head"><div class="row-title" style="font-size:17px">${icon("moon")} Minuterie de sommeil</div></div>
    ${[[15, "Dans 15 minutes"], [30, "Dans 30 minutes"], [45, "Dans 45 minutes"], [60, "Dans 1 heure"], [-1, "À la fin du titre"]].map(([v, l]) =>
      `<button class="item" data-action="set-sleep" data-value="${v}">${l}</button>`).join("")}
    ${sleepText(S.player) ? `<button class="item danger" data-action="set-sleep" data-value="0">${icon("close")}Annuler la minuterie</button>` : ""}`),
  "set-sleep": (el) => {
    const v = +el.dataset.value;
    A.command("sleep", v);
    closeSheet();
    toast(v === 0 ? "Minuterie annulée" : v === -1 ? "La musique s'arrêtera à la fin du titre" : `La musique s'arrêtera dans ${v} min`);
  },
  "new-playlist": () => promptSheet("Nouvelle playlist", "", "Créer", (name) => {
    const id = A.createPlaylist(name, "[]");
    loadLibrary();
    go("playlist", id, true);
  }),
  "rename-playlist": (el) => {
    const pl = S.lib.playlists.find((p) => p.id === +el.dataset.id);
    if (pl) promptSheet("Renommer la playlist", pl.name, "Renommer", (name) => { A.updatePlaylist(pl.id, name, ""); loadLibrary(); refresh(); });
  },
  "remove-playlist": (el) => confirmSheet("Retirer cette playlist du téléphone ?", "Elle reste sur ton PC. Les titres déjà sur le téléphone restent aussi.", "Retirer", () => {
    A.removePlaylist(+el.dataset.id);
    loadLibrary();
    window.onBack();
  }),
  "pick-playlist": (el) => {
    const id = +el.dataset.track;
    openSheet(`<div class="sheet-head"><div class="row-title" style="font-size:17px">Ajouter à une playlist</div></div>
      ${S.lib.playlists.map((p) => `<button class="item" data-action="add-to-playlist" data-id="${p.id}" data-track="${id}">${esc(p.name)}</button>`).join("")}
      <button class="item" data-action="new-playlist-with" data-track="${id}">${icon("plus")}Nouvelle playlist</button>`);
  },
  "add-to-playlist": (el) => {
    const pl = S.lib.playlists.find((p) => p.id === +el.dataset.id);
    if (!pl) return;
    const ids = [...pl.track_ids, +el.dataset.track];
    A.updatePlaylist(pl.id, "", JSON.stringify(ids));
    closeSheet();
    loadLibrary();
    toast(`Ajouté à « ${pl.name} »`);
  },
  "new-playlist-with": (el) => {
    const track = +el.dataset.track;
    promptSheet("Nouvelle playlist", "", "Créer", (name) => {
      A.createPlaylist(name, JSON.stringify([track]));
      loadLibrary();
      toast(`Ajouté à « ${name} »`);
    });
  },
  "playlist-remove-track": (el) => {
    const pl = S.lib.playlists.find((p) => p.id === +el.dataset.id);
    if (!pl) return;
    const ids = pl.track_ids.filter((_, i) => i !== +el.dataset.pindex);
    A.updatePlaylist(pl.id, "", JSON.stringify(ids));
    closeSheet();
    loadLibrary();
    refresh();
  },
  "dupes-remove": () => {
    const ids = [...S.dupes];
    confirmSheet(`Retirer ${plural(ids.length, "titre")} du téléphone ?`, "Les fichiers sont effacés du téléphone. Ils restent sur ton PC.", "Retirer", () => {
      ids.forEach((id) => A.removeTrack(id));
      S.dupes = null;
      loadLibrary();
      refresh();
      toast(`${plural(ids.length, "titre")} retiré${ids.length > 1 ? "s" : ""}`);
    });
  },
  "set-theme": (el) => {
    A.setSetting("theme_override", el.dataset.theme);
    S.lib.theme_override = el.dataset.theme;
    applyTheme();
    refresh();
  },
  "toggle-auto-sync": () => {
    S.lib.auto_sync = S.lib.auto_sync === false;
    A.setSetting("auto_sync", String(S.lib.auto_sync));
    refresh();
  },
  "move-storage": (el) => {
    const index = +el.dataset.index;
    if (!S.storage || index === S.storage.current || S.moving) return;
    S.moving = { done: 0, total: 0 };
    refresh();
    A.moveStorage(index);
  },
  "remove-all": () => confirmSheet(
    "Supprimer toutes les musiques ?",
    `Les ${plural(S.lib.tracks.length, "titre")} reçus d'Audora seront effacés de ce téléphone. Ils restent sur ton PC, et ne reviendront pas à la prochaine synchro : tu pourras les renvoyer depuis le PC.`,
    "Tout supprimer",
    () => {
      A.removeAll();
      loadLibrary();
      S.storage = null;
      refresh();
      toast("Toutes les musiques ont été supprimées du téléphone");
    }),
  sync: () => startSync(false),
  discover: () => { S.discovering = true; S.found = null; refresh(); A.discover(); },
  "choose-pc": (el) => {
    S.chosenHost = el.dataset.host;
    $("#found").innerHTML = foundHTML();
    $("#code").focus();
  },
  "manual-host": () => { $("#manual-host").hidden = false; $("#manual-host").focus(); },
  pair: () => {
    const code = ($("#code").value || "").replace(/\D/g, "");
    const host = ($("#manual-host").value || "").trim() || S.chosenHost;
    if (!host) { toast("Choisis ton PC dans la liste, ou saisis son adresse.", "error"); return; }
    if (code.length !== 6) { toast("Le code fait 6 chiffres.", "error"); return; }
    toast("Association…");
    A.pair(host, 0, code);
  },
  unpair: () => confirmSheet("Dissocier ce PC ?", "Les musiques déjà sur le téléphone restent, mais il ne se synchronisera plus tant que tu ne l'associes pas à nouveau.",
    "Dissocier", () => { A.unpair(); loadLibrary(); refresh(); toast("PC dissocié"); }),
};

document.addEventListener("change", (e) => {
  const box = e.target.closest("[data-dupe]");
  if (!box || !S.dupes) return;
  if (box.checked) S.dupes.add(+box.dataset.dupe); else S.dupes.delete(+box.dataset.dupe);
  refresh();
});

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});

const seek = $("#seek");
seek.addEventListener("input", () => {
  seeking = true;
  const dur = (S.player.duration || 0) / 1000;
  seek.style.setProperty("--fill", `${seek.value / 10}%`);
  $("#t-cur").textContent = fmtTime((seek.value / 1000) * dur);
});
seek.addEventListener("change", () => {
  A.command("seek", Math.round((seek.value / 1000) * (S.player.duration || 0)));
  seeking = false;
});

// ---------- Événements d'Android ----------

window.onNative = (name, data) => {
  switch (name) {
    case "state":
      S.player = data || {};
      updatePlayer();
      break;
    case "resume":
      S.batteryRestricted = A.batteryRestricted ? A.batteryRestricted() : false;
      loadLibrary();
      refresh();
      if (S.lib.auto_sync !== false) startSync(true);
      break;
    case "pc": {
      const req = pending.get(data.id);
      if (!req) break;
      pending.delete(data.id);
      if (data.ok) req.resolve(data.data); else req.reject(new Error(data.message || "Erreur"));
      break;
    }
    case "sync_progress":
      S.syncMsg = data.message;
      S.syncDone = data.done;
      S.syncTotal = data.total;
      if (S.view.name === "settings") refresh();
      break;
    case "sync_done": {
      S.syncing = false;
      const received = S.syncDone;
      loadLibrary();
      for (const [vid, job] of Object.entries(S.jobs)) {
        if (job.status === "done" && S.lib.tracks.some((t) => t.source_id === vid)) job.arrived = true;
      }
      if (!data.ok) {
        S.syncMsg = data.message || "La synchro a échoué.";
        if (!S.syncSilent) toast(S.syncMsg, "error");
      } else if (!S.syncSilent || received) {
        toast(S.syncMsg || "Synchro terminée");
      }
      S.storage = null;
      refresh();
      break;
    }
    case "storage":
      S.storage = data;
      if (S.view.name === "settings") {  // sans relancer MOUNTS (qui redemanderait le calcul)
        const y = $("#view").scrollTop;
        $("#view").innerHTML = VIEWS.settings();
        $("#view").scrollTop = y;
      }
      break;
    case "storage_progress":
      S.moving = data;
      if (S.view.name === "settings") refresh();
      break;
    case "storage_done":
      S.moving = null;
      S.storage = null;
      if (data.ok) toast("Musiques déplacées"); else toast(data.message || "Déplacement impossible", "error");
      refresh();
      break;
    case "discovered":
      S.discovering = false;
      S.found = data || [];
      if (S.found.length === 1) S.chosenHost = S.found[0].host;
      if (S.view.name === "settings") refresh();
      break;
    case "paired":
      if (data.ok) {
        toast(`Associé à ${data.name}`);
        loadLibrary();
        refresh();
        startSync(false);
      } else {
        toast(data.message || "Association impossible.", "error");
      }
      break;
  }
};

// ---------- Démarrage ----------

hydrate();
loadLibrary();
S.batteryRestricted = A.batteryRestricted ? A.batteryRestricted() : false;
go("home");
try { S.player = JSON.parse(A.state()); } catch { S.player = {}; }
updatePlayer();
