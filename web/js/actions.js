"use strict";
// Audora (PC) — Réactions aux clics, saisies et raccourcis.
// Fichiers charges dans l'ordre par index.html, ils partagent les memes variables globales.

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
  "toggle-lyrics": () => setLyricsOpen(!S.lyricsOpen),
  "open-lyrics": () => {
    if (!currentTrack()) return;
    const np = $("#nowplaying");
    if (!np.hidden && S.lyricsOpen) { np.hidden = true; setLyricsOpen(false); return; }
    np.hidden = false;
    setLyricsOpen(true);
  },
  "lyric-seek": (el) => {
    const line = lyricsState.lines[+el.dataset.index];
    if (line) { media.currentTime = line.t; if (media.paused) media.play().catch(() => {}); }
  },
  "lyrics-retry": () => loadLyrics(true),
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
  "backup-now": async () => {
    S.backups = await api("backup_now");
    const box = $("#backup-setting");
    if (box) box.innerHTML = backupSettingHTML();
    toast("Bibliothèque sauvegardée");
  },
  "open-data": (el) => api("open_data_folder", el.dataset.which),
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
