"use strict";

/* =========================================================================
   Audora — interface (bibliothèque, lecteur, recherche, téléchargements)
   Le moteur Python est joignable via window.pywebview.api.<fonction>.
   ========================================================================= */

// ---------- Utilitaires ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Vrai si tous les mots de la recherche apparaissent (dans n'importe quel ordre). */
function matchesWords(t, query) {
  const haystack = norm(`${t.title} ${t.artist} ${t.album}`);
  return norm(query).split(/\s+/).filter(Boolean).every((w) => haystack.includes(w));
}
const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
const isYouTubeUrl = (s) => /^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be)\/\S+$/.test((s || "").trim());
const ACTIVE_STATUSES = ["queued", "downloading", "processing"];

function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return "";
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function fmtTotal(sec) {
  const min = Math.round((sec || 0) / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

function parseTime(text) {
  text = String(text || "").trim();
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function errMsg(e) {
  const msg = (e && (e.message || e.toString())) || "Erreur inconnue";
  return String(msg).replace(/^(\w+Error|Exception):\s*/, "");
}

const apiReady = new Promise((resolve) => {
  if (window.pywebview && window.pywebview.api) resolve();
  else window.addEventListener("pywebviewready", resolve, { once: true });
});
async function api(name, ...args) {
  await apiReady;
  return window.pywebview.api[name](...args);
}

// ---------- Icônes ----------

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  note: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  next: '<path d="M5 5.5v13a1 1 0 0 0 1.5.86L16 13.5V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.5L6.5 4.64A1 1 0 0 0 5 5.5z"/>',
  prev: '<path d="M19 5.5v13a1 1 0 0 1-1.5.86L8 13.5V18a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v4.5l9.5-5.86A1 1 0 0 1 19 5.5z"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  "volume-low": '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  queue: '<path d="M3 6h13M3 12h13M3 18h8"/><path d="m16 15 5 3-5 3z"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  lyrics: '<path d="M4 6h10M4 10h10M4 14h6"/><circle cx="17" cy="17" r="3"/><path d="M20 17V5l-3 1"/>',
  more: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  "list-plus": '<path d="M3 6h12M3 12h12M3 18h8M18 15v6M15 18h6"/>',
  "play-next": '<path d="M3 6h12M3 12h8M3 18h8"/><path d="m15 13 6 4-6 4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  "win-min": '<path d="M5 12h14"/>',
  "win-max": '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  "win-restore": '<rect x="5" y="8" width="11" height="11" rx="1.5"/><path d="M8.5 8V6.5A1.5 1.5 0 0 1 10 5h7.5A1.5 1.5 0 0 1 19 6.5V14a1.5 1.5 0 0 1-1.5 1.5H16"/>',
};
const FILLED_ICONS = new Set(["play", "pause", "next", "prev", "more"]);
const icon = (name) =>
  `<svg class="ico${FILLED_ICONS.has(name) ? " filled" : ""}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
function hydrateIcons(root = document) {
  $$("i[data-icon]", root).forEach((el) => (el.outerHTML = icon(el.dataset.icon)));
}

// ---------- Thèmes ----------

// Chaque thème redéfinit les couleurs par rôle (fond, panneaux, texte, accent).
const THEMES = window.AudoraThemes;  // voir web/shared/themes.js
const THEME_VARS = ["--bg", "--panel", "--raise", "--line", "--text", "--text-2", "--text-3", "--accent", "--accent-hover", "--accent-ink"];

function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  const root = document.documentElement.style;
  theme.c.forEach((value, i) => {
    // Caméléon : l'accent suit la pochette en cours, éclairci pour rester lisible.
    if (value === "chameleon") value = "color-mix(in srgb, rgb(var(--ambient)) 70%, white)";
    if (THEME_VARS[i] === "--accent-hover" && !value) value = "color-mix(in srgb, rgb(var(--ambient)) 55%, white)";
    root.setProperty(THEME_VARS[i], value);
  });
  root.setProperty("color-scheme", theme.dark ? "dark" : "light");
  root.setProperty("--np-filter", theme.dark
    ? "blur(60px) saturate(1.3) brightness(.45)"
    : "blur(60px) saturate(1.2) brightness(1.15) opacity(.55)");
  try { localStorage.setItem("theme", theme.id); } catch { /* stockage indisponible */ }
  return theme.id;
}

// Appliqué tout de suite (avant de joindre Python) pour éviter un flash de l'ancien thème.
try { applyTheme(localStorage.getItem("theme") || "prune"); } catch { applyTheme("prune"); }

// ---------- État ----------

const S = {
  tracks: [], byId: new Map(), playlists: [], downloads: [], config: {}, bridge: false,
  view: { name: "home", param: null },
  lists: {},
  queue: [], qi: -1, unshuffled: null, shuffle: false, repeat: "off",
  search: { query: "", mode: "text", results: null, loading: false, error: null },
  links: {}, forms: {},
  songsUI: { filter: "", sort: "recent" },
  menuCtx: null, sessionRestored: false,
};
const media = $("#media");

const audioTracks = () => S.tracks.filter((t) => t.kind !== "video");
const videoTracks = () => S.tracks.filter((t) => t.kind === "video");
const currentId = () => (S.qi >= 0 ? S.queue[S.qi] : null);
const currentTrack = () => S.byId.get(currentId());

function registerList(key, tracks) {
  S.lists[key] = tracks.map((t) => t.id);
  return key;
}

function groupBy(tracks, keyFn) {
  const map = new Map();
  for (const t of tracks) {
    const key = keyFn(t);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  return map;
}

const byName = (a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" });

function getArtists() {
  return [...groupBy(audioTracks(), (t) => t.artist)]
    .map(([name, tracks]) => ({ name, tracks, cover: tracks.find((t) => t.cover) || tracks[0] }))
    .sort(byName);
}

function getAlbums() {
  return [...groupBy(audioTracks(), (t) => t.album)]
    .map(([name, tracks]) => {
      const artists = new Set(tracks.map((t) => t.artist));
      return {
        name, tracks,
        artist: artists.size === 1 ? tracks[0].artist : "Artistes variés",
        cover: tracks.find((t) => t.cover) || tracks[0],
      };
    })
    .sort(byName);
}

// ---------- Pochettes et lignes ----------

const PALETTE = [[255, 181, 71], [146, 112, 214], [94, 170, 160], [230, 110, 130], [110, 150, 230], [200, 140, 90]];
function hashStr(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
const coverUrl = (t) => `/cover/${t.id}?v=${Math.floor(t.added_at || 0)}`;

function coverHTML(t, cls = "", extra = "") {
  if (t && t.cover) {
    return `<div class="cover ${cls}"><img src="${coverUrl(t)}" alt="" loading="lazy" draggable="false">${extra}</div>`;
  }
  const letter = esc((t?.title || "?").trim().charAt(0).toUpperCase() || "?");
  const [r, g, b] = PALETTE[hashStr(t?.artist || t?.title || "") % PALETTE.length];
  return `<div class="cover ${cls}"><div class="cover-fallback" style="background:linear-gradient(135deg, rgb(${r} ${g} ${b} / .9), rgb(${r} ${g} ${b} / .3))">${letter}</div>${extra}</div>`;
}

const EQ = '<div class="eq"><span></span><span></span><span></span></div>';

function rowHTML(t, listKey, index, { compact = false, playlistIndex = null } = {}) {
  const playing = currentId() === t.id ? " playing" : "";
  const pl = playlistIndex != null ? ` data-playlist-index="${playlistIndex}"` : "";
  return `
    <div class="row${compact ? " compact" : ""}${playing}" role="button" tabindex="0"
         data-action="play-list" data-list="${listKey}" data-index="${index}" data-track="${t.id}"${pl}>
      ${coverHTML(t, "", EQ)}
      <div class="row-main">
        <div class="row-title">${esc(t.title)}${onPhone(t.id) ? `<span class="on-phone" title="Sur le téléphone">${icon("phone")}</span>` : ""}</div>
        <div class="row-artist"><span class="link" data-action="goto-artist" data-artist="${esc(t.artist)}">${esc(t.artist)}</span></div>
      </div>
      ${compact ? "" : `<div class="row-album">${t.album ? `<span class="link" data-action="goto-album" data-album="${esc(t.album)}">${esc(t.album)}</span>` : ""}</div>`}
      <div class="row-time">${fmtTime(t.duration)}</div>
      <button class="icon-btn small" data-action="track-menu" data-track="${t.id}"${pl} aria-label="Plus d'options">${icon("more")}</button>
    </div>`;
}

function cardHTML(t, listKey, index, { video = false } = {}) {
  return `
    <button class="card${video ? " video" : ""}" data-action="play-list" data-list="${listKey}" data-index="${index}" data-track="${t.id}">
      ${coverHTML(t, "", `<span class="play-overlay">${icon("play")}</span>`)}
      <div class="card-title">${esc(t.title)}</div>
      <div class="card-sub">${esc(t.artist)}</div>
    </button>`;
}

function artistCardHTML(a) {
  return `
    <button class="card artist" data-action="goto-artist" data-artist="${esc(a.name)}">
      ${coverHTML(a.cover, "round")}
      <div class="card-title">${esc(a.name)}</div>
      <div class="card-sub">${plural(a.tracks.length, "titre")}</div>
    </button>`;
}

function albumCardHTML(al) {
  return `
    <button class="card" data-action="goto-album" data-album="${esc(al.name)}">
      ${coverHTML(al.cover)}
      <div class="card-title">${esc(al.name)}</div>
      <div class="card-sub">${esc(al.artist)}</div>
    </button>`;
}

function collectionActions(listKey) {
  return `
    <div class="actions">
      <button class="btn primary" data-action="play-all" data-list="${listKey}">${icon("play")}Lecture</button>
      <button class="btn" data-action="shuffle-all" data-list="${listKey}">${icon("shuffle")}Aléatoire</button>
      ${phoneButtonHTML("track", S.lists[listKey] || [])}
    </div>`;
}

// Vues : une fonction de rendu par page, et une fonction de montage optionnelle.
const VIEWS = {};
const MOUNTS = {};
