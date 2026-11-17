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
const THEMES = [
  { id: "prune", name: "Prune", dark: true, c: ["#17121f", "#1f1929", "#2a2236", "#3a3048", "#f4effa", "#b3a8c6", "#7d7290", "#ffb547", "#ffc369", "#2b1a00"] },
  { id: "cameleon", name: "Caméléon", dark: true, c: ["#141416", "#1c1c20", "#26262b", "#36363d", "#f1f1f4", "#a9a9b3", "#71717b", "chameleon", "", "#111111"] },
  { id: "minuit", name: "Minuit", dark: true, c: ["#0f1420", "#161d2c", "#1f2839", "#2c3850", "#eef3fb", "#9fb0c8", "#67788f", "#5ad1e6", "#7fdcec", "#04232a"] },
  { id: "ocean", name: "Océan", dark: true, c: ["#0d1a1d", "#132428", "#1b3136", "#284449", "#e8f6f6", "#9dbcbd", "#648385", "#3ee0c5", "#6ae8d3", "#03241f"] },
  { id: "foret", name: "Forêt", dark: true, c: ["#111a15", "#17231c", "#203027", "#2d4136", "#edf5ef", "#a3b8aa", "#6c8274", "#8fd694", "#a8e0ab", "#0d2a10"] },
  { id: "braise", name: "Braise", dark: true, c: ["#1a1412", "#231b18", "#2e2420", "#42342e", "#f8efe9", "#c2ada2", "#86736a", "#ff8a4c", "#ffa173", "#2e1205"] },
  { id: "rubis", name: "Rubis", dark: true, c: ["#141010", "#1d1717", "#282020", "#3a2e2e", "#f7eeee", "#bfa9a9", "#826d6d", "#ff5a52", "#ff7b74", "#2d0402"] },
  { id: "sakura", name: "Sakura", dark: true, c: ["#1c1317", "#261a20", "#33232b", "#48323d", "#fbeef3", "#c9a9b6", "#8c6f7b", "#ff8fb8", "#ffa9c8", "#330a1b"] },
  { id: "neon", name: "Néon", dark: true, c: ["#120b1f", "#1a1030", "#251843", "#3a2766", "#f3eaff", "#b4a3d6", "#7a6a9c", "#ff4fd8", "#ff7be2", "#2b0026"] },
  { id: "graphite", name: "Graphite", dark: true, c: ["#151515", "#1d1d1d", "#272727", "#363636", "#f2f2f2", "#a8a8a8", "#6e6e6e", "#e8e8e8", "#ffffff", "#111111"] },
  { id: "oled", name: "Noir total", dark: true, c: ["#000000", "#0a0a0a", "#161616", "#262626", "#ffffff", "#a3a3a3", "#666666", "#ffb547", "#ffc369", "#2b1a00"] },
  { id: "cafe", name: "Café crème", dark: false, c: ["#f6f1ea", "#fffdf9", "#ece4d8", "#ddd2c3", "#2a211b", "#6d5f53", "#9c8e81", "#b0642a", "#c2753a", "#fff8f0"] },
  { id: "lavande", name: "Lavande", dark: false, c: ["#f4f1fa", "#ffffff", "#e8e2f3", "#d6cde8", "#231c33", "#625878", "#958ba8", "#7b4fe0", "#8d66e8", "#ffffff"] },
  { id: "menthe", name: "Menthe", dark: false, c: ["#eef6f2", "#ffffff", "#dfece6", "#c8ddd3", "#14261e", "#4f665b", "#84998f", "#1f9e6e", "#26b27d", "#ffffff"] },
  { id: "papier", name: "Papier", dark: false, c: ["#f7f7f8", "#ffffff", "#ececee", "#dcdce0", "#18181b", "#5f5f68", "#93939c", "#e2513f", "#ea6a59", "#ffffff"] },
];
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

// ---------- Doublons ----------

const fmtSize = (bytes) => bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo` : `${Math.round((bytes || 0) / 1024)} Ko`;

VIEWS.duplicates = () => `
  <button class="more back-link" data-action="nav" data-view="songs">${icon("chevron-left")}Titres</button>
  <div class="page-head"><div><h1 class="page-title">Doublons</h1>
    <div class="page-sub">Les chansons présentes en plusieurs exemplaires. Coche ceux à supprimer : le fichier .mp3 est supprimé du dossier et le titre disparaît partout (playlists, téléphone).</div></div></div>
  <div id="dupes"><p class="muted">Recherche des doublons…</p></div>`;

MOUNTS.duplicates = async () => {
  const groups = await api("find_duplicates");
  // Par défaut, tout est coché sauf l'exemplaire conseillé de chaque groupe.
  S.dupes = { groups, selected: new Set(groups.flatMap((g) => g.tracks.filter((t) => t.id !== g.keep).map((t) => t.id))) };
  renderDupes();
};

function renderDupes() {
  const box = $("#dupes");
  if (!box || !S.dupes) return;
  const { groups, selected } = S.dupes;
  if (!groups.length) {
    box.innerHTML = emptyHTML("Aucun doublon", "Chaque chanson n'est présente qu'une seule fois dans ta bibliothèque.");
    return;
  }
  const key = registerList("dupes", groups.flatMap((g) => g.tracks.map((t) => S.byId.get(t.id)).filter(Boolean)));
  const everyKept = groups.every((g) => g.tracks.some((t) => !selected.has(t.id)));
  box.innerHTML = `
    <div class="dupes-bar">
      <span class="muted">${plural(groups.length, "chanson")} en double, ${plural(selected.size, "fichier")} coché${selected.size > 1 ? "s" : ""}</span>
      <button class="btn danger" data-action="dupes-delete" ${selected.size ? "" : "disabled"}>${icon("trash")}Supprimer ${plural(selected.size, "fichier")}</button>
    </div>
    ${everyKept ? "" : `<p class="dl-detail error">Attention : pour au moins une chanson, tous les exemplaires sont cochés. Elle disparaîtra complètement.</p>`}
    ${groups.map((g) => `
      <section class="panel dupe-group">
        <div class="dupe-head"><strong>${esc(g.tracks[0].title)}</strong> <span class="muted">${esc(g.tracks[0].artist)}, ${g.tracks.length} exemplaires</span></div>
        ${g.tracks.map((t) => {
          const index = (S.lists[key] || []).indexOf(t.id);
          return `<div class="dupe-row${selected.has(t.id) ? " doomed" : ""}">
            <label class="check"><input type="checkbox" data-dupe-id="${t.id}"${selected.has(t.id) ? " checked" : ""} aria-label="Supprimer cet exemplaire"></label>
            <button class="icon-btn small" data-action="play-list" data-list="${key}" data-index="${index}" aria-label="Écouter">${icon("play")}</button>
            ${coverHTML(t)}
            <div class="dupe-main">
              <div class="row-title">${esc(t.title)}${t.id === g.keep ? ` <span class="tag">conseillé à garder</span>` : ""}</div>
              <div class="row-artist" title="${esc(t.folder)}\\${esc(t.file)}">${esc(t.folder)} / ${esc(t.file)}</div>
            </div>
            <div class="dupe-meta">${fmtTime(t.duration)}<br><span class="hint">${fmtSize(t.size)}${t.play_count ? `, ${plural(t.play_count, "écoute")}` : ""}</span></div>
          </div>`;
        }).join("")}
      </section>`).join("")}`;
}

// ---------- Moteur YouTube (yt-dlp) ----------

function engineSettingHTML() {
  const e = S.engine || {};
  const pending = e.pending?.["yt-dlp"] || Object.values(e.pending || {})[0];
  const checked = e.checked ? `vérifié ${fmtDate(e.checked)}` : "pas encore vérifié";
  return `<div class="setting-text"><div class="setting-name">Moteur YouTube</div>
      <div class="setting-value">yt-dlp ${esc(e.version || "?")}${e.updated ? " (mis à jour automatiquement)" : ""}, ${checked}.
        ${pending ? `<br><strong>Nouvelle version ${esc(pending)} prête :</strong> redémarre Audora pour l'utiliser.` : " Il se met à jour tout seul."}</div></div>
    ${pending ? `<button class="btn small primary" data-action="restart-app">Redémarrer Audora</button>`
      : `<button class="btn small" data-action="engine-check">Vérifier</button>`}`;
}

function onEngineEvent(status) {
  S.engine = status;
  const box = $("#engine-setting");
  if (box) box.innerHTML = engineSettingHTML();
  if (Object.keys(status.pending || {}).length) toast("Nouvelle version du moteur YouTube prête : redémarre Audora (Réglages)");
}

// ---------- Seulement la musique (blancs et passages parlés) ----------

/** 64 -> "1 min 4 s" */
function fmtSpan(seconds) {
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}` : `${s} s`;
}

VIEWS.trim = () => `
  <button class="more back-link" data-action="nav" data-view="settings">${icon("chevron-left")}Réglages</button>
  <div class="page-head"><div><h1 class="page-title">Seulement la musique</h1>
    <div class="page-sub">Repère dans tes MP3 les passages parlés des clips (intro, sketch, générique) et les blancs, pour ne garder que la musique.
      Tu choisis ce qui est coupé ; les fichiers d'origine partent dans la Corbeille de Windows.</div></div></div>
  <div id="trim"></div>`;

MOUNTS.trim = async () => {
  if (!S.trim) S.trim = { state: await api("trim_state"), sel: null };
  renderTrim();
};

function onTrimEvent(state) {
  if (!S.trim) S.trim = { state, sel: null };
  S.trim.state = state;
  if (state.phase === "done") {
    toast(state.applied ? `${plural(state.applied, "titre")} nettoyé${state.applied > 1 ? "s" : ""}` : "Aucun titre modifié",
      state.errors.length ? "error" : undefined);
  }
  if (S.view.name === "trim") renderTrim();
}

function trimSelection() {
  const { state } = S.trim;
  if (!S.trim.sel) {  // par défaut, tout est coché
    S.trim.sel = new Map(state.results.map((r) => [r.id, new Set(r.cuts.map((_, i) => i))]));
  }
  return S.trim.sel;
}

function renderTrim() {
  const box = $("#trim");
  if (!box || !S.trim) return;
  const st = S.trim.state;
  const progress = (label) => `<section class="panel trim-progress"><div class="setting-name">${label}</div>
    <div class="setting-value">${st.done} sur ${st.total}</div>
    <div class="bar"><span style="width:${st.total ? Math.round(st.done / st.total * 100) : 0}%"></span></div></section>`;
  const errors = st.errors?.length
    ? `<details class="trim-errors"><summary class="dl-detail error">${plural(st.errors.length, "titre")} n'${st.errors.length > 1 ? "ont" : "a"} pas pu être traité${st.errors.length > 1 ? "s" : ""}</summary>
        ${st.errors.map((e) => `<div class="hint">${esc(e.title)} : ${esc(e.error)}</div>`).join("")}</details>` : "";

  if (st.phase === "scanning") { box.innerHTML = progress("Analyse de ta bibliothèque…"); return; }
  if (st.phase === "applying") { box.innerHTML = progress("Découpage en cours…"); return; }
  if (st.phase !== "ready" || !st.results.length) {
    const doneMsg = st.phase === "ready" ? emptyHTML("Rien à couper", "Tes MP3 n'ont ni passage parlé connu ni blanc à retirer.")
      : st.phase === "done" ? `<p class="muted">${plural(st.applied || 0, "titre")} nettoyé${st.applied > 1 ? "s" : ""}.</p>` : "";
    box.innerHTML = `${doneMsg}${errors}
      <div class="actions"><button class="btn primary" data-action="trim-scan">${icon("search")}Analyser ma bibliothèque</button></div>
      <p class="hint">Les passages parlés viennent de SponsorBlock, une base tenue par les utilisateurs de YouTube : ils ne sont connus que pour les titres téléchargés depuis Audora.
        Les blancs, eux, sont repérés sur tous les MP3. Les titres déjà analysés ne sont pas refaits.</p>`;
    return;
  }

  const sel = trimSelection();
  let removed = 0, count = 0;
  for (const r of st.results) {
    const chosen = sel.get(r.id);
    if (chosen?.size) count++;
    r.cuts.forEach((c, i) => { if (chosen?.has(i)) removed += c.end - c.start; });
  }
  box.innerHTML = `
    <div class="dupes-bar">
      <span class="muted">${plural(st.results.length, "titre")} à nettoyer, ${fmtSpan(removed)} cochés au total</span>
      <button class="btn primary" data-action="trim-apply" ${count ? "" : "disabled"}>${icon("check")}Couper dans ${plural(count, "titre")}</button>
    </div>${errors}
    ${st.results.map((r) => {
      const t = S.byId.get(r.id) || r;
      const chosen = sel.get(r.id) || new Set();
      const left = r.duration - r.cuts.reduce((sum, c, i) => sum + (chosen.has(i) ? c.end - c.start : 0), 0);
      return `<section class="panel trim-group">
        <div class="trim-head">${coverHTML(t)}<div style="min-width:0"><div class="row-title">${esc(r.title)}</div>
          <div class="row-artist">${esc(r.artist)}, ${fmtTime(r.duration)} → <strong>${fmtTime(left)}</strong></div></div></div>
        ${r.cuts.map((c, i) => `<div class="trim-row${chosen.has(i) ? "" : " kept"}">
          <label class="check"><input type="checkbox" data-trim-id="${r.id}" data-trim-cut="${i}"${chosen.has(i) ? " checked" : ""} aria-label="Couper ce passage"></label>
          <span class="tag${c.kind.startsWith("silence") ? " soft" : ""}">${esc(c.label)}</span>
          <span class="trim-time">${fmtTime(c.start)} → ${fmtTime(c.end)} <span class="hint">(${fmtSpan(c.end - c.start)})</span></span>
          <button class="btn small" data-action="trim-listen" data-id="${r.id}" data-at="${c.start}">${icon("play")}Écouter</button>
        </div>`).join("")}
      </section>`;
    }).join("")}`;
}

// ---------- Téléphone ----------

const onPhone = (id) => !!S.phone?.enabled && (S.phone.items?.all || []).includes(id);

/** Bouton "Envoyer sur le téléphone" / "Sur le téléphone" pour un groupe de titres ou une playlist. */
function phoneButtonHTML(kind, ids) {
  if (!S.phone?.enabled || !ids.length) return "";
  const items = S.phone.items || {};
  const sent = kind === "playlist"
    ? (items.playlists || []).includes(ids[0])
    : ids.every((id) => (items.tracks || []).includes(id));
  return `<button class="btn${sent ? " on" : ""}" data-action="phone-toggle" data-kind="${kind}" data-ids="${ids.join(",")}"
    title="${sent ? "Retirer du téléphone" : "Envoyer sur le téléphone"}">${icon(sent ? "check" : "phone")}${sent ? "Sur le téléphone" : "Envoyer sur le téléphone"}</button>`;
}

async function phoneToggle(kind, ids, forceSend = null) {
  const items = S.phone.items || {};
  const sent = kind === "playlist"
    ? (items.playlists || []).includes(ids[0])
    : ids.every((id) => (items.tracks || []).includes(id));
  const send = forceSend ?? !sent;
  S.phone.items = await api(send ? "phone_send" : "phone_unsend", kind, ids);
  toast(send ? "Sera envoyé au téléphone à la prochaine synchro" : "Sera retiré du téléphone à la prochaine synchro");
  refreshView();
}

async function refreshPhone() {
  S.phone = await api("phone_state");
  refreshView();  // met a jour les icones "sur le telephone" et la page Telephone
}

const fmtDate = (ts) => ts ? new Date(ts * 1000).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "jamais";

VIEWS.phone = () => {
  const ph = S.phone || {};
  const head = `<div class="page-head"><div><h1 class="page-title">Téléphone</h1>
    <div class="page-sub">Emporte ta musique sur ton téléphone Android et écoute-la même sans internet.</div></div></div>`;
  if (!ph.enabled) {
    return head + `
      <div class="panel phone-intro">
        <p>Active la synchronisation pour installer l'appli Audora sur ton téléphone et y envoyer les musiques de ton choix, par le Wi-Fi de la maison.</p>
        <p class="hint">Windows va sans doute demander d'autoriser Audora sur les réseaux privés : accepte, sinon le téléphone ne pourra pas joindre ton PC.</p>
        <button class="btn primary" data-action="phone-enable" data-value="1">${icon("phone")}Activer la synchronisation</button>
      </div>`;
  }
  const items = ph.items || {};
  const tracks = (items.all || []).map((id) => S.byId.get(id)).filter(Boolean);
  const key = registerList("phone", tracks);
  const playlists = (items.playlists || []).map((id) => S.playlists.find((p) => p.id === id)).filter(Boolean);
  const pairing = ph.pairing;
  return head + `
    ${ph.error ? `<p class="dl-detail error">${esc(ph.error)}</p>` : ""}
    <div class="phone-steps">
      <section class="panel phone-step">
        <h2 class="section-title">Installer l'appli</h2>
        ${ph.apk_available ? `
          <div class="install">
            <div class="qr" id="phone-qr" aria-label="QR code d'installation"></div>
            <div>
              <p>Scanne ce QR code avec l'appareil photo de ton téléphone, ou ouvre cette adresse dans son navigateur :</p>
              <p class="url">${esc(ph.install_url)}</p>
              <p class="hint">Le téléphone doit être sur le même Wi-Fi que ce PC. Android te demandera d'autoriser l'installation depuis ton navigateur.</p>
            </div>
          </div>` : `<p class="muted">L'appli Android n'est pas encore construite sur ce PC.</p>`}
      </section>
      <section class="panel phone-step">
        <h2 class="section-title">Associer le téléphone</h2>
        ${pairing ? `
          <p>Dans l'appli Audora du téléphone, touche « Associer » puis saisis ce code :</p>
          <div class="pair-code">${esc(pairing.code.slice(0, 3))} ${esc(pairing.code.slice(3))}</div>
          <p class="hint" id="pair-timer">Valable encore ${Math.ceil(pairing.expires_in / 60)} min.</p>
          <button class="btn small" data-action="phone-cancel-pairing">Annuler</button>` : `
          <p class="muted">${(ph.devices || []).length ? "Tu peux associer un autre téléphone." : "Aucun téléphone associé pour l'instant."}</p>
          <button class="btn primary" data-action="phone-pair">Afficher un code d'association</button>`}
        ${(ph.devices || []).length ? `<div class="devices">${ph.devices.map((d) => `
          <div class="device"><div>${icon("phone")}</div>
            <div class="device-text"><div class="setting-name">${esc(d.name)}</div>
              <div class="setting-value">Dernière synchro : ${fmtDate(d.last_sync)}</div></div>
            <button class="btn small" data-action="phone-remove-device" data-id="${esc(d.id)}">Dissocier</button>
          </div>`).join("")}</div>` : ""}
      </section>
    </div>
    <section class="section">
      <h2 class="section-title">Sur le téléphone <span class="muted" style="font:500 14px var(--font-body)">${plural(tracks.length, "titre")}</span>
        ${tracks.length ? `<button class="btn small danger section-action" data-action="phone-unsend-all">${icon("trash")}Retirer toutes les musiques du téléphone</button>` : ""}</h2>
      <p class="hint">Fais un clic droit sur un titre puis « Envoyer sur le téléphone », ou utilise le bouton sur une page d'artiste, d'album ou de playlist. Le téléphone récupère tout à sa prochaine synchro.</p>
      <div class="panel setting" style="margin-top:12px">
        <div class="setting-text"><div class="setting-name">Toutes mes playlists, automatiquement</div>
          <div class="setting-value">Chaque playlist (et les prochaines que tu crées) part sur le téléphone avec ses musiques. Celles que tu retires à la main restent retirées.</div></div>
        <label class="check"><input type="checkbox" data-phone-all-playlists${ph.all_playlists ? " checked" : ""}>Activé</label>
      </div>
      ${playlists.length ? `<div class="actions" style="margin:12px 0">${playlists.map((p) => `
        <button class="btn small on" data-action="phone-toggle" data-kind="playlist" data-ids="${p.id}" title="Retirer la playlist du téléphone">${icon("check")}${esc(p.name)}</button>`).join("")}</div>` : ""}
      ${tracks.length ? `<div class="tracklist">${tracks.map((t, i) => rowHTML(t, key, i)).join("")}</div>` : ""}
    </section>
    <p style="margin-top:28px"><button class="btn small danger" data-action="phone-enable" data-value="0">Désactiver la synchronisation</button></p>`;
};

let pairTimer = null;
MOUNTS.phone = async (el) => {
  clearInterval(pairTimer);
  const qr = $("#phone-qr", el);
  if (qr) qr.innerHTML = await api("phone_install_qr");  // SVG genere localement par Audora
  if (S.phone?.pairing) {
    pairTimer = setInterval(async () => {
      if (S.view.name !== "phone") { clearInterval(pairTimer); return; }
      const state = await api("phone_state");
      const ended = !state.pairing || (state.devices || []).length !== (S.phone.devices || []).length;
      S.phone = state;
      if (ended) { clearInterval(pairTimer); refreshView(); if ((state.devices || []).length) toast("Téléphone associé"); return; }
      const t = $("#pair-timer");
      if (t) t.textContent = `Valable encore ${Math.ceil(state.pairing.expires_in / 60)} min.`;
    }, 2000);
  }
};

function emptyHTML(title, text, button = "") {
  return `<div class="empty"><h2>${title}</h2><p>${text}</p>${button}</div>`;
}

const searchButton = `<button class="btn primary" data-action="focus-search">${icon("search")}Rechercher une musique</button>`;

// ---------- Vues ----------


// Rangées par genre sur l'accueil (le genre de chaque artiste est trouvé en arrière-plan).
const GENRE_OTHER = "Autres";

function genreShelvesHTML(audio) {
  const byGenre = new Map();
  for (const t of audio) {
    const g = t.genre || GENRE_OTHER;
    if (!byGenre.has(g)) byGenre.set(g, []);
    byGenre.get(g).push(t);
  }
  // Un genre de moins de 3 titres ferait une rangée presque vide : il rejoint "Autres".
  for (const [g, tracks] of [...byGenre]) {
    if (g !== GENRE_OTHER && tracks.length < 3) {
      if (!byGenre.has(GENRE_OTHER)) byGenre.set(GENRE_OTHER, []);
      byGenre.get(GENRE_OTHER).push(...tracks);
      byGenre.delete(g);
    }
  }
  // Les genres les plus fournis d'abord ; "Autres" (genre inconnu ou rare) toujours à la fin.
  const genres = [...byGenre.keys()].sort((a, b) =>
    (a === GENRE_OTHER) - (b === GENRE_OTHER) || byGenre.get(b).length - byGenre.get(a).length);
  return genres.map((g, i) => {
    const tracks = byGenre.get(g);
    const key = registerList(`genre-${i}`, tracks);
    return `<section class="section"><h2 class="section-title">${esc(g)}
        <span class="genre-count">${plural(tracks.length, "titre")}</span>
        <button class="btn small genre-play" data-action="play-all" data-list="${key}">${icon("play")}Tout écouter</button></h2>
      <div class="shelf">${tracks.slice(0, 14).map((t, j) => cardHTML(t, key, j)).join("")}</div></section>`;
  }).join("");
}

VIEWS.home = () => {
  if (!S.tracks.length) {
    return emptyHTML(
      "Ta bibliothèque est vide",
      "Cherche un titre ou colle un lien YouTube en haut : la musique téléchargée arrive ici, prête à être écoutée.",
      searchButton,
    );
  }
  const audio = audioTracks();
  const played = audio.filter((t) => t.last_played).sort((a, b) => b.last_played - a.last_played);
  const hero = played[0] || audio[0] || S.tracks[0];
  const recent = audio.slice(0, 14);
  const heroList = registerList("hero", [hero, ...recent.filter((t) => t.id !== hero.id)]);
  const top = frequentTracks().slice(0, 6);
  const artists = getArtists().sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 12);
  const videos = videoTracks().slice(0, 10);

  let html = `
    <section class="resume">
      ${coverHTML(hero)}
      <div>
        <div class="resume-label">${played.length ? "Reprendre l'écoute" : "Dernier ajout"}</div>
        <h1 class="resume-title">${esc(hero.title)}</h1>
        <div class="resume-artist">${esc(hero.artist)}</div>
        <div class="actions">
          <button class="btn primary" data-action="play-all" data-list="${heroList}">${icon("play")}Lecture</button>
          <button class="btn" data-action="shuffle-all" data-list="${registerList("all-audio", audio)}">${icon("shuffle")}Toute ma musique en aléatoire</button>
        </div>
      </div>
    </section>`;

  html += genreShelvesHTML(audio);
  if (top.length) {
    const key = registerList("top", top);
    html += `<section class="section"><h2 class="section-title">Tes plus écoutés</h2>
      <div class="tracklist">${top.map((t, i) => rowHTML(t, key, i)).join("")}</div></section>`;
  }
  if (artists.length) {
    html += `<section class="section"><h2 class="section-title">Tes artistes
      <button class="more" data-action="nav" data-view="artists">Tout afficher</button></h2>
      <div class="shelf">${artists.map(artistCardHTML).join("")}</div></section>`;
  }
  if (videos.length) {
    const key = registerList("home-videos", videos);
    html += `<section class="section"><h2 class="section-title">Vidéos
      <button class="more" data-action="nav" data-view="videos">Tout afficher</button></h2>
      <div class="grid wide">${videos.slice(0, 4).map((t, i) => cardHTML(t, key, i, { video: true })).join("")}</div></section>`;
  }
  return html;
};

VIEWS.songs = () => {
  const audio = audioTracks();
  if (!audio.length) {
    return `<div class="page-head"><h1 class="page-title">Titres</h1></div>` +
      emptyHTML("Aucun titre pour l'instant", "Les musiques que tu télécharges en MP3 apparaissent ici.", searchButton);
  }
  return `
    <div class="page-head"><div><h1 class="page-title">Titres</h1>
      <div class="page-sub">${plural(audio.length, "titre")}, ${fmtTotal(audio.reduce((s, t) => s + (t.duration || 0), 0))}</div></div></div>
    <div class="list-toolbar">
      ${collectionActions(registerList("songs-all", audio))}
      <button class="btn" data-action="nav" data-view="duplicates">${icon("copy")}Doublons</button>
      <input class="filter" id="songs-filter" type="search" placeholder="Filtrer les titres" value="${esc(S.songsUI.filter)}">
      <select class="select" id="songs-sort" aria-label="Trier">
        <option value="recent">Ajout récent</option>
        <option value="title">Titre</option>
        <option value="artist">Artiste</option>
        <option value="plays">Plus écoutés</option>
      </select>
    </div>
    <div class="tracklist" id="songs-list"></div>`;
};

MOUNTS.songs = (el) => {
  const sort = $("#songs-sort", el);
  if (!sort) return;
  sort.value = S.songsUI.sort;
  sort.addEventListener("change", () => { S.songsUI.sort = sort.value; renderSongsList(); });
  $("#songs-filter", el).addEventListener("input", (e) => { S.songsUI.filter = e.target.value; renderSongsList(); });
  renderSongsList();
};

function renderSongsList() {
  const box = $("#songs-list");
  if (!box) return;
  const q = norm(S.songsUI.filter.trim());
  let list = audioTracks();
  if (q) list = list.filter((t) => matchesWords(t, q));
  const cmp = {
    title: (a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }),
    artist: (a, b) => a.artist.localeCompare(b.artist, "fr", { sensitivity: "base" }) || a.title.localeCompare(b.title, "fr"),
    plays: (a, b) => (b.play_count || 0) - (a.play_count || 0),
  }[S.songsUI.sort];
  if (cmp) list = [...list].sort(cmp);
  const key = registerList("songs", list);
  box.innerHTML = list.length
    ? list.map((t, i) => rowHTML(t, key, i)).join("")
    : `<p class="muted">Aucun titre ne correspond à « ${esc(S.songsUI.filter)} ».</p>`;
}

VIEWS.artists = () => {
  const artists = getArtists();
  return `<div class="page-head"><div><h1 class="page-title">Artistes</h1>
      <div class="page-sub">${plural(artists.length, "artiste")}</div></div></div>` +
    (artists.length
      ? `<div class="grid">${artists.map(artistCardHTML).join("")}</div>`
      : emptyHTML("Aucun artiste", "Les artistes sont reconnus automatiquement à partir des titres « Artiste - Titre ».", searchButton));
};

VIEWS.artist = (name) => {
  const tracks = audioTracks().filter((t) => t.artist === name);
  const videos = videoTracks().filter((t) => t.artist === name);
  const all = [...tracks, ...videos];
  if (!all.length) return emptyHTML("Artiste introuvable", "Plus aucun titre de cet artiste dans ta bibliothèque.");
  const key = registerList("artist", tracks.length ? tracks : videos);
  let html = `
    <div class="collection-head">
      ${coverHTML(all.find((t) => t.cover) || all[0], "round")}
      <div>
        <div class="collection-kind">Artiste</div>
        <h1 class="collection-title">${esc(name)}</h1>
        <div class="collection-meta">${plural(tracks.length, "titre")}${videos.length ? `, ${plural(videos.length, "vidéo")}` : ""}</div>
        ${collectionActions(key)}
      </div>
    </div>`;
  if (tracks.length) html += `<div class="tracklist">${tracks.map((t, i) => rowHTML(t, key, i)).join("")}</div>`;
  if (videos.length) {
    const vkey = registerList("artist-videos", videos);
    html += `<section class="section"><h2 class="section-title">Vidéos</h2>
      <div class="grid wide">${videos.map((t, i) => cardHTML(t, vkey, i, { video: true })).join("")}</div></section>`;
  }
  return html;
};

VIEWS.albums = () => {
  const albums = getAlbums();
  return `<div class="page-head"><div><h1 class="page-title">Albums</h1>
      <div class="page-sub">${plural(albums.length, "album")}</div></div></div>` +
    (albums.length
      ? `<div class="grid">${albums.map(albumCardHTML).join("")}</div>`
      : emptyHTML("Aucun album pour l'instant",
          "Un album apparaît ici dès qu'un titre en a un. Fais un clic droit sur un titre, puis « Modifier les infos » pour en renseigner un."));
};

VIEWS.album = (name) => {
  const album = getAlbums().find((a) => a.name === name);
  if (!album) return emptyHTML("Album introuvable", "Plus aucun titre de cet album dans ta bibliothèque.");
  const key = registerList("album", album.tracks);
  return `
    <div class="collection-head">
      ${coverHTML(album.cover)}
      <div>
        <div class="collection-kind">Album</div>
        <h1 class="collection-title">${esc(album.name)}</h1>
        <div class="collection-meta">${esc(album.artist)}, ${plural(album.tracks.length, "titre")}, ${fmtTotal(album.tracks.reduce((s, t) => s + (t.duration || 0), 0))}</div>
        ${collectionActions(key)}
      </div>
    </div>
    <div class="tracklist">${album.tracks.map((t, i) => rowHTML(t, key, i)).join("")}</div>`;
};

VIEWS.videos = () => {
  const videos = videoTracks();
  const key = registerList("videos", videos);
  return `<div class="page-head"><div><h1 class="page-title">Vidéos</h1>
      <div class="page-sub">${plural(videos.length, "vidéo")}</div></div></div>` +
    (videos.length
      ? `<div class="grid wide">${videos.map((t, i) => cardHTML(t, key, i, { video: true })).join("")}</div>`
      : emptyHTML("Aucune vidéo", "Choisis MP4 au moment de télécharger pour garder la vidéo et la regarder ici.", searchButton));
};

VIEWS.playlist = (id) => {
  const pl = S.playlists.find((p) => p.id === id);
  if (!pl) return emptyHTML("Playlist introuvable", "Elle a peut-être été supprimée.");
  const tracks = pl.track_ids.map((tid) => S.byId.get(tid)).filter(Boolean);
  const key = registerList("playlist", tracks);
  const covers = [...new Map(tracks.filter((t) => t.cover).map((t) => [t.id, t])).values()].slice(0, 4);
  const art = covers.length >= 4
    ? `<div class="cover mosaic">${covers.map((t) => coverHTML(t)).join("")}</div>`
    : coverHTML(tracks[0] || { title: pl.name, artist: pl.name });
  return `
    <div class="collection-head">
      ${art}
      <div>
        <div class="collection-kind">Playlist</div>
        <h1 class="collection-title">${esc(pl.name)}</h1>
        <div class="collection-meta">${plural(tracks.length, "titre")}${tracks.length ? `, ${fmtTotal(tracks.reduce((s, t) => s + (t.duration || 0), 0))}` : ""}</div>
        <div class="actions">
          ${tracks.length ? `<button class="btn primary" data-action="play-all" data-list="${key}">${icon("play")}Lecture</button>
          <button class="btn" data-action="shuffle-all" data-list="${key}">${icon("shuffle")}Aléatoire</button>` : ""}
          ${phoneButtonHTML("playlist", [pl.id])}
          <button class="icon-btn" data-action="rename-playlist" data-id="${pl.id}" title="Renommer" aria-label="Renommer">${icon("edit")}</button>
          <button class="icon-btn" data-action="delete-playlist" data-id="${pl.id}" title="Supprimer la playlist" aria-label="Supprimer la playlist">${icon("trash")}</button>
        </div>
      </div>
    </div>
    ${tracks.length
      ? `<div class="tracklist">${tracks.map((t, i) => rowHTML(t, key, i, { playlistIndex: i })).join("")}</div>`
      : emptyHTML("Playlist vide", "Fais un clic droit sur un titre, puis « Ajouter à une playlist ».", "")}`;
};

// --- Recherche ---

VIEWS.search = () => {
  const q = S.search.query;
  if (!q) {
    return `<div class="page-head"><div><h1 class="page-title">Rechercher</h1>
      <div class="page-sub">Tape un artiste ou un titre dans la barre en haut, ou colle un lien YouTube.</div></div></div>`;
  }
  if (S.search.mode === "link") {
    return `<div class="page-head"><div><h1 class="page-title">Lien YouTube</h1></div></div><div id="search-link"></div>`;
  }
  const local = S.tracks.filter((t) => matchesWords(t, q)).slice(0, 5);
  let html = `<div class="page-head"><div><h1 class="page-title">${esc(q)}</h1></div></div>`;
  if (local.length) {
    const key = registerList("search-local", local);
    html += `<section class="section"><h2 class="section-title">Dans ta bibliothèque</h2>
      <div class="tracklist">${local.map((t, i) => rowHTML(t, key, i)).join("")}</div></section>`;
  }
  html += `<section class="section"><h2 class="section-title">Sur YouTube</h2><div id="yt-results"></div></section>`;
  return html;
};

MOUNTS.search = () => {
  if (S.search.mode === "link") renderLinkPanel("search");
  else renderYtResults();
};

function renderYtResults() {
  const box = $("#yt-results");
  if (!box) return;
  if (S.search.loading) {
    box.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join("");
    return;
  }
  if (S.search.error) {
    box.innerHTML = `<p class="muted">La recherche a échoué : ${esc(S.search.error)}. Vérifie ta connexion puis relance la recherche.</p>`;
    return;
  }
  const results = S.search.results || [];
  box.innerHTML = results.length
    ? `<div class="tracklist">${results.map(ytRowHTML).join("")}</div>`
    : `<p class="muted">Aucun résultat sur YouTube.</p>`;
}

function ytRowHTML(r) {
  // Les fichiers de l'ancienne version n'ont pas l'identifiant YouTube : on compare aussi titre + artiste.
  const owned = S.tracks.find((t) => t.source_id === r.id) ||
    S.tracks.find((t) => !t.source_id && norm(t.title) === norm(r.title) && norm(t.artist) === norm(r.artist));
  const job = S.downloads.find((j) => j.url === r.url && ACTIVE_STATUSES.includes(j.status));
  let actions;
  if (job) {
    actions = `<span class="tag">${icon("download")}${job.status === "queued" ? "En attente" : "Téléchargement…"}</span>`;
  } else if (owned) {
    actions = `<span class="tag">${icon("check")}Dans ta bibliothèque</span>
      <button class="btn small" data-action="play-track" data-track="${owned.id}">${icon("play")}Écouter</button>`;
  } else {
    actions = `<button class="btn small primary" data-action="yt-download" data-id="${esc(r.id)}" data-format="mp3">${icon("download")}MP3</button>
      <button class="btn small" data-action="yt-download" data-id="${esc(r.id)}" data-format="mp4">MP4</button>`;
  }
  const year = S.search.details?.[r.id]?.year;
  const previewing = previewState.id === r.id;
  return `
    <div class="row yt-row${previewing ? " previewing" : ""}">
      <button class="cover yt-thumb" data-action="yt-preview" data-id="${esc(r.id)}"
        title="${previewing ? "Arrêter l'aperçu" : "Écouter un aperçu"}" aria-label="${previewing ? "Arrêter l'aperçu" : "Écouter un aperçu"}">
        <img src="${esc(r.thumb)}" alt="" loading="lazy" draggable="false">
        <span class="preview-badge">${previewing && previewState.loading ? '<span class="spinner"></span>' : icon(previewing ? "pause" : "play")}</span>
      </button>
      <div class="row-main">
        <div class="row-title" title="${esc(r.raw_title)}">${esc(r.title)}</div>
        <div class="row-artist">${esc(r.artist)}</div>
      </div>
      <div class="row-time"><span class="yt-year">${year || (S.search.detailsLoading ? "…" : "")}</span>${fmtTime(r.duration)}</div>
      <div class="yt-actions">${actions}</div>
    </div>`;
}

/** Année de chaque résultat : YouTube ne la donne qu'en ouvrant chaque vidéo, donc après coup. */
function loadSearchDetails(query, ids) {
  S.search.details = {};
  S.search.detailsLoading = true;
  api("search_details", ids)
    .then((details) => { if (S.search.query === query) S.search.details = details; })
    .catch(() => {})
    .finally(() => {
      if (S.search.query !== query) return;
      S.search.detailsLoading = false;
      if (S.view.name === "search") renderYtResults();
    });
}

// --- Aperçu d'un résultat YouTube (30 secondes, sans télécharger) ---

const PREVIEW_SECONDS = 30;
const previewAudio = new Audio();
const previewState = { id: null, loading: false, resumeMain: false };

function stopPreview() {
  previewAudio.pause();
  previewAudio.removeAttribute("src");
  previewAudio.load();
  const wasPlaying = previewState.resumeMain;
  Object.assign(previewState, { id: null, loading: false, resumeMain: false });
  if (wasPlaying) media.play().catch(() => {});
  if (S.view.name === "search") renderYtResults();
}

async function startPreview(id) {
  const result = (S.search.results || []).find((r) => r.id === id);
  if (!result) return;
  if (previewState.id) stopPreview();
  previewState.resumeMain = !media.paused;
  media.pause();
  Object.assign(previewState, { id, loading: true });
  renderYtResults();
  try {
    const url = await api("preview_stream", id);
    if (previewState.id !== id) return;
    previewAudio.src = url;
    previewAudio.volume = media.volume;
    // On commence vers le premier tiers : c'est souvent là que le morceau "démarre" vraiment.
    const start = result.duration ? Math.min(result.duration * 0.3, Math.max(0, result.duration - PREVIEW_SECONDS)) : 0;
    previewAudio.addEventListener("loadedmetadata", () => { previewAudio.currentTime = start; }, { once: true });
    await previewAudio.play();
    previewState.loading = false;
    previewState.stopAt = start + PREVIEW_SECONDS;
    renderYtResults();
  } catch (e) {
    if (previewState.id === id) { stopPreview(); toast(`Aperçu impossible : ${errMsg(e)}`, "error"); }
  }
}

previewAudio.addEventListener("timeupdate", () => {
  if (previewState.id && previewState.stopAt && previewAudio.currentTime >= previewState.stopAt) stopPreview();
});
previewAudio.addEventListener("ended", () => { if (previewState.id) stopPreview(); });

function runSearch(query) {
  query = query.trim();
  if (!query) return;
  $("#search-input").value = query;
  S.search.query = query;
  if (isYouTubeUrl(query)) {
    S.search.mode = "link";
    go("search");
    analyzeLink("search", query);
    return;
  }
  Object.assign(S.search, { mode: "text", results: null, error: null, loading: true });
  go("search");
  api("search", query)
    .then((results) => {
      if (S.search.query !== query) return;
      S.search.results = results;
      loadSearchDetails(query, results.map((r) => r.id));
    })
    .catch((e) => { if (S.search.query === query) S.search.error = errMsg(e); })
    .finally(() => {
      if (S.search.query !== query) return;
      S.search.loading = false;
      if (S.view.name === "search") renderYtResults();
    });
}

// --- Aperçu de lien + formulaire de téléchargement ---

function newForm() {
  return {
    format: S.config.format || "mp3", quality: S.config.quality || "best",
    playlist: false, trim: false, start: "", end: "",
  };
}

async function analyzeLink(prefix, url) {
  S.links[prefix] = { url, loading: true };
  S.forms[prefix] = newForm();
  renderLinkPanel(prefix);
  try {
    const data = await api("preview", url, false);
    if (S.links[prefix]?.url !== url) return;
    S.links[prefix] = { url, data };
  } catch (e) {
    if (S.links[prefix]?.url !== url) return;
    S.links[prefix] = { url, error: errMsg(e) };
  }
  renderLinkPanel(prefix);
}

function renderLinkPanel(prefix) {
  const box = $(`#${prefix}-link`);
  if (!box) return;
  const link = S.links[prefix];
  if (!link) { box.innerHTML = ""; return; }
  if (link.loading) {
    box.innerHTML = `<div class="panel"><div class="skeleton"></div><p class="muted">Analyse du lien…</p></div>`;
    return;
  }
  const form = S.forms[prefix] || (S.forms[prefix] = newForm());
  const d = link.data;
  const isPlaylist = d?.kind === "playlist";
  const head = d
    ? `<div class="link-preview">
         <div class="cover">${d.thumb ? `<img src="${esc(d.thumb)}" alt="">` : ""}</div>
         <div>
           <h3>${esc(d.title)}</h3>
           <div class="muted">${isPlaylist ? `Playlist, ${plural(d.count, "vidéo")}` : `${esc(d.artist)}${d.duration ? `, ${fmtTime(d.duration)}` : ""}`}</div>
         </div>
       </div>`
    : `<p class="muted">Aperçu indisponible : ${esc(link.error)}. Tu peux quand même essayer de télécharger.</p>`;

  const seg = (value, label) =>
    `<button type="button" class="${form.format === value ? "active" : ""}" data-action="form-format" data-form="${prefix}" data-value="${value}">${label}</button>`;
  const qualities = [["best", "Meilleure qualité"], ["1080p", "1080p"], ["720p", "720p"], ["480p", "480p"], ["360p", "360p"]];
  const durationText = d?.duration ? fmtTime(d.duration) : "";

  box.innerHTML = `
    <div class="panel">
      ${head}
      <div class="form-grid">
        <div class="segmented" role="group" aria-label="Format">${seg("mp3", "Audio MP3")}${seg("mp4", "Vidéo MP4")}</div>
        ${form.format === "mp4" ? `<select class="select" data-form="${prefix}" data-field="quality" aria-label="Qualité vidéo">
            ${qualities.map(([v, l]) => `<option value="${v}"${form.quality === v ? " selected" : ""}>${l}</option>`).join("")}
          </select>` : ""}
        ${!isPlaylist && (d?.has_list || /[?&]list=/.test(link.url)) ? `<label class="check"><input type="checkbox" data-form="${prefix}" data-field="playlist"${form.playlist ? " checked" : ""}>Télécharger toute la playlist</label>` : ""}
        ${!isPlaylist && !form.playlist ? `<label class="check"><input type="checkbox" data-form="${prefix}" data-field="trim"${form.trim ? " checked" : ""}>Ne garder qu'un extrait</label>` : ""}
      </div>
      ${form.trim && !isPlaylist && !form.playlist ? `
        <div class="trim form-grid">
          <input class="field time-field" data-form="${prefix}" data-field="start" placeholder="0:00" value="${esc(form.start || "0:00")}" aria-label="Début">
          <span class="muted">jusqu'à</span>
          <input class="field time-field" data-form="${prefix}" data-field="end" placeholder="${esc(durationText || "fin")}" value="${esc(form.end || durationText)}" aria-label="Fin">
        </div>` : ""}
      <div class="actions">
        <button class="btn primary" data-action="form-submit" data-form="${prefix}">${icon("download")}Télécharger</button>
        ${isPlaylist || form.playlist ? `<span class="hint">Une playlist du même nom sera créée dans ta bibliothèque.</span>` : ""}
      </div>
    </div>`;
}

async function submitForm(prefix) {
  const link = S.links[prefix];
  const form = S.forms[prefix];
  if (!link || !form) return;
  const d = link.data || {};
  const options = {
    url: link.url, format: form.format, quality: form.quality,
    playlist: !!form.playlist, title: d.kind === "playlist" ? d.title : (d.raw_title || d.title || null),
    thumb: d.thumb || null,
  };
  if (form.trim && !form.playlist && d.kind !== "playlist") {
    const start = parseTime(form.start || "0:00");
    const end = parseTime(form.end || "");
    if (Number.isNaN(start) || Number.isNaN(end)) {
      toast("Extrait invalide : utilise un format comme 1:23 ou 0:07.", "error");
      return;
    }
    if (end != null && end <= (start || 0)) {
      toast("La fin de l'extrait doit être après le début.", "error");
      return;
    }
    // Pas de découpe si l'extrait couvre toute la vidéo : évite un réencodage inutile.
    const coversAll = !start && (end == null || (d.duration && Math.abs(end - d.duration) < 1));
    if (!coversAll) { options.start = start || 0; options.end = end; }
  }
  try {
    await api("download", options);
    toast("Ajouté aux téléchargements");
    delete S.links[prefix];
    if (prefix === "dl") { renderLinkPanel("dl"); const input = $("#dl-url"); if (input) input.value = ""; }
    if (prefix === "search") { S.search.query = ""; $("#search-input").value = ""; go("downloads"); }
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

// --- Téléchargements ---

VIEWS.downloads = () => `
  <div class="page-head"><div><h1 class="page-title">Téléchargements</h1>
    <div class="page-sub">Colle un lien de vidéo ou de playlist YouTube, ou cherche un titre dans la barre en haut.</div></div></div>
  <form class="url-form" id="dl-form" autocomplete="off">
    <input class="field" id="dl-url" type="text" placeholder="https://www.youtube.com/watch?v=…" aria-label="Lien YouTube">
    <button type="button" class="btn" data-action="paste-dl">Coller</button>
    <button type="submit" class="btn primary">Analyser le lien</button>
  </form>
  <div id="dl-link" style="margin-top:18px"></div>
  <section class="section">
    <h2 class="section-title">File de téléchargement <span id="dl-clear"></span></h2>
    <div id="dl-list"></div>
  </section>
  ${S.bridge ? "" : `<p class="hint">Le bouton de l'extension navigateur est désactivé : une autre application utilise déjà le port 47935 (sans doute l'ancienne version, ferme-la puis relance l'appli).</p>`}`;

MOUNTS.downloads = (el) => {
  $("#dl-form", el).addEventListener("submit", (e) => {
    e.preventDefault();
    const url = $("#dl-url").value.trim();
    if (!isYouTubeUrl(url)) { toast("Ce lien n'est pas un lien YouTube.", "error"); return; }
    analyzeLink("dl", url);
  });
  if (S.links.dl) { $("#dl-url", el).value = S.links.dl.url; renderLinkPanel("dl"); }
  renderDlList();
};

function renderDlList() {
  const box = $("#dl-list");
  if (!box) return;
  const jobs = [...S.downloads].reverse();
  const hasFinished = jobs.some((j) => !ACTIVE_STATUSES.includes(j.status));
  $("#dl-clear").innerHTML = hasFinished ? `<button class="more" data-action="dl-clear">Effacer les terminés</button>` : "";
  box.innerHTML = jobs.length
    ? `<div class="panel">${jobs.map(dlItemHTML).join("")}</div>`
    : `<p class="muted">Aucun téléchargement pour l'instant.</p>`;
}

function dlItemHTML(j) {
  const active = ACTIVE_STATUSES.includes(j.status);
  const detailClass = j.status === "error" ? " error" : j.status === "done" ? " done" : "";
  const detail = j.status === "error" ? j.error || "Échec" : j.detail;
  return `
    <div class="dl-item">
      <div class="cover">${j.thumb ? `<img src="${esc(j.thumb)}" alt="">` : ""}</div>
      <div style="min-width:0">
        <div class="dl-title"><span class="fmt">${j.format === "mp4" ? "MP4" : "MP3"}</span>${esc(j.title)}</div>
        <div class="dl-detail${detailClass}">${esc(detail)}</div>
        ${active ? `<div class="bar"><span style="width:${Math.round((j.progress || 0) * 100)}%"></span></div>` : ""}
      </div>
      <div class="dl-actions">
        ${j.status !== "done" ? `<button class="icon-btn" data-action="dl-retry" data-id="${esc(j.id)}" title="Relancer le téléchargement" aria-label="Relancer le téléchargement">${icon("refresh")}</button>` : ""}
        ${active ? `<button class="btn small" data-action="dl-cancel" data-id="${esc(j.id)}">Annuler</button>` : ""}
      </div>
    </div>`;
}

function updateBadge() {
  const n = S.downloads.filter((j) => ACTIVE_STATUSES.includes(j.status)).length;
  const badge = $("#dl-badge");
  badge.hidden = !n;
  badge.textContent = n;
}

const lastJobStatus = new Map();
function onDownloadEvent(job) {
  const i = S.downloads.findIndex((j) => j.id === job.id);
  if (i >= 0) S.downloads[i] = job; else S.downloads.push(job);
  updateBadge();
  if (S.view.name === "downloads") renderDlList();
  const statusChanged = lastJobStatus.get(job.id) !== job.status;
  lastJobStatus.set(job.id, job.status);
  if (statusChanged && S.view.name === "search" && S.search.mode === "text") renderYtResults();
  if (statusChanged && job.status === "error") toast(`Échec : ${job.error || job.title}`, "error");
}

// --- Réglages ---

VIEWS.settings = () => {
  const c = S.config;
  const qualities = [["best", "Meilleure qualité"], ["1080p", "1080p"], ["720p", "720p"], ["480p", "480p"], ["360p", "360p"]];
  return `
    <div class="page-head"><h1 class="page-title">Réglages</h1></div>
    <div class="settings">
      <div class="panel">
        <div class="settings-block-title">Thème</div>
        <div class="setting-value">Caméléon prend la couleur de la pochette en cours de lecture.</div>
        <div class="themes">${THEMES.map(themeCardHTML).join("")}</div>
      </div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Lancer Audora au démarrage du PC</div>
          <div class="setting-value">Audora s'ouvre tout seul, réduit dans la barre des tâches, quand tu allumes ton PC.</div></div>
        <label class="check"><input type="checkbox" data-autostart${S.autostart ? " checked" : ""}>Activé</label>
      </div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Raccourci sur le Bureau</div>
          <div class="setting-value">Ajoute une icône Audora sur ton Bureau (ou la remplace si elle existe déjà).</div></div>
        <button class="btn small" data-action="desktop-shortcut">Créer le raccourci</button>
      </div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Dossier de la bibliothèque</div>
          <div class="setting-value">${esc(c.library_folder)}</div></div>
        <div class="actions">
          <button class="btn small" data-action="open-library">${icon("folder")}Ouvrir</button>
          <button class="btn small" data-action="choose-library">Changer</button>
        </div>
      </div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Ranger les musiques par artiste</div>
          <div class="setting-value">Chaque MP3 va dans un sous-dossier au nom de l'artiste.</div></div>
        <label class="check"><input type="checkbox" data-setting="organize_by_artist"${c.organize_by_artist ? " checked" : ""}>Activé</label>
      </div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Volume égalisé</div>
          <div class="setting-value">Tous les morceaux sonnent aussi fort : plus de musique qui te fait sursauter après une plus calme. Chaque titre est mesuré une fois, en arrière-plan.</div></div>
        <label class="check"><input type="checkbox" data-setting="normalize_volume"${c.normalize_volume !== false ? " checked" : ""}>Activé</label>
      </div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Mode Spatial</div>
          <div class="setting-value">Élargit le son stéréo pour plus d'espace et d'immersion, surtout au casque.</div></div>
        <label class="check"><input type="checkbox" data-setting="spatial"${c.spatial ? " checked" : ""}>Activé</label>
      </div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Fondu enchaîné</div>
          <div class="setting-value">Le titre suivant démarre en fondu pendant que l'actuel se termine.</div></div>
        <select class="select" data-setting="crossfade">
          ${[[0, "Désactivé"], [3, "3 secondes"], [5, "5 secondes"], [8, "8 secondes"], [12, "12 secondes"]].map(([v, l]) =>
            `<option value="${v}"${Number(c.crossfade || 0) === v ? " selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Seulement la musique</div>
          <div class="setting-value">Coupe les blancs et les passages parlés des clips (intro, sketch, générique) à chaque nouveau téléchargement.</div></div>
        <label class="check"><input type="checkbox" data-setting="trim_audio"${c.trim_audio !== false ? " checked" : ""}>Activé</label>
      </div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Nettoyer les musiques déjà là</div>
          <div class="setting-value">Analyse ta bibliothèque et te montre ce qui serait coupé, avant de toucher à quoi que ce soit.</div></div>
        <button class="btn small" data-action="nav" data-view="trim">Analyser</button>
      </div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Format par défaut</div>
          <div class="setting-value">Utilisé par l'extension navigateur et proposé en premier.</div></div>
        <div class="segmented">
          <button class="${c.format !== "mp4" ? "active" : ""}" data-action="set-default-format" data-value="mp3">Audio MP3</button>
          <button class="${c.format === "mp4" ? "active" : ""}" data-action="set-default-format" data-value="mp4">Vidéo MP4</button>
        </div>
      </div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Qualité vidéo par défaut</div></div>
        <select class="select" data-setting="quality">
          ${qualities.map(([v, l]) => `<option value="${v}"${c.quality === v ? " selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <div class="panel setting" id="engine-setting">${engineSettingHTML()}</div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Actualiser la bibliothèque</div>
          <div class="setting-value">Ajoute les fichiers copiés à la main dans le dossier et retire ceux qui ont disparu.</div></div>
        <button class="btn small" data-action="rescan">${icon("refresh")}Actualiser</button>
      </div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Extension navigateur</div>
          <div class="setting-value">${S.bridge
            ? "Prête : le bouton Télécharger sur YouTube envoie directement les vidéos ici."
            : "Désactivée : le port 47935 est utilisé par une autre application (sans doute l'ancienne version)."}</div></div>
      </div>
    </div>`;
};

function themeCardHTML(theme) {
  const [bg, panel, , line, text, text2, , accent] = theme.c;
  const accentColor = accent === "chameleon" ? "rgb(var(--ambient))" : accent;
  const active = (S.config.theme || "prune") === theme.id;
  return `
    <button class="theme-card${active ? " active" : ""}" data-action="set-theme" data-value="${theme.id}" aria-pressed="${active}">
      <div class="theme-preview" style="background:${bg}">
        <div style="background:${panel};border-right:1px solid ${line}"></div>
        <div class="tp-main">
          <div class="tp-line" style="background:${text};width:70%"></div>
          <div class="tp-line" style="background:${text2};width:45%;opacity:.7"></div>
          <div class="tp-dot" style="background:${accentColor}"></div>
        </div>
      </div>
      <div class="theme-name">${esc(theme.name)}${active ? icon("check") : ""}</div>
    </button>`;
}

// ---------- Routeur ----------

// Historique des pages : bouton "précédent / suivant" de la souris, Alt+← / Alt+→.
const nav = { back: [], forward: [] };

function go(name, param = null, { record = true, scroll = 0 } = {}) {
  if (previewState.id && name !== "search") stopPreview();
  const same = S.view.name === name && S.view.param === param;
  if (record && !same) {
    nav.back.push({ ...S.view, scroll: $("#view").scrollTop });
    if (nav.back.length > 50) nav.back.shift();
    nav.forward = [];
  }
  S.view = { name, param };
  render();
  $("#view").scrollTop = scroll;
}

/** Retour : ferme d'abord ce qui est ouvert par-dessus (menu, fenêtre, lecteur plein écran). */
function navBack() {
  if (!$("#menu").hidden) { closeMenu(); return; }
  const modal = $("#modal-root .modal-backdrop");
  if (modal) { modal.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); return; }
  if (!$("#nowplaying").hidden) { $("#nowplaying").hidden = true; return; }
  const prev = nav.back.pop();
  if (!prev) return;
  nav.forward.push({ ...S.view, scroll: $("#view").scrollTop });
  go(prev.name, prev.param, { record: false, scroll: prev.scroll });
}

function navForward() {
  const next = nav.forward.pop();
  if (!next) return;
  nav.back.push({ ...S.view, scroll: $("#view").scrollTop });
  go(next.name, next.param, { record: false, scroll: next.scroll });
}

// Boutons 4 et 5 de la souris. On empeche aussi WebView2 de faire son propre "retour",
// qui quitterait l'interface pour revenir a la page de demarrage.
for (const type of ["mousedown", "mouseup", "auxclick"]) {
  window.addEventListener(type, (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    if (type === "mouseup") (e.button === 3 ? navBack : navForward)();
  });
}

function render() {
  S.lists = {};
  const el = $("#view");
  el.innerHTML = (VIEWS[S.view.name] || VIEWS.home)(S.view.param);
  MOUNTS[S.view.name]?.(el, S.view.param);
  const navView = { artist: "artists", album: "albums", duplicates: "songs", trim: "settings" }[S.view.name] || S.view.name;
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === navView));
  $$(".playlist-link").forEach((b) => b.classList.toggle("active", S.view.name === "playlist" && +b.dataset.id === S.view.param));
}

/** Re-rend la vue courante sans perdre le défilement ni la saisie en cours. */
function refreshView() {
  if (S.view.name === "downloads") { renderDlList(); return; }
  const el = $("#view");
  const scroll = el.scrollTop;
  const active = document.activeElement;
  const focusId = active && el.contains(active) && active.id ? active.id : null;
  const selection = focusId && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null;
  render();
  el.scrollTop = scroll;
  if (focusId) {
    const node = document.getElementById(focusId);
    if (node) {
      node.focus();
      if (selection) try { node.setSelectionRange(...selection); } catch { /* champ sans sélection */ }
    }
  }
}

function renderPlaylistNav() {
  const box = $("#playlist-nav");
  box.innerHTML = S.playlists.length
    ? S.playlists.map((p) => `<button class="playlist-link" data-action="goto-playlist" data-id="${p.id}" title="${esc(p.name)}">${esc(p.name)}</button>`).join("")
    : `<div class="playlist-empty">Aucune playlist</div>`;
  $$(".playlist-link").forEach((b) => b.classList.toggle("active", S.view.name === "playlist" && +b.dataset.id === S.view.param));
}

// ---------- Lecteur ----------

let pendingSeek = 0;
let seeking = false;
let lastSessionSave = 0;
let errorStreak = 0;

function playList(ids, start = 0, { shuffle = false } = {}) {
  ids = ids.filter((id) => S.byId.has(id));
  if (!ids.length) return;
  S.queue = ids.slice();
  S.qi = Math.min(Math.max(start, 0), ids.length - 1);
  S.unshuffled = null;
  if (shuffle) {
    S.shuffle = true;
    S.qi = Math.floor(Math.random() * ids.length);
  }
  if (S.shuffle) applyShuffle();
  updateModeButtons();
  loadCurrent(true);
}

function applyShuffle() {
  S.unshuffled = S.queue.slice();
  const current = S.queue[S.qi];
  const rest = shuffleArray(S.queue.filter((_, i) => i !== S.qi));
  S.queue = [current, ...rest];
  S.qi = 0;
}

function toggleShuffle() {
  if (!S.shuffle) {
    S.shuffle = true;
    if (S.qi >= 0) applyShuffle();
  } else {
    S.shuffle = false;
    if (S.unshuffled) {
      const cur = currentId();
      S.queue = S.unshuffled;
      S.qi = Math.max(0, S.queue.indexOf(cur));
      S.unshuffled = null;
    }
  }
  updateModeButtons();
  renderQueue();
  saveSession();
}

function cycleRepeat() {
  S.repeat = { off: "all", all: "one", one: "off" }[S.repeat];
  updateModeButtons();
  saveSession();
}


// ---------- Moteur audio : volume égalisé, limiteur, fondu enchaîné ----------
//
// Le son passe par Web Audio : lecteur -> gain du titre (volume égalisé) -> [mode Spatial] -> limiteur -> sortie.
// Un 2e lecteur caché ("fader") joue le début du titre suivant pendant le fondu enchaîné ;
// à la fin du fondu, le lecteur principal reprend ce titre là où le fader en est.

const fader = new Audio();
fader.preload = "auto";
let audioGraph = null;  // null = pas encore créé, false = Web Audio indisponible
let fade = null;  // { index, track } pendant un fondu enchaîné

function ensureAudioGraph() {
  if (audioGraph !== null) return audioGraph;
  try {
    const ctx = new AudioContext();
    const limiter = ctx.createDynamicsCompressor();  // empêche la saturation quand on monte le son
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);
    const bus = ctx.createGain();  // les deux lecteurs se rejoignent ici
    const route = (element) => {
      const gain = ctx.createGain();
      ctx.createMediaElementSource(element).connect(gain).connect(bus);
      return gain;
    };
    audioGraph = { ctx, bus, limiter, spatial: createSpatial(ctx, limiter), main: route(media), fader: route(fader) };
    applySpatial();
  } catch {
    audioGraph = false;  // le son passe alors directement, sans égalisation
  }
  return audioGraph;
}

/**
 * Mode Spatial : élargit l'image stéréo (mid/side). Chaque sortie mélange son canal et
 * l'opposé en négatif : G' = a·G + b·D, D' = a·D + b·G avec a = (1+w)/2, b = (1-w)/2.
 * Un son mono (G = D) ressort identique : seule la partie "stéréo" est élargie.
 */
function createSpatial(ctx, output) {
  const width = 1.6;
  const a = (1 + width) / 2, b = (1 - width) / 2;
  const input = ctx.createGain();
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  input.connect(split);
  const wire = (from, to, value) => {
    const g = ctx.createGain();
    g.gain.value = value;
    split.connect(g, from);
    g.connect(merge, 0, to);
  };
  wire(0, 0, a); wire(1, 0, b);  // gauche
  wire(1, 1, a); wire(0, 1, b);  // droite
  const trim = ctx.createGain();
  trim.gain.value = 0.9;  // l'élargissement ajoute un peu d'énergie
  merge.connect(trim).connect(output);
  return input;
}

function applySpatial() {
  const g = audioGraph;
  if (!g) return;
  g.bus.disconnect();
  g.bus.connect(S.config.spatial ? g.spatial : g.limiter);
}

/** Facteur de volume (linéaire) du volume égalisé pour un titre. */
function trackGain(t) {
  if (!t || S.config.normalize_volume === false || t.gain == null) return 1;
  return 10 ** (t.gain / 20);
}

function rampGain(node, value, seconds = 0.08) {
  const now = audioGraph.ctx.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(node.gain.value, now);
  node.gain.linearRampToValueAtTime(value, now + seconds);
}

function applyTrackGain() {
  const g = ensureAudioGraph();
  if (!g) return;
  if (g.ctx.state !== "running") g.ctx.resume().catch(() => {});
  if (!fade) rampGain(g.main, trackGain(currentTrack()));
}

const crossfadeSeconds = () => Number(S.config.crossfade) || 0;

function upcomingIndex() {
  if (S.repeat === "one") return -1;
  if (S.qi < S.queue.length - 1) return S.qi + 1;
  return S.repeat === "all" && S.queue.length > 1 ? 0 : -1;
}

/** Appelé à chaque avancée de la lecture : démarre le fondu quand la fin approche. */
function crossfadeTick() {
  const seconds = crossfadeSeconds();
  if (!seconds || fade || media.paused || seeking) return;
  const remaining = media.duration - media.currentTime;
  if (!isFinite(remaining) || remaining > seconds || media.duration < seconds * 3) return;
  const index = upcomingIndex();
  const now = currentTrack(), track = index >= 0 ? S.byId.get(S.queue[index]) : null;
  if (!track || now?.kind === "video" || track.kind === "video") return;
  const g = ensureAudioGraph();
  if (!g) return;
  fade = { index, track };
  fader.volume = media.volume;
  fader.muted = media.muted;
  fader.src = `/media/${track.id}`;
  g.fader.gain.setValueAtTime(0, g.ctx.currentTime);
  fader.play().then(() => {
    if (!fade) return;
    rampGain(g.fader, trackGain(track), remaining);
    rampGain(g.main, 0, remaining);
  }).catch(() => cancelCrossfade());
}

/** Fin du titre pendant un fondu : le lecteur principal prend le relais du fader. */
function finishCrossfade() {
  const { index } = fade;
  const g = audioGraph;
  const at = fader.currentTime;
  fade = null;
  S.qi = index;
  loadCurrent(true, at + 0.05);
  rampGain(g.main, 0, 0.01);
  media.addEventListener("playing", function handoff() {
    media.removeEventListener("playing", handoff);
    rampGain(g.main, trackGain(currentTrack()), 0.06);
    rampGain(g.fader, 0, 0.06);
    setTimeout(() => { if (!fade) { fader.pause(); fader.removeAttribute("src"); fader.load(); } }, 120);
  });
}

function cancelCrossfade() {
  if (!fade) return;
  fade = null;
  fader.pause();
  fader.removeAttribute("src");
  fader.load();
  if (audioGraph) rampGain(audioGraph.main, trackGain(currentTrack()));
}

function loadCurrent(autoplay = true, startAt = 0) {
  const t = currentTrack();
  if (!t) return;
  cancelCrossfade();
  if (autoplay && previewState.id) { previewState.resumeMain = false; stopPreview(); }
  media.src = `/media/${t.id}`;
  pendingSeek = startAt || 0;
  applyTrackGain();
  if (autoplay) {
    media.play().catch(() => {});
    t.play_count = (t.play_count || 0) + 1;
    t.last_played = Date.now() / 1000;
    api("record_play", t.id).catch(() => {});
  }
  updateNowPlaying();
  markPlayingRows();
  renderQueue();
  setAmbient(t);
  updateMediaSession(t);
  saveSession();
  if (t.kind === "video" && autoplay) openNowPlaying();
}

function next(auto = false) {
  if (!S.queue.length) return;
  if (auto && S.repeat === "one") {
    media.currentTime = 0;
    media.play().catch(() => {});
    return;
  }
  if (S.qi < S.queue.length - 1) {
    S.qi++;
    loadCurrent(true);
  } else if (S.repeat === "all") {
    S.qi = 0;
    loadCurrent(true);
  } else if (auto) {
    media.pause();
    media.currentTime = 0;
  }
}

function prev() {
  if (media.currentTime > 3 || S.qi <= 0) {
    media.currentTime = 0;
    return;
  }
  S.qi--;
  loadCurrent(true);
}

function togglePlay() {
  if (!currentTrack()) {
    const ids = audioTracks().map((t) => t.id);
    if (ids.length) playList(ids, 0);
    return;
  }
  if (media.paused) media.play().catch(() => {});
  else media.pause();
}

function playNext(ids) {
  if (S.qi < 0) { playList(ids, 0); return; }
  S.queue.splice(S.qi + 1, 0, ...ids);
  if (S.unshuffled) S.unshuffled.push(...ids);
  renderQueue();
  saveSession();
}

function addToQueue(ids) {
  if (S.qi < 0) { playList(ids, 0); return; }
  S.queue.push(...ids);
  if (S.unshuffled) S.unshuffled.push(...ids);
  renderQueue();
  saveSession();
}

function removeFromQueue(trackId) {
  const cur = currentId();
  S.queue = S.queue.filter((id) => id !== trackId);
  if (S.unshuffled) S.unshuffled = S.unshuffled.filter((id) => id !== trackId);
  S.qi = cur === trackId ? Math.min(S.qi, S.queue.length - 1) : S.queue.indexOf(cur);
}

function stopPlayback() {
  media.pause();
  media.removeAttribute("src");
  media.load();
}

function updatePlayState() {
  const playing = !media.paused && !!media.getAttribute("src");
  $("#btn-play").innerHTML = icon(playing ? "pause" : "play");
  $("#btn-play").setAttribute("aria-label", playing ? "Pause" : "Lecture");
  document.body.classList.toggle("paused", !playing);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  const t = currentTrack();
  api("set_playback_state", playing, t?.title || null, t?.artist || null).catch(() => {});
}

function updateModeButtons() {
  $("#btn-shuffle").classList.toggle("on", S.shuffle);
  const rep = $("#btn-repeat");
  rep.classList.toggle("on", S.repeat === "all");
  rep.classList.toggle("on-one", S.repeat === "one");
  rep.title = { off: "Répéter", all: "Répéter tout", one: "Répéter ce titre" }[S.repeat];
}

function setSliderFill(slider, fraction) {
  slider.style.setProperty("--fill", `${Math.max(0, Math.min(1, fraction)) * 100}%`);
}

function updateTime() {
  const dur = media.duration;
  const cur = media.currentTime || 0;
  $("#time-total").textContent = fmtTime(isFinite(dur) ? dur : currentTrack()?.duration) || "0:00";
  if (seeking) return;
  $("#time-current").textContent = fmtTime(cur) || "0:00";
  const seek = $("#seek");
  const fraction = isFinite(dur) && dur > 0 ? cur / dur : 0;
  seek.value = Math.round(fraction * 1000);
  setSliderFill(seek, fraction);
  if (!media.paused && Date.now() - lastSessionSave > 10000) saveSession();
}

function updateNowPlaying() {
  const t = currentTrack();
  $("#player-title").textContent = t ? t.title : "Rien en lecture";
  $("#player-artist").textContent = t ? t.artist : "";
  const chip = $("#player-genre");
  chip.hidden = !t || t.kind === "video";
  chip.textContent = t ? (t.genre || "Choisir un genre") : "";
  chip.classList.toggle("empty", !t?.genre);
  $("#player-more").hidden = !t;
  $("#player-cover").innerHTML = t ? coverHTML(t) : "";
  $("#np-title").textContent = t ? t.title : "";
  $("#np-artist").textContent = t ? t.artist : "";
  $("#np-cover").innerHTML = t ? coverHTML(t) : "";
  $("#np-stage").classList.toggle("is-video", t?.kind === "video");
  $("#np-backdrop").style.backgroundImage = t?.cover ? `url("${coverUrl(t)}")` : "none";
  document.title = t ? `${t.title} – ${t.artist}` : "Audora";
}

function markPlayingRows() {
  const id = currentId();
  $$(".row[data-track]").forEach((r) => r.classList.toggle("playing", +r.dataset.track === id));
}

function openNowPlaying() { $("#nowplaying").hidden = false; }
function toggleNowPlaying() {
  if (!currentTrack()) return;
  $("#nowplaying").hidden = !$("#nowplaying").hidden;
}

function renderQueue() {
  const panel = $("#queue");
  if (panel.hidden) return;
  const box = $("#queue-list");
  const cur = currentTrack();
  if (!cur) {
    box.innerHTML = `<p class="muted" style="padding:8px">La file est vide. Lance un titre pour la remplir.</p>`;
    return;
  }
  const upcoming = S.queue.slice(S.qi + 1).map((id, offset) => ({ t: S.byId.get(id), index: S.qi + 1 + offset })).filter((x) => x.t);
  const item = ({ t, index }, isCurrent = false) => `
    <div class="row${isCurrent ? " playing" : ""}" role="button" tabindex="0" data-action="queue-jump" data-index="${index}" data-track="${t.id}">
      ${coverHTML(t, "", EQ)}
      <div class="row-main"><div class="row-title">${esc(t.title)}</div><div class="row-artist">${esc(t.artist)}</div></div>
      ${isCurrent ? "<span></span>" : `<button class="icon-btn small" data-action="queue-remove" data-index="${index}" aria-label="Retirer de la file">${icon("close")}</button>`}
    </div>`;
  box.innerHTML = `
    <div class="queue-label">En cours</div>${item({ t: cur, index: S.qi }, true)}
    <div class="queue-label">À suivre${upcoming.length ? ` (${upcoming.length})` : ""}</div>
    ${upcoming.length ? upcoming.map((x) => item(x)).join("") : `<p class="muted" style="padding:4px 8px">Rien après ce titre.</p>`}`;
}

// --- Couleur d'ambiance tirée de la pochette ---

function setAmbientRGB(r, g, b) {
  const max = Math.max(r, g, b);
  if (max < 130) {
    const f = 130 / Math.max(max, 1);
    r *= f; g *= f; b *= f;
  }
  document.documentElement.style.setProperty("--ambient", `${Math.min(255, r) | 0} ${Math.min(255, g) | 0} ${Math.min(255, b) | 0}`);
}

function setAmbient(t) {
  if (!t) return;
  if (!t.cover) {
    const [r, g, b] = PALETTE[hashStr(t.artist || t.title || "") % PALETTE.length];
    setAmbientRGB(r, g, b);
    return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      const size = 24;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let R = 0, G = 0, B = 0, W = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const sat = max ? (max - min) / max : 0;
        const w = 0.04 + sat * sat * (max > 40 ? 1 : 0.1); // privilégie les couleurs vives
        R += r * w; G += g * w; B += b * w; W += w;
      }
      setAmbientRGB(R / W, G / W, B / W);
    } catch { /* image illisible : on garde la couleur actuelle */ }
  };
  img.src = coverUrl(t);
}

// --- Touches multimédia du clavier / Windows ---

function updateMediaSession(t) {
  if (!("mediaSession" in navigator) || !t) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist, album: t.album || "",
      artwork: t.cover ? [{ src: location.origin + coverUrl(t), sizes: "640x640", type: "image/jpeg" }] : [],
    });
  } catch { /* non supporté */ }
}

function bindMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const handlers = {
    play: () => media.play().catch(() => {}),
    pause: () => media.pause(),
    previoustrack: prev,
    nexttrack: () => next(),
    seekto: (d) => { if (d.seekTime != null) media.currentTime = d.seekTime; },
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* action non supportée */ }
  }
}

// --- Session (reprendre là où on s'était arrêté) ---

let sessionTimer = null;
function saveSession() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    lastSessionSave = Date.now();
    api("set_config", "session", {
      queue: S.queue.slice(0, 1000), qi: S.qi, time: media.currentTime || 0,
      shuffle: S.shuffle, repeat: S.repeat,
    }).catch(() => {});
  }, 600);
}

function restoreSession() {
  const s = S.config.session;
  if (S.sessionRestored || !s || !Array.isArray(s.queue) || !S.tracks.length) return;
  S.sessionRestored = true;
  const current = s.queue[s.qi];
  S.queue = s.queue.filter((id) => S.byId.has(id));
  S.qi = S.queue.indexOf(current);
  S.shuffle = !!s.shuffle;
  S.repeat = ["off", "all", "one"].includes(s.repeat) ? s.repeat : "off";
  updateModeButtons();
  if (S.qi < 0) {
    S.qi = S.queue.length ? 0 : -1;
    if (S.qi >= 0) loadCurrent(false, 0);
    return;
  }
  loadCurrent(false, s.time || 0);
}

function bindPlayer() {
  media.addEventListener("loadedmetadata", () => {
    if (pendingSeek && pendingSeek < media.duration) media.currentTime = pendingSeek;
    pendingSeek = 0;
    updateTime();
  });
  media.addEventListener("timeupdate", updateTime);
  media.addEventListener("timeupdate", crossfadeTick);
  media.addEventListener("play", () => { errorStreak = 0; applyTrackGain(); updatePlayState(); });
  media.addEventListener("pause", () => {
    if (fade && !media.ended) cancelCrossfade();  // pause pendant un fondu : on l'abandonne
    updatePlayState();
    saveSession();
  });
  media.addEventListener("seeking", () => { if (fade) cancelCrossfade(); });
  media.addEventListener("ended", () => (fade ? finishCrossfade() : next(true)));
  media.addEventListener("error", () => {
    if (!media.getAttribute("src")) return;
    errorStreak++;
    toast("Impossible de lire ce fichier : il a peut-être été déplacé ou supprimé.", "error");
    if (errorStreak < 3 && S.qi < S.queue.length - 1) next(true);
  });

  const seek = $("#seek");
  seek.addEventListener("input", () => {
    seeking = true;
    const dur = media.duration;
    const fraction = seek.value / 1000;
    setSliderFill(seek, fraction);
    if (isFinite(dur)) $("#time-current").textContent = fmtTime(fraction * dur);
  });
  seek.addEventListener("change", () => {
    const dur = media.duration;
    if (isFinite(dur)) media.currentTime = (seek.value / 1000) * dur;
    seeking = false;
  });

  const volume = $("#volume");
  const wrap = $("#vol-wrap");
  volume.addEventListener("input", () => setVolumePosition(+volume.value));
  volume.addEventListener("pointerdown", () => wrap.classList.add("active"));
  window.addEventListener("pointerup", () => wrap.classList.remove("active"));
  // Molette : crans fins (Maj = encore plus fin) pour doser les tout petits volumes.
  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const step = e.shiftKey ? 4 : 20;
    const direction = (e.deltaY || e.deltaX) < 0 ? 1 : -1;
    setVolumePosition(+volume.value + direction * step);
  }, { passive: false });
  volume.addEventListener("keydown", (e) => {
    const delta = { ArrowUp: 10, ArrowRight: 10, ArrowDown: -10, ArrowLeft: -10, PageUp: 100, PageDown: -100 }[e.key];
    if (delta == null) return;
    e.preventDefault();
    e.stopPropagation();
    setVolumePosition(+volume.value + delta);
  });
  bindMediaSession();
  updatePlayState();
  updateModeButtons();
}

// --- Volume ---
// L'oreille perçoit le volume de façon logarithmique : avec un curseur linéaire, tout se joue
// dans les premiers pixels. Courbe cubique : 10 % du curseur = 0,1 % du volume, 46 % = 10 %.
const VOLUME_MAX_POS = 1000;
const positionToGain = (pos) => Math.pow(pos / VOLUME_MAX_POS, 3);
const gainToPosition = (gain) => Math.round(Math.cbrt(Math.max(0, Math.min(1, gain))) * VOLUME_MAX_POS);

function formatGain(gain) {
  const pct = gain * 100;
  if (pct === 0) return "0 %";
  if (pct < 0.001) return "< 0,001 %";
  const digits = pct >= 10 ? 0 : pct >= 1 ? 1 : pct >= 0.1 ? 2 : 3;
  return `${pct.toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;
}

let volumeSaveTimer = null;
function setVolumePosition(pos, { save = true } = {}) {
  pos = Math.max(0, Math.min(VOLUME_MAX_POS, Math.round(pos)));
  const gain = positionToGain(pos);
  const slider = $("#volume");
  slider.value = pos;
  setSliderFill(slider, pos / VOLUME_MAX_POS);
  media.volume = gain;
  fader.volume = gain;
  if (save) media.muted = false;
  $("#volume-label").textContent = formatGain(gain);
  slider.setAttribute("aria-valuetext", formatGain(gain));
  updateMuteIcon();
  if (save) {
    clearTimeout(volumeSaveTimer);
    volumeSaveTimer = setTimeout(() => api("set_config", "volume", gain).catch(() => {}), 400);
  }
}

function updateMuteIcon() {
  const gain = media.muted ? 0 : media.volume;
  $("#btn-mute").innerHTML = icon(gain === 0 ? "mute" : gain < 0.1 ? "volume-low" : "volume");
}

// ---------- Menu contextuel ----------

function openTrackMenu(trackId, x, y, ctx = {}) {
  const t = S.byId.get(trackId);
  if (!t) return;
  S.menuCtx = { trackId, ...ctx };
  const items = [
    ["play-next", "play-next", "Lire ensuite"],
    ["queue-add", "list-plus", "Ajouter à la file d'attente"],
    ["playlist-pick", "plus", "Ajouter à une playlist…"],
    S.phone?.enabled ? ((S.phone.items?.tracks || []).includes(t.id)
      ? ["phone-unsend", "phone", "Retirer du téléphone"]
      : ["phone-send", "phone", "Envoyer sur le téléphone"]) : null,
    ctx.playlistIndex != null ? ["playlist-remove", "close", "Retirer de cette playlist"] : null,
    "hr",
    ["goto-artist", "user", "Aller à l'artiste"],
    t.album ? ["goto-album", "disc", "Aller à l'album"] : null,
    ["edit", "edit", "Modifier les infos"],
    t.kind !== "video" ? ["genre", "tag", "Changer le genre…"] : null,
    ["reveal", "folder", "Afficher dans l'explorateur"],
    "hr",
    ["delete", "trash", "Mettre à la corbeille", "danger"],
  ].filter(Boolean);
  const menu = $("#menu");
  menu.innerHTML = items
    .map((it) => it === "hr" ? "<hr>" : `<button role="menuitem" class="${it[3] || ""}" data-action="menu" data-cmd="${it[0]}">${icon(it[1])}${it[2]}</button>`)
    .join("");
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  const top = ctx.above ? y - rect.height : y;
  menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - rect.height - 8))}px`;
  menu.querySelector("button")?.focus();
}

function closeMenu() {
  $("#menu").hidden = true;
}

async function runMenuCommand(cmd) {
  const ctx = S.menuCtx;
  closeMenu();
  if (!ctx) return;
  const t = S.byId.get(ctx.trackId);
  if (!t) return;
  switch (cmd) {
    case "play-next": playNext([t.id]); toast("Sera lu juste après"); break;
    case "queue-add": addToQueue([t.id]); toast("Ajouté à la file d'attente"); break;
    case "playlist-pick": pickPlaylist([t.id]); break;
    case "phone-send": await phoneToggle("track", [t.id], true); break;
    case "phone-unsend": await phoneToggle("track", [t.id], false); break;
    case "playlist-remove": {
      const pid = S.view.param;
      await api("remove_from_playlist", pid, ctx.playlistIndex);
      const pl = S.playlists.find((p) => p.id === pid);
      if (pl) pl.track_ids.splice(ctx.playlistIndex, 1);
      refreshView();
      break;
    }
    case "goto-artist": go("artist", t.artist); break;
    case "goto-album": go("album", t.album); break;
    case "edit": editTrack(t); break;
    case "genre": pickGenre(t); break;
    case "reveal": api("reveal_track", t.id); break;
    case "delete": deleteTrack(t); break;
  }
}

// ---------- Modales ----------

function openModal(html, { onSubmit } = {}) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-backdrop"><form class="modal" autocomplete="off">${html}</form></div>`;
  const backdrop = root.firstElementChild;
  const form = root.querySelector("form");
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey, true); };
  document.addEventListener("keydown", onKey, true);
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });
  $$("[data-close]", form).forEach((b) => b.addEventListener("click", close));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!onSubmit) { close(); return; }
    const keepOpen = await onSubmit(form, e.submitter);
    if (keepOpen !== true) close();
  });
  (form.querySelector("input:not([type=checkbox])") || form.querySelector("button[type=submit]"))?.focus();
  return { form, close };
}

function promptText(title, label, value = "", okLabel = "Valider") {
  return new Promise((resolve) => {
    let done = false;
    const { form } = openModal(`
      <h2>${esc(title)}</h2>
      <label class="lbl" for="prompt-input">${esc(label)}</label>
      <input class="field" id="prompt-input" value="${esc(value)}" maxlength="120">
      <div class="actions"><button type="button" class="btn" data-close>Annuler</button>
      <button type="submit" class="btn primary">${esc(okLabel)}</button></div>`, {
      onSubmit: (f) => {
        const v = $("#prompt-input", f).value.trim();
        if (!v) return true;
        done = true;
        resolve(v);
      },
    });
    const input = $("#prompt-input", form);
    input.select();
    new MutationObserver((_, obs) => { if (!form.isConnected) { obs.disconnect(); if (!done) resolve(null); } })
      .observe($("#modal-root"), { childList: true });
  });
}

function confirmModal(title, text, okLabel, danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const { form } = openModal(`
      <h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="actions"><button type="button" class="btn" data-close>Annuler</button>
      <button type="submit" class="btn ${danger ? "danger" : "primary"}">${esc(okLabel)}</button></div>`, {
      onSubmit: () => { done = true; resolve(true); },
    });
    new MutationObserver((_, obs) => { if (!form.isConnected) { obs.disconnect(); if (!done) resolve(false); } })
      .observe($("#modal-root"), { childList: true });
  });
}

function editTrack(t) {
  openModal(`
    <h2>Modifier les infos</h2>
    <label class="lbl" for="edit-title">Titre</label>
    <input class="field" id="edit-title" value="${esc(t.title)}">
    <label class="lbl" for="edit-artist">Artiste</label>
    <input class="field" id="edit-artist" value="${esc(t.artist)}">
    <label class="lbl" for="edit-album">Album (facultatif)</label>
    <input class="field" id="edit-album" value="${esc(t.album || "")}">
    <div class="actions"><button type="button" class="btn" data-close>Annuler</button>
    <button type="submit" class="btn primary">Enregistrer</button></div>`, {
    onSubmit: async (f) => {
      const title = $("#edit-title", f).value, artist = $("#edit-artist", f).value, album = $("#edit-album", f).value;
      try {
        const res = await api("update_track", t.id, title, artist, album);
        await reloadLibrary();
        if (currentId() === t.id) { updateNowPlaying(); updateMediaSession(S.byId.get(t.id)); }
        toast(res?.warning || "Infos enregistrées", res?.warning ? "error" : "");
      } catch (e) {
        toast(errMsg(e), "error");
        return true;
      }
    },
  });
}

function pickGenre(t) {
  const genres = S.genres || [];
  const current = t.genre || "";
  const custom = current && !genres.includes(current) ? current : "";
  const { form } = openModal(`
    <h2>Genre de « ${esc(t.title)} »</h2>
    <div class="genre-grid">${genres.map((g) => `
      <label class="genre-option"><input type="radio" name="genre" value="${esc(g)}"${g === current ? " checked" : ""}><span>${esc(g)}</span></label>`).join("")}
    </div>
    <label class="lbl" for="genre-custom">Ou un autre genre</label>
    <input class="field" id="genre-custom" maxlength="40" placeholder="ex. Metal, K-pop, Musique de jeux…" value="${esc(custom)}">
    <label class="check" style="margin-top:14px"><input type="checkbox" id="genre-artist">Appliquer à tous les titres de ${esc(t.artist)}</label>
    <div class="actions"><button type="button" class="btn" data-close>Annuler</button>
    <button type="submit" class="btn primary">Enregistrer</button></div>`, {
    onSubmit: async (f) => {
      const typed = $("#genre-custom", f).value.trim();
      const picked = f.querySelector("input[name=genre]:checked")?.value || "";
      const genre = typed || picked;
      if (!genre) { toast("Choisis un genre.", "error"); return true; }
      const whole = $("#genre-artist", f).checked;
      try {
        applyLibrary(await api("set_track_genre", t.id, genre, whole));
        refreshView();
        updateNowPlaying();
        toast(whole ? `Tous les titres de ${t.artist} sont en ${genre}` : `« ${t.title} » est maintenant en ${genre}`);
      } catch (e) {
        toast(errMsg(e), "error");
        return true;
      }
    },
  });
  (form.querySelector("input[name=genre]:checked") || $("#genre-custom", form)).focus();  // pas sur "Rap" par défaut
  // Choisir une case vide le champ libre, et taper un genre décoche les cases.
  $$("input[name=genre]", form).forEach((r) => r.addEventListener("change", () => { $("#genre-custom", form).value = ""; }));
  $("#genre-custom", form).addEventListener("input", (e) => {
    if (e.target.value.trim()) $$("input[name=genre]", form).forEach((r) => (r.checked = false));
  });
}

async function deleteTrack(t) {
  const ok = await confirmModal(
    `Mettre « ${t.title} » à la corbeille ?`,
    "Le fichier part dans la corbeille de Windows : tu pourras le restaurer depuis là si besoin.",
    "Mettre à la corbeille", true,
  );
  if (!ok) return;
  if (currentId() === t.id) {
    stopPlayback();
    removeFromQueue(t.id);
    updateNowPlaying();
  } else {
    removeFromQueue(t.id);
  }
  try {
    await api("delete_track", t.id);
    toast("Mis à la corbeille");
  } catch (e) {
    toast(errMsg(e), "error");
  }
  await reloadLibrary();
  renderQueue();
}

function pickPlaylist(trackIds) {
  const list = S.playlists.map((p) =>
    `<button type="button" data-pick="${p.id}">${esc(p.name)}<span class="count">${plural(p.track_ids.length, "titre")}</span></button>`).join("");
  const { form, close } = openModal(`
    <h2>Ajouter à une playlist</h2>
    <div class="pick-list">${list || `<p class="muted" style="padding:0 8px">Tu n'as pas encore de playlist.</p>`}</div>
    <div class="actions"><button type="button" class="btn" data-close>Annuler</button>
    <button type="button" class="btn primary" data-new>${icon("plus")}Nouvelle playlist</button></div>`);
  $$("[data-pick]", form).forEach((b) => b.addEventListener("click", async () => {
    const pid = +b.dataset.pick;
    close();
    await api("add_to_playlist", pid, trackIds);
    await reloadLibrary();
    toast(`Ajouté à « ${S.playlists.find((p) => p.id === pid)?.name || "la playlist"} »`);
  }));
  $("[data-new]", form).addEventListener("click", async () => {
    close();
    const name = await promptText("Nouvelle playlist", "Nom de la playlist", "", "Créer");
    if (!name) return;
    await api("create_playlist", name, trackIds);
    await reloadLibrary();
    toast(`Ajouté à « ${name} »`);
  });
}

// ---------- Toasts ----------

function toast(message, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 5000 : 2600);
}

// ---------- Actions (délégation des clics) ----------

const ACTIONS = {
  nav: (el) => go(el.dataset.view),
  "focus-search": () => { $("#search-input").focus(); },
  "goto-artist": (el) => go("artist", el.dataset.artist),
  "goto-album": (el) => go("album", el.dataset.album),
  "goto-playlist": (el) => go("playlist", +el.dataset.id),
  "genre-current": () => { const t = currentTrack(); if (t) pickGenre(t); },
  "goto-current-artist": () => { const t = currentTrack(); if (t) { $("#nowplaying").hidden = true; go("artist", t.artist); } },

  "play-list": (el) => {
    const ids = S.lists[el.dataset.list] || [];
    playList(ids, +el.dataset.index);
  },
  "play-all": (el) => { S.shuffle = false; playList(S.lists[el.dataset.list] || [], 0); },
  "shuffle-all": (el) => playList(S.lists[el.dataset.list] || [], 0, { shuffle: true }),
  "play-track": (el) => playList([+el.dataset.track], 0),
  "track-menu": (el) => {
    const r = el.getBoundingClientRect();
    const pi = el.dataset.playlistIndex;
    openTrackMenu(+el.dataset.track, r.left - 200, r.bottom + 4, { playlistIndex: pi != null ? +pi : null });
  },
  "current-menu": (el) => {
    const t = currentTrack();
    if (!t) return;
    const r = el.getBoundingClientRect();
    openTrackMenu(t.id, r.left, r.top - 6, { above: true });
  },
  menu: (el) => runMenuCommand(el.dataset.cmd),

  "win-min": () => api("win_minimize"),
  "win-max": () => api("win_toggle_maximize"),
  "win-close": () => api("win_close"),

  "toggle-play": togglePlay,
  next: () => next(),
  prev,
  shuffle: toggleShuffle,
  repeat: cycleRepeat,
  mute: () => { media.muted = !media.muted; updateMuteIcon(); },
  "toggle-queue": () => {
    const q = $("#queue");
    q.hidden = !q.hidden;
    $("#btn-queue").classList.toggle("on", !q.hidden);
    renderQueue();
  },
  "toggle-nowplaying": toggleNowPlaying,
  "queue-jump": (el) => { S.qi = +el.dataset.index; loadCurrent(true); },
  "queue-remove": (el) => {
    const index = +el.dataset.index;
    const id = S.queue[index];
    S.queue.splice(index, 1);
    if (S.unshuffled) {
      const j = S.unshuffled.indexOf(id);
      if (j >= 0) S.unshuffled.splice(j, 1);
    }
    renderQueue();
    saveSession();
  },

  "new-playlist": async () => {
    const name = await promptText("Nouvelle playlist", "Nom de la playlist", "", "Créer");
    if (!name) return;
    const id = await api("create_playlist", name, []);
    await reloadLibrary();
    go("playlist", id);
  },
  "rename-playlist": async (el) => {
    const pl = S.playlists.find((p) => p.id === +el.dataset.id);
    if (!pl) return;
    const name = await promptText("Renommer la playlist", "Nom de la playlist", pl.name, "Renommer");
    if (!name) return;
    await api("rename_playlist", pl.id, name);
    await reloadLibrary();
  },
  "delete-playlist": async (el) => {
    const pl = S.playlists.find((p) => p.id === +el.dataset.id);
    if (!pl) return;
    const ok = await confirmModal(`Supprimer « ${pl.name} » ?`, "Seule la playlist est supprimée : tes musiques restent dans la bibliothèque.", "Supprimer", true);
    if (!ok) return;
    await api("delete_playlist", pl.id);
    await reloadLibrary();
    go("home");
  },

  "paste-search": async () => {
    const text = await api("read_clipboard");
    if (!text) { toast("Le presse-papiers est vide."); return; }
    runSearch(text);
  },
  "paste-dl": async () => {
    const text = await api("read_clipboard");
    if (!text) { toast("Le presse-papiers est vide."); return; }
    $("#dl-url").value = text;
    if (isYouTubeUrl(text)) analyzeLink("dl", text);
    else toast("Le texte copié n'est pas un lien YouTube.", "error");
  },
  "yt-preview": (el) => (previewState.id === el.dataset.id ? stopPreview() : startPreview(el.dataset.id)),
  "yt-download": async (el) => {
    const r = (S.search.results || []).find((x) => x.id === el.dataset.id);
    if (!r) return;
    try {
      await api("download", { url: r.url, format: el.dataset.format, quality: S.config.quality || "best", title: r.raw_title || r.title, thumb: r.thumb });
      toast(`« ${r.title} » ajouté aux téléchargements`);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  },
  "form-format": (el) => {
    S.forms[el.dataset.form].format = el.dataset.value;
    renderLinkPanel(el.dataset.form);
  },
  "form-submit": (el) => submitForm(el.dataset.form),
  "dl-cancel": (el) => api("cancel_download", el.dataset.id),
  "dl-retry": async (el) => {
    try { await api("retry_download", el.dataset.id); toast("Téléchargement relancé"); }
    catch (e) { toast(errMsg(e), "error"); }
  },
  "dl-clear": async () => { S.downloads = await api("clear_downloads"); renderDlList(); updateBadge(); },

  "open-library": () => api("open_library_folder"),
  "engine-check": async (el) => {
    el.disabled = true;
    el.textContent = "Vérification…";
    await api("engine_check");
    setTimeout(async () => {  // pas de nouvelle version : on remet le bouton
      const status = await api("engine_status");
      onEngineEvent(status);
      if (!Object.keys(status.pending || {}).length) toast("Le moteur YouTube est à jour");
    }, 8000);
  },
  "restart-app": async () => {
    const active = S.downloads.filter((j) => ACTIVE_STATUSES.includes(j.status)).length;
    if (active && !await confirmModal("Redémarrer Audora ?",
      `${plural(active, "téléchargement")} en cours reprendra au redémarrage.`, "Redémarrer")) return;
    saveSession();
    api("restart_app");
  },
  "trim-scan": async () => {
    S.trim = { state: await api("trim_scan"), sel: null };
    renderTrim();
  },
  "trim-apply": async () => {
    const sel = trimSelection();
    const selection = Object.fromEntries([...sel].filter(([, set]) => set.size).map(([id, set]) => [id, [...set]]));
    const n = Object.keys(selection).length;
    const ok = await confirmModal(`Couper les passages cochés dans ${plural(n, "titre")} ?`,
      "Les fichiers d'origine partent dans la Corbeille de Windows : tu pourras les restaurer si besoin.", "Couper", false);
    if (!ok) return;
    if (Object.keys(selection).map(Number).includes(currentId())) { media.pause(); }  // fichier en cours de lecture
    try { S.trim.state = await api("trim_apply", selection); S.trim.sel = null; renderTrim(); }
    catch (e) { toast(errMsg(e), "error"); }
  },
  "trim-listen": (el) => {
    const id = +el.dataset.id, at = Math.max(0, +el.dataset.at - 1);
    playList([id], 0);
    const jump = () => { media.currentTime = at; media.removeEventListener("loadedmetadata", jump); };
    media.addEventListener("loadedmetadata", jump);
  },
  "dupes-delete": async () => {
    const ids = [...S.dupes.selected];
    const ok = await confirmModal(`Supprimer ${plural(ids.length, "fichier")} ?`,
      "Les fichiers .mp3 cochés sont supprimés de ton dossier (ils passent par la corbeille de Windows), avec leur pochette, et les titres disparaissent d'Audora, des playlists et du téléphone.",
      "Supprimer", true);
    if (!ok) return;
    if (ids.includes(currentId())) stopPlayback();
    ids.forEach(removeFromQueue);
    const res = await api("delete_tracks", ids);
    toast(`${plural(res.deleted, "fichier")} supprimé${res.deleted > 1 ? "s" : ""}`);
    if (res.errors.length) toast(res.errors[0], "error");
    await reloadLibrary();
    renderQueue();
    if (S.view.name === "duplicates") render();
  },
  "phone-unsend-all": async () => {
    const n = (S.phone.items?.all || []).length;
    const ok = await confirmModal(`Retirer les ${plural(n, "musique")} du téléphone ?`,
      "Elles seront effacées du téléphone à sa prochaine synchronisation. Elles restent sur ton PC.", "Tout retirer", true);
    if (!ok) return;
    S.phone.items = await api("phone_unsend_all");
    toast("Le téléphone effacera ses musiques à la prochaine synchro");
    refreshView();
  },
  "phone-toggle": (el) => phoneToggle(el.dataset.kind, el.dataset.ids.split(",").map(Number)),
  "phone-enable": async (el) => {
    S.phone = await api("phone_enable", el.dataset.value === "1");
    refreshView();
    if (S.phone.error) toast(S.phone.error, "error");
  },
  "phone-pair": async () => { S.phone = await api("phone_start_pairing"); refreshView(); },
  "phone-cancel-pairing": async () => { await api("phone_cancel_pairing"); await refreshPhone(); },
  "phone-remove-device": async (el) => {
    const ok = await confirmModal("Dissocier ce téléphone ?", "Il ne pourra plus se synchroniser tant que tu ne l'associes pas à nouveau. Les musiques déjà copiées restent dessus.", "Dissocier", true);
    if (!ok) return;
    S.phone = await api("phone_remove_device", el.dataset.id);
    refreshView();
  },
  "desktop-shortcut": async () => {
    await api("create_desktop_shortcut");
    toast("Raccourci Audora ajouté sur le Bureau");
  },
  "choose-library": async () => {
    const res = await api("choose_library_folder");
    if (!res) return;
    S.config = res.config;
    applyLibrary(res);
    refreshView();
    toast(res.added ? `Dossier changé : ${plural(res.added, "titre")} trouvé${res.added > 1 ? "s" : ""}` : "Dossier changé");
  },
  "set-theme": async (el) => {
    const id = applyTheme(el.dataset.value);
    S.config.theme = id;
    refreshView();
    S.config = await api("set_config", "theme", id);
  },
  "set-default-format": async (el) => {
    S.config = await api("set_config", "format", el.dataset.value);
    refreshView();
  },
  rescan: async () => {
    toast("Actualisation…");
    const res = await api("rescan");
    applyLibrary(res);
    refreshView();
    toast(res.added || res.removed
      ? `${plural(res.added, "titre")} ajouté${res.added > 1 ? "s" : ""}, ${res.removed} retiré${res.removed > 1 ? "s" : ""}`
      : "Rien de nouveau dans le dossier");
  },
};

document.addEventListener("click", (e) => {
  const menu = $("#menu");
  if (!menu.hidden && !menu.contains(e.target)) closeMenu();
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve(fn(el, e)).catch((err) => toast(errMsg(err), "error"));
});

document.addEventListener("contextmenu", (e) => {
  if (e.target.closest("input, textarea")) return;
  e.preventDefault();
  const el = e.target.closest("[data-track]");
  if (!el || el.closest("#queue")) { closeMenu(); return; }
  const pi = el.dataset.playlistIndex;
  openTrackMenu(+el.dataset.track, e.clientX, e.clientY, { playlistIndex: pi != null ? +pi : null });
});

// Champs des formulaires de téléchargement et des réglages (pilotés par l'état).
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.form && el.dataset.field && el.type !== "checkbox" && el.tagName !== "SELECT") {
    S.forms[el.dataset.form][el.dataset.field] = el.value;
  }
});
document.addEventListener("change", async (e) => {
  const el = e.target;
  if (el.dataset.form && el.dataset.field) {
    const form = S.forms[el.dataset.form];
    form[el.dataset.field] = el.type === "checkbox" ? el.checked : el.value;
    if (el.type === "checkbox") renderLinkPanel(el.dataset.form);
    return;
  }
  if (el.dataset.phoneAllPlaylists != null) {
    S.phone = await api("phone_all_playlists", el.checked);
    S.phone.items = S.phone.items || (await api("phone_state")).items;
    toast(el.checked ? "Toutes tes playlists iront sur le téléphone à la prochaine synchro" : "Les nouvelles playlists ne seront plus envoyées automatiquement");
    refreshView();
    return;
  }
  if (el.dataset.trimId != null && S.trim) {
    const set = trimSelection().get(+el.dataset.trimId);
    if (set) { if (el.checked) set.add(+el.dataset.trimCut); else set.delete(+el.dataset.trimCut); }
    renderTrim();
    return;
  }
  if (el.dataset.dupeId != null) {
    const id = +el.dataset.dupeId;
    if (el.checked) S.dupes.selected.add(id); else S.dupes.selected.delete(id);
    const scroll = $("#view").scrollTop;
    renderDupes();
    $("#view").scrollTop = scroll;
    return;
  }
  if (el.hasAttribute("data-autostart")) {
    try {
      S.autostart = await api("set_autostart", el.checked);
      el.checked = S.autostart;
      toast(S.autostart ? "Audora se lancera au démarrage du PC" : "Audora ne se lancera plus au démarrage");
    } catch (err) {
      el.checked = !el.checked;
      toast(errMsg(err), "error");
    }
    return;
  }
  if (el.dataset.setting) {
    const value = el.type === "checkbox" ? el.checked : el.value;
    try { S.config = await api("set_config", el.dataset.setting, el.dataset.setting === "crossfade" ? Number(value) : value); }
    catch (err) { toast(errMsg(err), "error"); }
    if (el.dataset.setting === "normalize_volume") applyTrackGain();
    if (el.dataset.setting === "spatial") applySpatial();
    if (el.dataset.setting === "crossfade" && !crossfadeSeconds()) cancelCrossfade();
  }
});

document.addEventListener("keydown", (e) => {
  const typing = e.target.closest("input, textarea, select");
  if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") || e.key === "BrowserBack" || e.key === "BrowserForward") {
    e.preventDefault();
    (e.key === "ArrowLeft" || e.key === "BrowserBack" ? navBack : navForward)();
    return;
  }
  if (e.key === "Escape") {
    if (!$("#menu").hidden) closeMenu();
    else if (!$("#nowplaying").hidden) $("#nowplaying").hidden = true;
    return;
  }
  if ((e.ctrlKey && e.key.toLowerCase() === "f") || (e.key === "/" && !typing)) {
    e.preventDefault();
    $("#search-input").focus();
    $("#search-input").select();
    return;
  }
  if (typing) return;
  if (e.key === " " || e.code === "Space") {
    if (e.target.closest("button, [role=button]")) return;
    e.preventDefault();
    togglePlay();
  } else if (e.key === "Enter" && e.target.matches(".row[data-action]")) {
    e.target.click();
  } else if (e.ctrlKey && e.key === "ArrowRight") {
    next();
  } else if (e.ctrlKey && e.key === "ArrowLeft") {
    prev();
  } else if (e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    setVolumePosition(+$("#volume").value + (e.key === "ArrowUp" ? 20 : -20));
  }
});

$("#searchbar").addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch($("#search-input").value);
});

// Glisser-déposer un lien depuis le navigateur.
let dropHint = null;
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (!dropHint) {
    dropHint = document.createElement("div");
    dropHint.className = "drop-hint";
    dropHint.textContent = "Dépose le lien YouTube ici";
    document.body.appendChild(dropHint);
  }
});
const clearDropHint = () => { dropHint?.remove(); dropHint = null; };
window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) clearDropHint(); });
window.addEventListener("drop", (e) => {
  e.preventDefault();
  clearDropHint();
  const text = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "").split(/\s+/)[0];
  if (!isYouTubeUrl(text)) { toast("Dépose un lien YouTube pour le télécharger.", "error"); return; }
  go("downloads");
  $("#dl-url").value = text;
  analyzeLink("dl", text);
});

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
