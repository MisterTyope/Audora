// Mix automatiques et radio, calcules a partir de la bibliotheque (genres, ecoutes).
// Fichier partage : le meme code sert sur le PC (web/) et dans l'appli Android (copie a la
// construction de l'APK). Aucune requete reseau : tout est calcule sur place.
(function (global) {
  "use strict";

  const OTHER = "Autres";
  const MIX_SIZE = 40;
  const DAY = 86400;

  // Hasard "du jour" : les mix restent les memes toute la journee, et changent le lendemain.
  function seededRandom(text) {
    let h = 1779033703 ^ text.length;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
  }

  const today = () => new Date().toISOString().slice(0, 10);

  function shuffled(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Tirage sans remise, chaque titre ayant un poids (les plus ecoutes sortent plus souvent). */
  function weightedPick(list, size, weight, rand) {
    const pool = list.map((t) => ({ t, w: Math.max(0.01, weight(t)) }));
    const out = [];
    while (out.length < size && pool.length) {
      let total = 0;
      for (const p of pool) total += p.w;
      let r = rand() * total;
      let i = 0;
      while (i < pool.length - 1 && (r -= pool[i].w) > 0) i++;
      out.push(pool.splice(i, 1)[0].t);
    }
    return out;
  }

  /** Evite deux titres du meme artiste a la suite quand c'est possible. */
  function spreadArtists(list) {
    const out = [];
    const rest = list.slice();
    while (rest.length) {
      const last = out.length ? out[out.length - 1].artist : null;
      const i = rest.findIndex((t) => t.artist !== last);
      out.push(rest.splice(i < 0 ? 0 : i, 1)[0]);
    }
    return out;
  }

  const plays = (t) => t.play_count || 0;
  const audioOnly = (tracks) => tracks.filter((t) => t.kind === undefined || t.kind === "audio");

  /** Melange de favoris (ponderes par les ecoutes) et de titres moins ecoutes. */
  function blend(pool, rand, size = MIX_SIZE) {
    const favorites = weightedPick(pool, Math.round(size * 0.6), (t) => 1 + plays(t) * 2, rand);
    const chosen = new Set(favorites.map((t) => t.id));
    const others = shuffled(pool.filter((t) => !chosen.has(t.id)), rand).slice(0, size - favorites.length);
    return spreadArtists(shuffled(favorites.concat(others), rand));
  }

  /**
   * Mix du jour, un mix par grand genre, Decouvertes, Pepites oubliees.
   * Retourne [{ id, title, subtitle, tracks: [titres] }].
   */
  function buildMixes(allTracks, { maxGenres = 4 } = {}) {
    const tracks = audioOnly(allTracks);
    if (tracks.length < 8) return [];
    const seed = today();
    const now = Date.now() / 1000;
    const mixes = [];

    mixes.push({ id: "daily", title: "Mix du jour", subtitle: "Tes favoris et quelques surprises",
      tracks: blend(tracks, seededRandom(seed + "daily")) });

    const byGenre = new Map();
    for (const t of tracks) {
      const g = t.genre || OTHER;
      if (g === OTHER) continue;
      if (!byGenre.has(g)) byGenre.set(g, []);
      byGenre.get(g).push(t);
    }
    const genres = [...byGenre.entries()].filter(([, list]) => list.length >= 8)
      .sort((a, b) => b[1].reduce((s, t) => s + plays(t), 0) - a[1].reduce((s, t) => s + plays(t), 0)
        || b[1].length - a[1].length)
      .slice(0, maxGenres);
    for (const [genre, list] of genres) {
      mixes.push({ id: `genre:${genre}`, title: `Mix ${genre}`, subtitle: `${list.length} titres ${genre.toLowerCase()}`,
        tracks: blend(list, seededRandom(seed + genre)) });
    }

    const unplayed = tracks.filter((t) => !plays(t));
    if (unplayed.length >= 8) {
      mixes.push({ id: "discover", title: "Découvertes", subtitle: "Ce que tu n'as encore jamais écouté",
        tracks: spreadArtists(shuffled(unplayed, seededRandom(seed + "discover")).slice(0, MIX_SIZE)) });
    }

    const forgotten = tracks.filter((t) => plays(t) >= 2 && (!t.last_played || now - t.last_played > 30 * DAY));
    if (forgotten.length >= 8) {
      mixes.push({ id: "forgotten", title: "Pépites oubliées", subtitle: "Tu les aimais, ça fait un moment",
        tracks: spreadArtists(weightedPick(forgotten, MIX_SIZE, (t) => plays(t), seededRandom(seed + "forgotten"))) });
    }
    return mixes;
  }

  /** Radio a partir d'un titre : le titre, un peu du meme artiste, beaucoup du meme genre. */
  function radio(seedTrack, allTracks, size = 50) {
    const tracks = audioOnly(allTracks).filter((t) => t.id !== seedTrack.id);
    const rand = seededRandom(`${seedTrack.id}:${Date.now()}`);
    const sameArtist = shuffled(tracks.filter((t) => t.artist === seedTrack.artist), rand).slice(0, 6);
    const taken = new Set(sameArtist.map((t) => t.id));
    const genre = seedTrack.genre || OTHER;
    const sameGenre = tracks.filter((t) => !taken.has(t.id) && (t.genre || OTHER) === genre);
    let rest = weightedPick(sameGenre, size - 1 - sameArtist.length, (t) => 1 + plays(t), rand);
    if (rest.length + sameArtist.length < size - 1) {  // genre trop petit : on complete avec le reste
      const used = new Set([...taken, ...rest.map((t) => t.id)]);
      rest = rest.concat(weightedPick(tracks.filter((t) => !used.has(t.id)),
        size - 1 - sameArtist.length - rest.length, (t) => 1 + plays(t), rand));
    }
    return [seedTrack].concat(spreadArtists(shuffled(sameArtist.concat(rest), rand)));
  }

  global.AudoraMixes = { buildMixes, radio };
})(typeof window !== "undefined" ? window : globalThis);
