"use strict";
// Audora (PC) — Pages annexes : doublons, journal, sauvegardes, moteur YouTube, « Seulement la musique », téléphone.
// Fichiers charges dans l'ordre par index.html, ils partagent les memes variables globales.

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

// ---------- Journal des erreurs de l'interface ----------

window.addEventListener("error", (e) => {
  api("log_js_error", `${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})`).catch(() => {});
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason?.stack || e.reason?.message || String(e.reason);
  api("log_js_error", `Promesse : ${reason}`).catch(() => {});
});

// ---------- Sauvegardes ----------

function backupSettingHTML() {
  const b = S.backups?.backups || [];
  return `<div class="setting-text"><div class="setting-name">Sauvegarde de la bibliothèque</div>
      <div class="setting-value">Titres, playlists, écoutes et réglages sont copiés chaque jour (les 7 derniers jours sont gardés).
        ${b.length ? `Dernière : ${fmtDate(b[0].date)}.` : "Première copie au prochain lancement."}</div></div>
    <div class="actions"><button class="btn small" data-action="backup-now">Sauvegarder</button>
      <button class="btn small" data-action="open-data" data-which="sauvegardes">${icon("folder")}Ouvrir</button></div>`;
}

MOUNTS.settings = async () => {
  S.backups = await api("backups_info").catch(() => null);
  const box = $("#backup-setting");
  if (box) box.innerHTML = backupSettingHTML();
};

// ---------- Composants facultatifs (ffmpeg, Node.js) ----------

const TOOL_INFO = {
  ffmpeg: ["ffmpeg", "Le « couteau suisse » du son : conversion en MP3, vidéos en bonne qualité, découpe des blancs et volume égalisé.",
    "Sans lui, Audora télécharge l'audio de YouTube tel quel, en M4A (le PC et le téléphone savent le lire), mais pas de MP3, pas de découpe, pas de volume égalisé, et des vidéos de qualité limitée."],
  node: ["Node.js", "Résout les « défis » que YouTube impose pour donner ses formats.",
    "Sans lui, Audora marche encore, mais avec des formats en moins et davantage de blocages, et ça empire à mesure que YouTube se durcit."],
};

function toolsSettingHTML() {
  const tools = S.tools || {};
  return Object.entries(TOOL_INFO).map(([key, [name, role, without]]) => `
    <div class="panel setting">
      <div class="setting-text"><div class="setting-name">${name}</div>
        <div class="setting-value">${role}${tools[key] ? "" : `<br><strong>Non installé.</strong> ${without}
          Pour l'ajouter : relance l'installateur d'Audora et coche ${name}.`}</div></div>
      <span class="tool-state${tools[key] ? " ok" : ""}">${tools[key] ? `${icon("check")}Installé` : "Absent"}</span>
    </div>`).join("");
}

const noFfmpegNote = (what) => S.tools && !S.tools.ffmpeg
  ? `<p class="dl-detail error">${what} demande ffmpeg, qui n'est pas installé : relance l'installateur d'Audora et coche ffmpeg.</p>` : "";

// ---------- Version d'Audora et mises à jour ----------

function appSettingHTML() {
  const a = S.app || {};
  return `<div class="setting-text"><div class="setting-name">Audora ${esc(a.version || "")}</div>
      <div class="setting-value">${a.available ? `<strong>La version ${esc(a.available)} est disponible.</strong> Audora se fermera le temps de l'installer, puis se relancera.`
        : a.updates ? "Audora vérifie chaque jour s'il existe une nouvelle version." : "Mises à jour automatiques non activées pour cette copie d'Audora."}</div></div>
    ${a.available ? `<button class="btn small primary" data-action="install-app-update">Installer</button>`
      : a.updates ? `<button class="btn small" data-action="check-app-update">Vérifier</button>` : ""}`;
}

function onAppUpdate(info) {
  S.app = { ...(S.app || {}), available: info.version };
  const box = $("#app-setting");
  if (box) box.innerHTML = appSettingHTML();
  toast(`Audora ${info.version} est disponible : installe-la depuis les Réglages`);
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
  ${noFfmpegNote("Couper les blancs et les passages parlés")}
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
