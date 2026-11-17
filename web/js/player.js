"use strict";
// Audora (PC) — Lecteur : file d'attente, moteur audio (volume égalisé, Spatial, fondu), paroles.
// Fichiers charges dans l'ordre par index.html, ils partagent les memes variables globales.

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
  if (S.lyricsOpen && !$("#nowplaying").hidden) loadLyrics();
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
  pushMiniState(true);
}

function markPlayingRows() {
  const id = currentId();
  $$(".row[data-track]").forEach((r) => r.classList.toggle("playing", +r.dataset.track === id));
}

function openNowPlaying() { $("#nowplaying").hidden = false; }
function toggleNowPlaying() {
  if (!currentTrack()) return;
  $("#nowplaying").hidden = !$("#nowplaying").hidden;
  if (!$("#nowplaying").hidden && S.lyricsOpen) loadLyrics();
}

// ---------- Paroles (synchronisées ligne par ligne quand c'est possible) ----------

const lyricsState = { trackId: null, lines: [], active: -1 };

/** "[01:02.33] texte" -> [{ t: 62.33, text }] */
function parseLrc(lrc) {
  const lines = [];
  for (const raw of (lrc || "").split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of stamps) lines.push({ t: +m[1] * 60 + +m[2], text });
  }
  return lines.sort((a, b) => a.t - b.t);
}

function setLyricsOpen(open) {
  S.lyricsOpen = open;
  $("#nowplaying").classList.toggle("with-lyrics", open);
  $("#np-lyrics").hidden = !open;
  $("#np-lyrics-btn").classList.toggle("on", open);
  $("#btn-lyrics").classList.toggle("on", open && !$("#nowplaying").hidden);
  if (open) loadLyrics();
}

async function loadLyrics(refresh = false) {
  const t = currentTrack();
  const box = $("#np-lyrics");
  if (!t || !S.lyricsOpen) return;
  if (lyricsState.trackId === t.id && !refresh) return;
  lyricsState.trackId = t.id;
  lyricsState.lines = [];
  lyricsState.active = -1;
  box.innerHTML = `<p class="lyrics-note">Recherche des paroles…</p>`;
  let found;
  try {
    found = await api("get_lyrics", t.id, refresh);
  } catch (e) {
    if (lyricsState.trackId === t.id) box.innerHTML = `<p class="lyrics-note">${esc(errMsg(e))}</p>`;
    return;
  }
  if (lyricsState.trackId !== t.id) return;  // la musique a changé entre-temps
  const lines = parseLrc(found?.synced).filter((l, i, all) => l.text || (all[i + 1] && all[i + 1].t - l.t > 4));
  if (lines.length) {
    lyricsState.lines = lines;
    box.innerHTML = `<div class="lyrics-lines">${lines.map((l, i) =>
      `<button class="lyric" data-action="lyric-seek" data-index="${i}">${l.text ? esc(l.text) : "♪"}</button>`).join("")}</div>
      <p class="lyrics-note">Paroles : LRCLIB</p>`;
    syncLyrics();
  } else if (found?.plain) {
    box.innerHTML = `<div class="lyrics-plain">${esc(found.plain).replace(/\n/g, "<br>")}</div>
      <p class="lyrics-note">Paroles non synchronisées · LRCLIB</p>`;
  } else {
    box.innerHTML = `<p class="lyrics-note">Pas de paroles trouvées pour ce titre${t.artist === "Artiste inconnu" ? " : indique son artiste avec « Modifier les infos »." : "."}</p>
      <button class="btn small" data-action="lyrics-retry">Chercher à nouveau</button>`;
  }
}

/** Ligne en cours mise en avant et gardée au centre. */
function syncLyrics() {
  const lines = lyricsState.lines;
  if (!lines.length || !S.lyricsOpen || $("#nowplaying").hidden) return;
  const now = media.currentTime + 0.25;
  let index = -1;
  for (let i = 0; i < lines.length && lines[i].t <= now; i++) index = i;
  if (index === lyricsState.active) return;
  lyricsState.active = index;
  const box = $("#np-lyrics");
  box.querySelectorAll(".lyric").forEach((el, i) => {
    el.classList.toggle("current", i === index);
    el.classList.toggle("past", i < index);
  });
  const el = box.querySelectorAll(".lyric")[index];
  if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
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
    <div class="row with-grip${isCurrent ? " playing" : ""}" role="button" tabindex="0" data-action="queue-jump" data-index="${index}" data-track="${t.id}"${isCurrent ? "" : " data-reorder-item"}>
      ${isCurrent ? "<span></span>" : gripHTML()}${coverHTML(t, "", EQ)}
      <div class="row-main"><div class="row-title">${esc(t.title)}</div><div class="row-artist">${esc(t.artist)}</div></div>
      ${isCurrent ? "<span></span>" : `<button class="icon-btn small" data-action="queue-remove" data-index="${index}" aria-label="Retirer de la file">${icon("close")}</button>`}
    </div>`;
  box.innerHTML = `
    <div class="queue-label">En cours</div>${item({ t: cur, index: S.qi }, true)}
    <div class="queue-label">À suivre${upcoming.length ? ` (${upcoming.length})` : ""}</div>
    ${upcoming.length ? `<div data-reorder="queue">${upcoming.map((x) => item(x)).join("")}</div>` : `<p class="muted" style="padding:4px 8px">Rien après ce titre.</p>`}`;
}

// --- Couleur d'ambiance tirée de la pochette ---

// ---------- Mini-lecteur : on lui envoie l'état du lecteur ----------

let miniPushAt = 0;
let colorProbe = null;

/** Couleur d'une variable du thème, calculée (Caméléon : la couleur réelle, pas la formule). */
function resolvedColor(name) {
  if (!colorProbe) {
    colorProbe = document.createElement("span");
    colorProbe.hidden = true;
    document.body.append(colorProbe);
  }
  colorProbe.style.color = `var(${name})`;
  return getComputedStyle(colorProbe).color;
}

function pushMiniState(force = false) {
  if (!S.miniOpen) return;
  const now = performance.now();
  if (!force && now - miniPushAt < 1000) return;
  miniPushAt = now;
  const t = currentTrack();
  const [r, g, b] = PALETTE[hashStr(t?.artist || t?.title || "") % PALETTE.length];
  api("mini_state", {
    id: t?.id ?? null, title: t?.title || "", artist: t?.artist || "",
    cover: t?.cover ? coverUrl(t) : null,
    fallback: `linear-gradient(135deg, rgb(${r} ${g} ${b} / .9), rgb(${r} ${g} ${b} / .3))`,
    playing: !!t && !media.paused, position: media.currentTime || 0,
    duration: isFinite(media.duration) ? media.duration : (t?.duration || 0),
    colors: Object.fromEntries(["--bg", "--panel", "--raise", "--text", "--text-2", "--accent", "--accent-ink"]
      .map((n) => [n, resolvedColor(n)])),
  }).catch(() => {});
}

function setAmbientRGB(r, g, b) {
  const max = Math.max(r, g, b);
  if (max < 130) {
    const f = 130 / Math.max(max, 1);
    r *= f; g *= f; b *= f;
  }
  document.documentElement.style.setProperty("--ambient", `${Math.min(255, r) | 0} ${Math.min(255, g) | 0} ${Math.min(255, b) | 0}`);
  pushMiniState(true);  // Caméléon : la nouvelle couleur part aussi au mini-lecteur
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
  media.addEventListener("timeupdate", syncLyrics);
  media.addEventListener("timeupdate", () => pushMiniState());
  media.addEventListener("seeked", () => pushMiniState(true));
  media.addEventListener("playing", () => pushMiniState(true));
  media.addEventListener("play", () => { errorStreak = 0; applyTrackGain(); updatePlayState(); });
  media.addEventListener("pause", () => {
    pushMiniState(true);
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
