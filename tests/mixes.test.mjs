// Mix automatiques et radio (web/shared/mixes.js), lances avec : node --test tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

createRequire(import.meta.url)("../web/shared/mixes.js");
const { buildMixes, radio } = globalThis.AudoraMixes;

const GENRES = ["Rock", "Rap", "Pop", "Électro", "Autres"];
const now = Date.now() / 1000;
const tracks = Array.from({ length: 120 }, (_, i) => ({
  id: i, title: `T${i}`, artist: `A${i % 15}`, genre: GENRES[i % 5], kind: "audio",
  play_count: i % 7 === 0 ? 0 : i % 9, last_played: i % 3 ? now - 40 * 86400 : now,
}));

test("les mix n'ont jamais deux fois le même titre", () => {
  for (const mix of buildMixes(tracks)) {
    assert.equal(new Set(mix.tracks.map((t) => t.id)).size, mix.tracks.length, mix.title);
  }
});

test("un mix par grand genre, jamais pour « Autres »", () => {
  const titles = buildMixes(tracks).map((m) => m.title);
  assert.ok(titles.includes("Mix du jour"));
  assert.ok(titles.includes("Mix Rock"));
  assert.ok(!titles.includes("Mix Autres"));
  for (const mix of buildMixes(tracks).filter((m) => m.id.startsWith("genre:"))) {
    const genre = mix.id.slice(6);
    assert.ok(mix.tracks.every((t) => t.genre === genre), mix.title);
  }
});

test("les mix restent les mêmes toute la journée", () => {
  const ids = (m) => m.map((x) => x.tracks.map((t) => t.id).join(",")).join("|");
  assert.equal(ids(buildMixes(tracks)), ids(buildMixes(tracks)));
});

test("Découvertes ne contient que des titres jamais écoutés", () => {
  const discover = buildMixes(tracks).find((m) => m.id === "discover");
  assert.ok(discover.tracks.every((t) => !t.play_count));
});

test("pas de mix pour une toute petite bibliothèque", () => {
  assert.deepEqual(buildMixes(tracks.slice(0, 5)), []);
});

test("la radio commence par le titre choisi et reste dans son genre", () => {
  const list = radio(tracks[3], tracks);
  assert.equal(list[0].id, 3);
  assert.equal(list.length, 50);
  assert.equal(new Set(list.map((t) => t.id)).size, 50);
  const sameGenre = list.filter((t) => t.genre === tracks[3].genre || t.artist === tracks[3].artist).length;
  assert.ok(sameGenre >= 24, `${sameGenre} titres du même genre`);
});
