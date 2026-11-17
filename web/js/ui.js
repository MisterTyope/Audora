"use strict";
// Audora (PC) — Menus, fenêtres modales et notifications.
// Fichiers charges dans l'ordre par index.html, ils partagent les memes variables globales.

// ---------- Menu contextuel ----------

function openTrackMenu(trackId, x, y, ctx = {}) {
  const t = S.byId.get(trackId);
  if (!t) return;
  S.menuCtx = { trackId, ...ctx };
  const items = [
    ["play-next", "play-next", "Lire ensuite"],
    ["queue-add", "list-plus", "Ajouter à la file d'attente"],
    t.kind !== "video" ? ["radio", "radio", "Lancer une radio"] : null,
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
    case "radio": {
      S.shuffle = false;
      playList(AudoraMixes.radio(t, audioTracks()).map((x) => x.id), 0);
      toast(`Radio « ${t.title} » : ${t.genre ? `du ${t.genre} ` : ""}dans la même ambiance`);
      break;
    }
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
