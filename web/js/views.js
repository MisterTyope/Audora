"use strict";
// Audora (PC) — Pages principales (accueil, titres, artistes, albums, recherche, réglages...) et routeur.
// Fichiers charges dans l'ordre par index.html, ils partagent les memes variables globales.

// ---------- Vues ----------


// Rangées par genre sur l'accueil (le genre de chaque artiste est trouvé en arrière-plan).
const GENRE_OTHER = "Autres";

/** "Tes mix" : Mix du jour, mix par genre, Découvertes... (voir web/shared/mixes.js). */
function mixesShelfHTML(audio) {
  const mixes = window.AudoraMixes ? AudoraMixes.buildMixes(audio) : [];
  if (!mixes.length) return "";
  return `<section class="section"><h2 class="section-title">Tes mix <span class="muted" style="font:500 14px var(--font-body)">renouvelés chaque jour</span></h2>
    <div class="shelf">${mixes.map((m) => {
      const key = registerList(`mix-${m.id}`, m.tracks);
      return `<button class="card mix-card" data-action="play-all" data-list="${key}">
        <div class="mix-art">${m.tracks.slice(0, 4).map((t) => coverHTML(t)).join("")}
          <span class="mix-name">${esc(m.title)}</span><span class="play-overlay">${icon("play")}</span></div>
        <div class="card-title">${esc(m.title)}</div><div class="card-sub">${esc(m.subtitle)}</div></button>`;
    }).join("")}</div></section>`;
}

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

  html += mixesShelfHTML(audio);
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
      ? `<div class="tracklist" data-reorder="playlist" data-reorder-id="${pl.id}">${tracks.map((t, i) => rowHTML(t, key, i, { playlistIndex: i, reorder: true })).join("")}</div>`
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
    actions = `<button class="btn small primary" data-action="yt-download" data-id="${esc(r.id)}" data-format="mp3">${icon("download")}${S.tools && !S.tools.ffmpeg ? "M4A" : "MP3"}</button>
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
    await api("preview_stream", id);  // trouve le lien (et signale une erreur clairement)
    if (previewState.id !== id) return;
    previewAudio.src = `/preview/${encodeURIComponent(id)}`;  // relaye par Audora, voir core/server.py
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
        <div class="segmented" role="group" aria-label="Format">${seg("mp3", S.tools && !S.tools.ffmpeg ? "Audio M4A" : "Audio MP3")}${seg("mp4", "Vidéo MP4")}</div>
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
        <div class="dl-title"><span class="fmt">${j.format === "mp4" ? "MP4" : S.tools && !S.tools.ffmpeg ? "M4A" : "MP3"}</span>${esc(j.title)}</div>
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
      <div class="panel setting" id="app-setting">${appSettingHTML()}</div>
      ${toolsSettingHTML()}
      <div class="panel setting" id="engine-setting">${engineSettingHTML()}</div>
      <div class="panel setting" id="backup-setting">${backupSettingHTML()}</div>
      <div class="panel setting">
        <div class="setting-text"><div class="setting-name">Journal des erreurs</div>
          <div class="setting-value">Si quelque chose ne marche pas, ce fichier (journal.log) garde la trace de ce qui s'est passé.</div></div>
        <button class="btn small" data-action="open-data" data-which="donnees">${icon("folder")}Ouvrir</button>
      </div>
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
